/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/eventstream.mjs
 *	@Date: 2026-11-19T09:00:00-08:00 (1795107600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-19T09:00:00-08:00 (1795107600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The `application/vnd.amazon.eventstream` binary framing Amazon Bedrock streams replies in: a frame parser (both CRCs verified), and the conversion of its frames to the `{ event, data }` messages the stream converters read.
 * @module @cldmv/llm-translator/lib/eventstream
 */
import { crc32 } from "node:zlib";
import { TranslatorError } from "./errors.mjs";
import { anthropicType } from "./upstream-error.mjs";
import { items } from "./source.mjs";

/** Bytes before the headers (total length, headers length, prelude CRC) and after the payload (message CRC). */
const PRELUDE = 12;
const TRAILER = 4;

/** A frame longer than this is not one (the service caps a message at 16 MiB plus its headers). */
const MAX_FRAME = 32 * 1024 * 1024;

/** HTTP status of each exception a stream can carry in an `:exception-type` header. */
const STATUS = {
	accessDeniedException: 403,
	internalServerException: 500,
	modelErrorException: 424,
	modelNotReadyException: 429,
	modelStreamErrorException: 424,
	modelTimeoutException: 408,
	resourceNotFoundException: 404,
	serviceQuotaExceededException: 429,
	serviceUnavailableException: 503,
	throttlingException: 429,
	validationException: 400
};

/**
 * The error for a stream that cannot be read.
 * @param {string} message - What is wrong.
 * @returns {TranslatorError} `invalid_stream_data` (502).
 */
const broken = (message) => new TranslatorError(message, { code: "invalid_stream_data", status: 502 });

/**
 * Decode the headers section of a frame.
 * @param {Buffer} bytes - The headers section.
 * @returns {Record<string, any>} Header values by name: booleans, numbers, strings, `Buffer`s for byte arrays, `Date`s for timestamps and the dashed hex text of a UUID.
 * @throws {TranslatorError} `invalid_stream_data` for a header that runs past the section or has an unknown type.
 */
function headersOf(bytes) {
	/** @type {Record<string, any>} */
	const out = {};
	let at = 0;
	const take = (length) => {
		if (at + length > bytes.length) throw broken("The event stream has a header that runs past its section");
		const part = bytes.subarray(at, at + length);
		at += length;
		return part;
	};
	while (at < bytes.length) {
		const name = take(take(1)[0]).toString("utf8");
		const type = take(1)[0];
		switch (type) {
			case 0:
				out[name] = true;
				break;
			case 1:
				out[name] = false;
				break;
			case 2:
				out[name] = take(1).readInt8();
				break;
			case 3:
				out[name] = take(2).readInt16BE();
				break;
			case 4:
				out[name] = take(4).readInt32BE();
				break;
			case 5:
				out[name] = Number(take(8).readBigInt64BE());
				break;
			case 6:
				out[name] = Buffer.from(take(take(2).readUInt16BE()));
				break;
			case 7:
				out[name] = take(take(2).readUInt16BE()).toString("utf8");
				break;
			case 8:
				out[name] = new Date(Number(take(8).readBigInt64BE()));
				break;
			case 9:
				out[name] = take(16)
					.toString("hex")
					.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
				break;
			default:
				throw broken(`The event stream has a header of unknown type ${type}`);
		}
	}
	return out;
}

/**
 * Create an incremental frame parser. A frame may be split across chunks at any byte. The prelude CRC is checked as soon as the first twelve
 * bytes are in, so a stream that is not an event stream fails at once, and the message CRC when the frame is complete.
 * @returns {{ push: (chunk: Uint8Array) => {headers: Record<string, any>, payload: Buffer}[], flush: () => void }} Parser; `push` throws `invalid_stream_data` (502) for a bad length or CRC (when frames before the bad one were read, it returns them and throws on the next `push` or `flush`), `flush` throws when the stream ended inside a frame.
 */
export function createParser() {
	let buffer = Buffer.alloc(0);
	/** @type {Error | null} */
	let failure = null;
	return {
		push(chunk) {
			if (failure) throw failure;
			buffer = buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([buffer, chunk]);
			const out = [];
			try {
				while (buffer.length >= PRELUDE) {
					if (crc32(buffer.subarray(0, 8)) !== buffer.readUInt32BE(8))
						throw broken("The event stream has a frame with a bad prelude checksum");
					const total = buffer.readUInt32BE(0);
					const headers = buffer.readUInt32BE(4);
					if (total < PRELUDE + TRAILER || total > MAX_FRAME || headers > total - PRELUDE - TRAILER) {
						throw broken("The event stream has a frame with an impossible length");
					}
					if (buffer.length < total) break;
					if (crc32(buffer.subarray(0, total - TRAILER)) !== buffer.readUInt32BE(total - TRAILER)) {
						throw broken("The event stream has a frame with a bad message checksum");
					}
					out.push({
						headers: headersOf(buffer.subarray(PRELUDE, PRELUDE + headers)),
						payload: buffer.subarray(PRELUDE + headers, total - TRAILER)
					});
					buffer = buffer.subarray(total);
				}
			} catch (error) {
				// Frames read before the bad one in this chunk are still delivered; the error comes with the next call.
				if (out.length === 0) throw error;
				failure = error;
			}
			return out;
		},
		flush() {
			if (failure) throw failure;
			if (buffer.length > 0) throw broken("The event stream ended inside a frame");
		}
	};
}

/**
 * Parse an event stream (any `lib/source.mjs` input of bytes) into frames.
 * @param {ReadableStream|AsyncIterable<Uint8Array>|Iterable<Uint8Array>|Uint8Array} source - Event stream bytes.
 * @returns {AsyncGenerator<{headers: Record<string, any>, payload: Buffer}, void, undefined>} Frames.
 */
export async function* frames(source) {
	const parser = createParser();
	for await (const chunk of items(source)) yield* parser.push(chunk);
	parser.flush();
}

/**
 * Parse a payload as JSON.
 * @param {Buffer} payload - Frame payload.
 * @returns {any} The value.
 * @throws {TranslatorError} `invalid_stream_data` (502) when it is not JSON.
 */
function json(payload) {
	try {
		return JSON.parse(payload.toString("utf8"));
	} catch {
		throw broken("The event stream has an event whose payload is not valid JSON");
	}
}

/**
 * The Anthropic `error` event for an exception or error frame. The exception name maps to an HTTP status (`validationException` is 400,
 * `throttlingException` 429, `modelStreamErrorException` 424, ...; an unknown one is 500) and the status to the Anthropic error type.
 * @param {Record<string, any>} headers - Frame headers.
 * @param {Buffer} payload - Frame payload (`{ "message": "..." }`).
 * @returns {{event: string, data: any}} Message.
 */
function failure(headers, payload) {
	const name = String(headers[":exception-type"] ?? headers[":error-code"]);
	const text = String(headers[":error-message"] ?? payload.toString("utf8"));
	let message = text;
	try {
		message = JSON.parse(text).message ?? text;
	} catch {
		// Not a JSON object: the text itself is the message.
	}
	const status = Object.hasOwn(STATUS, name) ? STATUS[name] : 500;
	return { event: "error", data: { type: "error", error: { type: anthropicType(status), message } } };
}

/**
 * Convert an event stream to `{ event, data }` messages: the shape SSE parsing gives, so the stream converters read it like a Server-Sent Events stream.
 * - `"invoke"` (`InvokeModelWithResponseStream`): each `chunk` event carries `{ "bytes": "<base64>" }`, which decodes to one Anthropic stream event; the message is that event, named by its `type`. Bedrock's `amazon-bedrock-invocationMetrics` field is removed.
 * - `"converse"` (`ConverseStream`): each event is named by its `:event-type` header (`messageStart`, `contentBlockDelta`, ...) and its payload is the data.
 * An `exception` or `error` frame becomes one Anthropic `error` message (see `failure`), and so does a stream that cannot be read (a bad checksum, a payload that is not JSON, a frame cut short, a failing connection), after which the messages end.
 * @param {ReadableStream|AsyncIterable<Uint8Array>|Iterable<Uint8Array>|Uint8Array} source - Event stream bytes.
 * @param {"invoke" | "converse"} kind - Which API the stream comes from.
 * @returns {AsyncGenerator<{event: string, data: any}, void, undefined>} Messages.
 */
export async function* events(source, kind) {
	try {
		for await (const { headers, payload } of frames(source)) {
			const type = headers[":message-type"];
			if (type === "exception" || type === "error") yield failure(headers, payload);
			else if (kind === "converse") yield { event: headers[":event-type"], data: json(payload) };
			else {
				const { bytes } = json(payload);
				const data = json(Buffer.from(String(bytes), "base64"));
				delete data["amazon-bedrock-invocationMetrics"];
				yield { event: data.type, data };
			}
		}
	} catch (cause) {
		// A stream that cannot be read (a bad checksum, a cut frame, a dropped connection) ends like one that failed: with an error message.
		yield { event: "error", data: { type: "error", error: { type: cause.type ?? "api_error", message: cause.message } } };
	}
}

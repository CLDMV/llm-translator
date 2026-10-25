/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/sse.mjs
 *	@Date: 2026-10-25T12:28:19-07:00 (1792956499)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:02-07:00 (1792958342)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Server-Sent Events parsing and encoding.
 */

import { items } from "./source.mjs";
import { TranslatorError } from "./errors.mjs";

/**
 * A parsed SSE event.
 * @typedef {object} SseEvent
 * @property {string} [event] - Event name.
 * @property {string} data - Data lines joined with `\n`.
 * @property {string} [id] - Event id (applies to the event it is sent with only).
 */

/**
 * Create an incremental SSE parser. Handles `\n`, `\r\n` and `\r` line endings, comments, a leading BOM, multi-line
 * `data:` fields and chunk boundaries anywhere (including inside a line or a line terminator).
 * @returns {{ push: (chunk: string) => SseEvent[], flush: () => SseEvent[] }} Parser.
 */
export function createParser() {
	let buffer = "";
	let first = true;
	let event;
	let id;
	let data = [];

	const dispatch = (out) => {
		if (data.length > 0) {
			const parsed = { data: data.join("\n") };
			if (event !== undefined) parsed.event = event;
			if (id !== undefined) parsed.id = id;
			out.push(parsed);
		}
		event = undefined;
		id = undefined;
		data = [];
	};

	const line = (text, out) => {
		if (text === "") return dispatch(out);
		if (text.startsWith(":")) return;
		const colon = text.indexOf(":");
		const field = colon === -1 ? text : text.slice(0, colon);
		let value = colon === -1 ? "" : text.slice(colon + 1);
		if (value.startsWith(" ")) value = value.slice(1);
		if (field === "data") data.push(value);
		else if (field === "event") event = value;
		else if (field === "id") id = value;
	};

	return {
		push(chunk) {
			const out = [];
			buffer += chunk;
			if (first && buffer.length > 0) {
				first = false;
				if (buffer.charCodeAt(0) === 0xfeff) buffer = buffer.slice(1);
			}
			let start = 0;
			for (let i = 0; i < buffer.length; i++) {
				const ch = buffer[i];
				if (ch !== "\n" && ch !== "\r") continue;
				// A trailing "\r" might be the first half of "\r\n": wait for the next chunk.
				if (ch === "\r" && i === buffer.length - 1) break;
				line(buffer.slice(start, i), out);
				if (ch === "\r" && buffer[i + 1] === "\n") i++;
				start = i + 1;
			}
			buffer = buffer.slice(start);
			return out;
		},
		flush() {
			const out = [];
			if (buffer.length > 0) {
				line(buffer.replace(/\r$/, ""), out);
				buffer = "";
			}
			dispatch(out);
			return out;
		}
	};
}

/**
 * Parse SSE text (any `lib/source.mjs` input) into events.
 * @param {ReadableStream|AsyncIterable<string|Uint8Array>|Iterable<string|Uint8Array>|string|Uint8Array} source - SSE bytes or text.
 * @returns {AsyncGenerator<SseEvent, void, undefined>} Parsed events.
 */
export async function* parse(source) {
	const parser = createParser();
	const decoder = new TextDecoder();
	for await (const value of items(source)) {
		const chunk = typeof value === "string" ? value : decoder.decode(value, { stream: true });
		yield* parser.push(chunk);
	}
	yield* parser.push(decoder.decode());
	yield* parser.flush();
}

/**
 * Encode one event as SSE text. Object `data` is JSON-encoded; string `data` is written as is (multi-line strings
 * become several `data:` lines).
 * @param {{ event?: string, data: unknown, id?: string }} message - Event to encode.
 * @returns {string} SSE frame terminated by a blank line.
 */
export function encode({ event, data, id }) {
	let out = "";
	if (event !== undefined) out += `event: ${event}\n`;
	if (id !== undefined) out += `id: ${id}\n`;
	const payload = typeof data === "string" ? data : JSON.stringify(data);
	for (const part of payload.split("\n")) out += `data: ${part}\n`;
	return `${out}\n`;
}

/**
 * Normalize a stream input into `{ event, data }` messages whose `data` is parsed JSON (or the literal string
 * `"[DONE]"`). Accepts SSE text/bytes, already-parsed `{ event, data }` pairs, or bare payload objects (OpenAI
 * chunks, Anthropic event payloads). A bare payload object that has a `type` becomes `event: <type>`.
 * @param {ReadableStream|AsyncIterable<any>|Iterable<any>|string|Uint8Array} source - Stream input.
 * @returns {AsyncGenerator<{ event?: string, data: any }, void, undefined>} Messages.
 */
export async function* messages(source) {
	const parser = createParser();
	const decoder = new TextDecoder();
	for await (const value of items(source)) {
		if (typeof value === "string" || value instanceof Uint8Array) {
			const chunk = typeof value === "string" ? value : decoder.decode(value, { stream: true });
			for (const parsed of parser.push(chunk)) yield decodeEvent(parsed);
		} else if ("data" in value) {
			yield typeof value.data === "string" ? decodeEvent(value) : value;
		} else {
			yield value.type === undefined ? { data: value } : { event: value.type, data: value };
		}
	}
	for (const parsed of [...parser.push(decoder.decode()), ...parser.flush()]) yield decodeEvent(parsed);
}

/**
 * Decode an SSE event's data string as JSON (leaving `[DONE]` alone).
 * @param {SseEvent} parsed - Parsed event.
 * @returns {{ event?: string, data: any }} Event with decoded data.
 */
function decodeEvent(parsed) {
	if (parsed.data === "[DONE]") return parsed;
	try {
		return { ...parsed, data: JSON.parse(parsed.data) };
	} catch {
		throw new TranslatorError("Upstream sent an SSE event whose data is not valid JSON", {
			code: "invalid_stream_data",
			status: 502,
			details: { data: parsed.data }
		});
	}
}

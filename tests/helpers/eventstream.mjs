/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/helpers/eventstream.mjs
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
 * @fileoverview Builds `application/vnd.amazon.eventstream` frames for tests, with real CRCs, the way Amazon Bedrock frames its streams.
 */
import { crc32 } from "node:zlib";

/**
 * Encode one header: its name, a type byte and the value in the type's form.
 * @param {string} name - Header name.
 * @param {number} type - Type byte: 0 true, 1 false, 2 byte, 3 short, 4 int, 5 long, 6 bytes, 7 string, 8 timestamp, 9 uuid.
 * @param {any} [value] - The value (a number, string, Buffer or, for a UUID, dashed hex text).
 * @returns {Buffer} Encoded header.
 */
export function header(name, type, value) {
	const key = Buffer.from(name);
	const head = Buffer.concat([Buffer.from([key.length]), key, Buffer.from([type])]);
	const number = (size, write) => {
		const out = Buffer.alloc(size);
		write(out);
		return out;
	};
	switch (type) {
		case 0:
		case 1:
			return head;
		case 2:
			return Buffer.concat([head, number(1, (out) => out.writeInt8(value))]);
		case 3:
			return Buffer.concat([head, number(2, (out) => out.writeInt16BE(value))]);
		case 4:
			return Buffer.concat([head, number(4, (out) => out.writeInt32BE(value))]);
		case 5:
		case 8:
			return Buffer.concat([head, number(8, (out) => out.writeBigInt64BE(BigInt(value)))]);
		case 6:
		case 7: {
			const bytes = Buffer.from(value);
			return Buffer.concat([head, number(2, (out) => out.writeUInt16BE(bytes.length)), bytes]);
		}
		default:
			return Buffer.concat([head, Buffer.from(String(value).replaceAll("-", ""), "hex")]);
	}
}

/**
 * Build a frame: prelude (lengths and its CRC), headers, payload and the CRC of everything before it.
 * @param {Record<string, string> | Buffer} headers - String headers by name, or already encoded headers.
 * @param {string | Buffer} [payload] - Payload.
 * @returns {Buffer} The frame.
 */
export function frame(headers, payload = "") {
	const section = Buffer.isBuffer(headers)
		? headers
		: Buffer.concat(Object.entries(headers).map(([name, value]) => header(name, 7, value)));
	const body = Buffer.from(payload);
	const prelude = Buffer.alloc(12);
	prelude.writeUInt32BE(16 + section.length + body.length, 0);
	prelude.writeUInt32BE(section.length, 4);
	prelude.writeUInt32BE(crc32(prelude.subarray(0, 8)), 8);
	const front = Buffer.concat([prelude, section, body]);
	const tail = Buffer.alloc(4);
	tail.writeUInt32BE(crc32(front));
	return Buffer.concat([front, tail]);
}

/**
 * An `event` frame whose payload is JSON.
 * @param {string} type - `:event-type`.
 * @param {any} payload - Value, sent as JSON.
 * @returns {Buffer} The frame.
 */
export const event = (type, payload) =>
	frame({ ":event-type": type, ":content-type": "application/json", ":message-type": "event" }, JSON.stringify(payload));

/**
 * The `chunk` event InvokeModelWithResponseStream sends: `{ "bytes": "<base64 of the JSON event>" }`.
 * @param {any} data - One Anthropic stream event.
 * @returns {Buffer} The frame.
 */
export const chunk = (data) => event("chunk", { bytes: Buffer.from(JSON.stringify(data)).toString("base64") });

/**
 * An `exception` frame.
 * @param {string} type - `:exception-type`, for example `throttlingException`.
 * @param {string} message - The message.
 * @returns {Buffer} The frame.
 */
export const exception = (type, message) =>
	frame({ ":exception-type": type, ":content-type": "application/json", ":message-type": "exception" }, JSON.stringify({ message }));

/**
 * Cut a buffer into pieces of a size, so a frame can be split anywhere.
 * @param {Buffer} bytes - Bytes.
 * @param {number} size - Piece size.
 * @returns {Buffer[]} Pieces.
 */
export function pieces(bytes, size) {
	const out = [];
	for (let at = 0; at < bytes.length; at += size) out.push(bytes.subarray(at, at + size));
	return out;
}

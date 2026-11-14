/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/ndjson.mjs
 *	@Date: 2026-11-13T11:00:00-08:00 (1794596400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-13T11:00:00-08:00 (1794596400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Newline-delimited JSON parsing for streaming replies (Ollama's native `/api/chat` streams one JSON object per line, not Server-Sent Events).
 * @module @cldmv/llm-translator/lib/ndjson
 */
import { items } from "./source.mjs";
import { TranslatorError } from "./errors.mjs";

/**
 * Decode one line as JSON.
 * @param {string} text - A non-blank line.
 * @returns {any} The parsed value.
 * @throws {TranslatorError} `invalid_stream_data` (502) when the line is not JSON.
 */
function decode(text) {
	try {
		return JSON.parse(text);
	} catch {
		throw new TranslatorError("Upstream sent a stream line that is not valid JSON", {
			code: "invalid_stream_data",
			status: 502,
			details: { data: text }
		});
	}
}

/**
 * Create an incremental NDJSON parser. A line may be split across chunks at any byte; the part after the last newline is held until the next
 * chunk (or `flush`) completes it. Handles `\n` and `\r\n`, and skips blank lines.
 * @returns {{ push: (chunk: string) => any[], flush: () => any[] }} Parser.
 */
export function createParser() {
	let buffer = "";
	const lines = (text, out) => {
		const trimmed = text.replace(/\r$/, "").trim();
		if (trimmed !== "") out.push(decode(trimmed));
	};
	return {
		push(chunk) {
			const out = [];
			buffer += chunk;
			let start = 0;
			for (let at = buffer.indexOf("\n"); at !== -1; at = buffer.indexOf("\n", start)) {
				lines(buffer.slice(start, at), out);
				start = at + 1;
			}
			buffer = buffer.slice(start);
			return out;
		},
		flush() {
			const out = [];
			lines(buffer, out);
			buffer = "";
			return out;
		}
	};
}

/**
 * Parse NDJSON text (any `lib/source.mjs` input) into objects. Parsed objects in the source pass through, so a stream that was already
 * decoded can be fed in again.
 * @param {ReadableStream|AsyncIterable<string|Uint8Array|object>|Iterable<string|Uint8Array|object>|string|Uint8Array} source - NDJSON bytes or text.
 * @returns {AsyncGenerator<any, void, undefined>} One object per line.
 */
export async function* parse(source) {
	const parser = createParser();
	const decoder = new TextDecoder();
	for await (const value of items(source)) {
		if (typeof value === "string" || value instanceof Uint8Array) {
			yield* parser.push(typeof value === "string" ? value : decoder.decode(value, { stream: true }));
		} else {
			yield value;
		}
	}
	yield* parser.push(decoder.decode());
	yield* parser.flush();
}

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/source.mjs
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
 * @fileoverview Normalize the many shapes a streaming body can arrive in.
 */

/**
 * Iterate any supported source as raw items: a `ReadableStream`, an async iterable, an iterable, or a single
 * string / `Uint8Array` / object. Closing the returned iterator (early `break`, `return()`, a throw) cancels the
 * underlying stream or iterator so aborts propagate upstream.
 * @param {ReadableStream|AsyncIterable<unknown>|Iterable<unknown>|string|Uint8Array|any} source - Input source.
 * @returns {AsyncGenerator<any, void, undefined>} Raw items in order.
 */
export async function* items(source) {
	if (typeof source?.getReader === "function") {
		const reader = source.getReader();
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) return;
				yield value;
			}
		} finally {
			await reader.cancel().catch(() => {});
		}
	} else if (typeof source?.[Symbol.asyncIterator] === "function") {
		yield* source;
	} else if (typeof source !== "string" && typeof source?.[Symbol.iterator] === "function" && !(source instanceof Uint8Array)) {
		for (const value of source) yield value;
	} else {
		yield source;
	}
}

/**
 * Iterate a source as decoded text. Strings pass through, `Uint8Array` chunks are decoded as streaming UTF-8
 * (multi-byte characters may span chunks).
 * @param {ReadableStream|AsyncIterable<string|Uint8Array>|Iterable<string|Uint8Array>|string|Uint8Array} source - Input source.
 * @returns {AsyncGenerator<string, void, undefined>} Text chunks.
 */
export async function* text(source) {
	const decoder = new TextDecoder();
	for await (const value of items(source)) {
		yield typeof value === "string" ? value : decoder.decode(value, { stream: true });
	}
	const rest = decoder.decode();
	if (rest) yield rest;
}

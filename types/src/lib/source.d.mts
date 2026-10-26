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
export declare function items(source: ReadableStream | AsyncIterable<unknown> | Iterable<unknown> | string | Uint8Array | any): AsyncGenerator<any, void, undefined>;
/**
 * Iterate a source as decoded text. Strings pass through, `Uint8Array` chunks are decoded as streaming UTF-8
 * (multi-byte characters may span chunks).
 * @param {ReadableStream|AsyncIterable<string|Uint8Array>|Iterable<string|Uint8Array>|string|Uint8Array} source - Input source.
 * @returns {AsyncGenerator<string, void, undefined>} Text chunks.
 */
export declare function text(source: ReadableStream | AsyncIterable<string | Uint8Array> | Iterable<string | Uint8Array> | string | Uint8Array): AsyncGenerator<string, void, undefined>;

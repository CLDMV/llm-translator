/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/sse/parse.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:01-07:00 (1792958341)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * Parse SSE text/bytes (or already-parsed events) into `{ event?, data }` messages. `data` is decoded JSON, or the string
 * `"[DONE]"`.
 * @param {ReadableStream | AsyncIterable<unknown> | Iterable<unknown> | string | Uint8Array} source - SSE input.
 * @returns {AsyncGenerator<{event?: string, data: *}>} Messages.
 */
export declare function parse(source: ReadableStream | AsyncIterable<unknown> | Iterable<unknown> | string | Uint8Array): AsyncGenerator<{
    event?: string;
    data: any;
}>;

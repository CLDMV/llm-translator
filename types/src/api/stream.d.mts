/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/stream.mjs
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
 * Convert an upstream SSE stream to client events: Anthropic events (`message_start`, `content_block_*`, ...) for the
 * Anthropic front, Chat Completions chunks followed by `"[DONE]"` for the OpenAI front. Pings are added by the SSE writer.
 * @param {ReadableStream | AsyncIterable<string | Uint8Array> | string} source - Upstream SSE bytes or text.
 * @param {any} state - The `state` returned by `request`.
 * @returns {AsyncIterable<{event?: string, data: *}>} Client events.
 */
export declare function stream(source: ReadableStream | AsyncIterable<string | Uint8Array> | string, state: any): AsyncIterable<{
    event?: string;
    data: any;
}>;

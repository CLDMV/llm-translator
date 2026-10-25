/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/anthropic/messages/to/openai/chat/stream.mjs
 *	@Date: 2026-10-25T12:28:19-07:00 (1792956499)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:58:59-07:00 (1792958339)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * Convert an Anthropic Messages event stream into OpenAI `chat.completion.chunk` messages followed by `[DONE]`.
 *
 * `source` is SSE text/bytes, an iterable of `{ event, data }` pairs, or an iterable of bare event payloads. The
 * result yields `{ data }` messages (chunk objects, then the string `"[DONE]"`); encode them with `lib/sse.mjs`.
 * Usage is emitted as a final `choices: []` chunk when `state.includeUsage` is not false. An Anthropic `error`
 * event, or a stream that ends before `message_stop`, becomes a `{ error }` chunk followed by `[DONE]`.
 * @param {ReadableStream|AsyncIterable<unknown>|Iterable<unknown>|string|Uint8Array} source - Anthropic stream.
 * @param {any} [state] - State from the request converter (model, `includeUsage`, tool-name map).
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {AsyncGenerator<{ data: any|string }, void, undefined>} OpenAI chunks.
 */
export declare function stream(source: ReadableStream | AsyncIterable<unknown> | Iterable<unknown> | string | Uint8Array, state?: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): AsyncGenerator<{
    data: any | string;
}, void, undefined>;

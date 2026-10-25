/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/openai/chat/to/anthropic/messages/stream.mjs
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
 * Convert an OpenAI chat-completion stream into Anthropic Messages stream events.
 *
 * `source` is SSE text/bytes (string, `Uint8Array`, `ReadableStream`, async or sync iterable of either) or an
 * iterable of already-parsed chunk objects. Handles reasoning (`reasoning`, `reasoning_content`, leading
 * `<think>`), the three vLLM tool-call delta shapes (id+name first then argument fragments, name and arguments
 * together, whole call at once), usage-only final chunks, `[DONE]`, mid-stream `{"error":...}` objects (answered
 * with an Anthropic `error` event) and closing the iterator early (the upstream source is closed too). Pings are
 * the SSE writer's job, not this converter's. Tool calls that start while another tool block is streaming (parallel
 * calls, possibly with interleaved argument fragments) are buffered and emitted as complete blocks once it closes.
 * @param {ReadableStream|AsyncIterable<unknown>|Iterable<unknown>|string|Uint8Array} source - OpenAI stream.
 * @param {any} [state] - State from the request converter (original model, tool-name map).
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {AsyncGenerator<{ event: string, data: any }, void, undefined>} Anthropic events.
 */
export declare function stream(source: ReadableStream | AsyncIterable<unknown> | Iterable<unknown> | string | Uint8Array, state?: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): AsyncGenerator<{
    event: string;
    data: any;
}, void, undefined>;

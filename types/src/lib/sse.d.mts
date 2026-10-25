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
export type SseEvent = {
    /**
     * - Event name.
     */
    event?: string;
    /**
     * - Data lines joined with `\n`.
     */
    data: string;
    /**
     * - Event id (applies to the event it is sent with only).
     */
    id?: string;
};
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
export declare function createParser(): {
    push: (chunk: string) => SseEvent[];
    flush: () => SseEvent[];
};
/**
 * Parse SSE text (any `lib/source.mjs` input) into events.
 * @param {ReadableStream|AsyncIterable<string|Uint8Array>|Iterable<string|Uint8Array>|string|Uint8Array} source - SSE bytes or text.
 * @returns {AsyncGenerator<SseEvent, void, undefined>} Parsed events.
 */
export declare function parse(source: ReadableStream | AsyncIterable<string | Uint8Array> | Iterable<string | Uint8Array> | string | Uint8Array): AsyncGenerator<SseEvent, void, undefined>;
/**
 * Encode one event as SSE text. Object `data` is JSON-encoded; string `data` is written as is (multi-line strings
 * become several `data:` lines).
 * @param {{ event?: string, data: unknown, id?: string }} message - Event to encode.
 * @returns {string} SSE frame terminated by a blank line.
 */
export declare function encode({ event, data, id }: {
    event?: string;
    data: unknown;
    id?: string;
}): string;
/**
 * Normalize a stream input into `{ event, data }` messages whose `data` is parsed JSON (or the literal string
 * `"[DONE]"`). Accepts SSE text/bytes, already-parsed `{ event, data }` pairs, or bare payload objects (OpenAI
 * chunks, Anthropic event payloads). A bare payload object that has a `type` becomes `event: <type>`.
 * @param {ReadableStream|AsyncIterable<any>|Iterable<any>|string|Uint8Array} source - Stream input.
 * @returns {AsyncGenerator<{ event?: string, data: any }, void, undefined>} Messages.
 */
export declare function messages(source: ReadableStream | AsyncIterable<any> | Iterable<any> | string | Uint8Array): AsyncGenerator<{
    event?: string;
    data: any;
}, void, undefined>;

/**
 * Convert an upstream SSE stream to client events: Anthropic events (`message_start`, `content_block_*`, ...) for the
 * Anthropic front, Chat Completions chunks followed by `"[DONE]"` for the OpenAI front. Pings are added by the SSE writer.
 * @param {ReadableStream | AsyncIterable<string | Uint8Array> | string} source - Upstream SSE bytes or text.
 * @param {any} state - The `state` returned by `request`.
 * @returns {AsyncIterable<{event?: string, data: *}>} Client events.
 */
export function stream(source: ReadableStream | AsyncIterable<string | Uint8Array> | string, state: any): AsyncIterable<{
    event?: string;
    data: any;
}>;

/**
 * Convert Cohere stream events (Server-Sent Events text, or `{ event, data }` messages) to Anthropic events. The events become Chat Completions
 * chunks (one id for the reply, tool calls streamed in pieces, `finish_reason` as the finish chunk, the `message-end` usage as the usage chunk)
 * and the Chat Completions conversion writes the events. A failure, an event that cannot be read and a stream that ends before `message-end`
 * each end the stream with an `error` event.
 * @param {ReadableStream|AsyncIterable<unknown>|Iterable<unknown>|string|Uint8Array} source - The events.
 * @param {any} [state] - State from the request converter.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {AsyncGenerator<{ event: string, data: any }, void, undefined>} Anthropic events.
 */
export function stream(source: ReadableStream | AsyncIterable<unknown> | Iterable<unknown> | string | Uint8Array, state?: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): AsyncGenerator<{
    event: string;
    data: any;
}, void, undefined>;

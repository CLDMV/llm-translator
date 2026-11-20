/**
 * Convert ConverseStream events (`{ event, data }` messages, as `lib/eventstream` makes them from the binary frames, or Server-Sent Events text
 * of the same events) to Anthropic events. The events become Chat Completions chunks (one id for the reply, tool calls streamed in pieces, the
 * stop reason as the finish chunk, the `metadata` usage as the usage chunk) and the Chat Completions conversion writes the events. A failure
 * message, an event that cannot be read and a stream that ends before `messageStop` each end the stream with an `error` event.
 * @param {ReadableStream|AsyncIterable<unknown>|Iterable<unknown>|string|Uint8Array} source - The events.
 * @param {any} [state] - State from the request converter.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {AsyncGenerator<{ event: string, data: any }, void, undefined>} Anthropic events.
 */
export function stream(source: ReadableStream | AsyncIterable<unknown> | Iterable<unknown> | string | Uint8Array, state?: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): AsyncGenerator<{
    event: string;
    data: any;
}, void, undefined>;

/**
 * Convert `streamGenerateContent` chunks (Server-Sent Events, each a whole `GenerateContentResponse`) to Anthropic events. The chunks become Chat
 * Completions chunks (one id for the reply, a function call as one tool call, the `finishReason` as the finish chunk, the `usageMetadata` as the
 * usage chunk) and the Chat Completions conversion writes the events. A failure message, a chunk that cannot be read and a stream that ends
 * before a `finishReason` each end the stream with an `error` event.
 * @param {ReadableStream|AsyncIterable<unknown>|Iterable<unknown>|string|Uint8Array} source - The chunks.
 * @param {any} [state] - State from the request converter.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {AsyncGenerator<{ event: string, data: any }, void, undefined>} Anthropic events.
 */
export function stream(source: ReadableStream | AsyncIterable<unknown> | Iterable<unknown> | string | Uint8Array, state?: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): AsyncGenerator<{
    event: string;
    data: any;
}, void, undefined>;

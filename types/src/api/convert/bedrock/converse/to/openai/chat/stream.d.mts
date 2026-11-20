/**
 * Convert ConverseStream events (`{ event, data }` messages, as `lib/eventstream` makes them from the binary frames, or Server-Sent Events text
 * of the same events) to Chat Completions chunks followed by `[DONE]`. Every chunk carries one completion id, tool calls stream their arguments
 * in pieces, and the `metadata` event gives the usage chunk unless `state.includeUsage` is false. A failure message, an event that cannot be read
 * and a stream that ends before `messageStop` each become an `{ error }` chunk followed by `[DONE]`.
 * @param {ReadableStream|AsyncIterable<unknown>|Iterable<unknown>|string|Uint8Array} source - The events.
 * @param {any} [state] - State from the request converter (model, `includeUsage`).
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {AsyncGenerator<{ data: any|string }, void, undefined>} Chat Completions chunks.
 */
export function stream(source: ReadableStream | AsyncIterable<unknown> | Iterable<unknown> | string | Uint8Array, state?: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): AsyncGenerator<{
    data: any | string;
}, void, undefined>;

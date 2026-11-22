/**
 * Convert Cohere stream events (Server-Sent Events text, or `{ event, data }` messages) to Chat Completions chunks followed by `[DONE]`. Every
 * chunk carries one completion id, tool calls stream their arguments in pieces, and the `message-end` event gives the finish chunk and, unless
 * `state.includeUsage` is false, the usage chunk. A failure, an event that cannot be read and a stream that ends before `message-end` each
 * become an `{ error }` chunk followed by `[DONE]`.
 * @param {ReadableStream|AsyncIterable<unknown>|Iterable<unknown>|string|Uint8Array} source - The events.
 * @param {any} [state] - State from the request converter (model, `includeUsage`).
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {AsyncGenerator<{ data: any|string }, void, undefined>} Chat Completions chunks.
 */
export function stream(source: ReadableStream | AsyncIterable<unknown> | Iterable<unknown> | string | Uint8Array, state?: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): AsyncGenerator<{
    data: any | string;
}, void, undefined>;

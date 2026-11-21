/**
 * Convert `streamGenerateContent` chunks (Server-Sent Events, each a whole `GenerateContentResponse`) to Chat Completions chunks followed by
 * `[DONE]`. Every chunk carries one completion id, a function call is one tool call, and the final `usageMetadata` gives the usage chunk unless
 * `state.includeUsage` is false. A failure message, a chunk that cannot be read and a stream that ends before a `finishReason` each become an
 * `{ error }` chunk followed by `[DONE]`.
 * @param {ReadableStream|AsyncIterable<unknown>|Iterable<unknown>|string|Uint8Array} source - The chunks.
 * @param {any} [state] - State from the request converter (model, `includeUsage`).
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {AsyncGenerator<{ data: any|string }, void, undefined>} Chat Completions chunks.
 */
export function stream(source: ReadableStream | AsyncIterable<unknown> | Iterable<unknown> | string | Uint8Array, state?: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): AsyncGenerator<{
    data: any | string;
}, void, undefined>;

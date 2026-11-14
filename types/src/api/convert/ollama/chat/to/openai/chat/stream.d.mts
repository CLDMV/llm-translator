/**
 * Convert an Ollama stream (one JSON object per line, possibly split anywhere across chunks) to Chat Completions chunks followed by `[DONE]`.
 * Every chunk carries one completion id, tool calls come whole with generated ids, and the final line gives the finish chunk and, unless
 * `state.includeUsage` is false, a usage chunk. A line that is not JSON, an `{ error }` line and a stream that ends before its final line
 * each become an `{ error }` chunk followed by `[DONE]`.
 * @param {ReadableStream|AsyncIterable<unknown>|Iterable<unknown>|string|Uint8Array} source - Ollama NDJSON bytes or text.
 * @param {any} [state] - State from the request converter (model, `includeUsage`).
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {AsyncGenerator<{ data: any|string }, void, undefined>} Chat Completions chunks.
 */
export function stream(source: ReadableStream | AsyncIterable<unknown> | Iterable<unknown> | string | Uint8Array, state?: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): AsyncGenerator<{
    data: any | string;
}, void, undefined>;

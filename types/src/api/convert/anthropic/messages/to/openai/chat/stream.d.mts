/**
 * Convert an Anthropic Messages event stream into OpenAI `chat.completion.chunk` messages followed by `[DONE]`.
 *
 * `source` is SSE text/bytes, an iterable of `{ event, data }` pairs, or an iterable of bare event payloads. The
 * result yields `{ data }` messages (chunk objects, then the string `"[DONE]"`); encode them with `lib/sse.mjs`.
 * Usage is emitted as a final `choices: []` chunk when `state.includeUsage` is not false. An Anthropic `error`
 * event, or a stream that ends before `message_stop`, becomes a `{ error }` chunk followed by `[DONE]`.
 * @param {ReadableStream|AsyncIterable<unknown>|Iterable<unknown>|string|Uint8Array} source - Anthropic stream.
 * @param {any} [state] - State from the request converter (model, `includeUsage`, tool-name map).
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {AsyncGenerator<{ data: any|string }, void, undefined>} OpenAI chunks.
 */
export function stream(source: ReadableStream | AsyncIterable<unknown> | Iterable<unknown> | string | Uint8Array, state?: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): AsyncGenerator<{
    data: any | string;
}, void, undefined>;

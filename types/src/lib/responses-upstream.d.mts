/**
 * The protocol an upstream is using right now. An `api: "auto"` upstream on a driver that declares the Responses API starts on it
 * (`endpoint.protocol`) and drops to its Chat Completions protocol (`endpoint.chat`) once the server answered 404, 405 or 501 to it.
 * @param {any} endpoint - Runtime endpoint.
 * @param {Set<string>} missing - Names of the upstreams that have no Responses API (`state.noResponses`).
 * @param {boolean} [used] - Whether the request in hand went over the Responses API; decides for it when given, so a reply that was
 * already on its way when the fallback happened is still read as the Responses reply it is.
 * @returns {string} Protocol name.
 */
export function protocolOf(endpoint: any, missing: Set<string>, used?: boolean): string;
/**
 * Convert a Chat Completions request body into a Responses request body.
 *
 * System messages before the first turn become `instructions`; assistant turns become message and `function_call` items and their
 * tool results `function_call_output` items. The request is always stateless (`store: false`); with `reasoningRoundTrip` the encrypted
 * reasoning of earlier turns is asked for (`include`) and sent back as `reasoning` items. Fields the Responses API has no counterpart
 * for (`stop`, `seed`, the penalties, `logit_bias`, `logprobs`) are dropped and recorded in `state.dropped`.
 * @param {any} chat - Chat Completions body.
 * @param {Partial<import("./settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {{ body: any, state: any }} Responses body and conversion state (`front`, `model`, `stream`, `includeUsage`, `dropped`).
 * @throws {TranslatorError} For a body without `messages`, `n` above 1 (`send` fans that out instead), an unknown role, or an unknown field when configured to error.
 */
export function request(chat: any, settings?: Partial<import("./settings.mjs").Settings>): {
    body: any;
    state: any;
};
/**
 * Chat Completions usage for a Responses usage object.
 * @param {any} usage - Responses `usage`.
 * @returns {object | undefined} Chat usage, or undefined when the reply carried none.
 */
export function usageOf(usage: any): object | undefined;
/**
 * Convert a (non-streaming) Responses reply into a Chat Completions reply.
 *
 * Message text becomes `content` (a refusal `refusal`), `function_call` items `tool_calls`, and the summary of reasoning items the
 * reasoning field named by `reasoningField`. With `reasoningRoundTrip` every reasoning item that carries `encrypted_content` is also
 * returned as a `reasoning_details` item (format `openai-responses-v1`), which the Anthropic converter signs into the thinking block and the
 * request converter turns back into a `reasoning` item.
 * @param {any} reply - Responses object.
 * @param {any} [state] - State from the request converter (`model`; `upstreamUsage` is written to it).
 * @param {Partial<import("./settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {any} Chat completion.
 * @throws {TranslatorError} When the reply is not an object with an `output` list, or did not finish.
 */
export function response(reply: any, state?: any, settings?: Partial<import("./settings.mjs").Settings>): any;
/**
 * Convert a Responses event stream into Chat Completions chunks followed by `[DONE]`.
 *
 * `source` is SSE text or bytes, parsed events, or bare event payloads (they carry their own `type`). Text, refusal, reasoning summary and
 * argument deltas become the matching `delta` fields; a tool call starts with its `id` and name when its item is added. With
 * `reasoningRoundTrip` the encrypted reasoning arrives as one `reasoning_details` chunk when its item is done. The final usage goes out as a
 * `choices: []` chunk when `state.includeUsage` is not false. A `response.failed` or `error` event, or a stream that ends before a final
 * event, becomes an `{ error }` chunk followed by `[DONE]`.
 * @param {ReadableStream | AsyncIterable<unknown> | Iterable<unknown> | string | Uint8Array} source - Responses stream.
 * @param {any} [state] - State from the request converter (`model`, `includeUsage`; `upstreamUsage` is written to it).
 * @param {Partial<import("./settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {AsyncGenerator<{ data: any }, void, undefined>} Chat chunks.
 */
export function stream(source: ReadableStream | AsyncIterable<unknown> | Iterable<unknown> | string | Uint8Array, state?: any, settings?: Partial<import("./settings.mjs").Settings>): AsyncGenerator<{
    data: any;
}, void, undefined>;
/** Protocol name of an upstream that speaks the Responses API. */
export const PROTOCOL: "openai.responses";
/** Statuses that mean the server has no Responses API: the route is missing (404, 405) or not implemented (501). */
export const MISSING: number[];
/** `format` of the `reasoning_details` items that carry a Responses reasoning item (the encrypted content and its summary). */
export const FORMAT: "openai-responses-v1";

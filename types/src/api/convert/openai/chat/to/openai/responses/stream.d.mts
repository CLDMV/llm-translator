/**
 * Convert a Chat Completions chunk stream into Responses events.
 *
 * `source` is SSE text/bytes, an iterable of `{ data }` messages, or bare chunk objects. The result yields `{ event, data }` pairs
 * (`data.type` repeats the event name, `data.sequence_number` counts from 0): `response.created` and `response.in_progress` first, then for each output
 * item `response.output_item.added`, its part and delta events, and `response.output_item.done`, and last `response.completed` (or
 * `response.incomplete` after a length stop or a content filter). Output items come in the order the deltas start them: reasoning
 * (as a summary part), the message text (or refusal) and one function call per tool call index. An `error` chunk, a fatal finish reason or
 * a stream that ends without a finish reason ends with `response.failed`. Tool calls become `function_call` items, `custom_tool_call` items (input streamed
 * as `response.custom_tool_call_input.delta`), or for the emulated `shell` and `apply_patch` tools (`state.clientTools`) `shell_call` / `apply_patch_call`
 * items, which are sent whole when the call closes (their arguments are not streamed as text). A chunk of the hosted tool runner (`lib/hostedtools.mjs`)
 * carries `llmt_items`, the Responses items of the hosted tools it ran: they close what is open and are sent with their own events
 * (`response.web_search_call.*`, `response.code_interpreter_call.*`); `llmt_incomplete` ends the response `incomplete` with that reason. Annotations (`delta.annotations`) are sent as `response.output_text.annotation.added` events and are in the closed part. There is no `[DONE]` sentinel.
 * @param {ReadableStream|AsyncIterable<unknown>|Iterable<unknown>|string|Uint8Array} source - Chat Completions stream.
 * @param {any} state - State from the request converter (`model`, `echo`); `id` is the response id when the caller chose it, else one is made.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {AsyncGenerator<{ event: string, data: any }, void, undefined>} Responses events.
 */
export function stream(source: ReadableStream | AsyncIterable<unknown> | Iterable<unknown> | string | Uint8Array, state: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): AsyncGenerator<{
    event: string;
    data: any;
}, void, undefined>;

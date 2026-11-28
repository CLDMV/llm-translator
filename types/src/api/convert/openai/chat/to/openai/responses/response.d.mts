/**
 * Convert a (non-streaming) Chat Completions reply into a Responses object.
 *
 * The output holds, in this order, a `reasoning` item (the reply's reasoning text as one summary part, and with `reasoningRoundTrip` its
 * `reasoning_details` as `encrypted_content`), a `message` item with an `output_text` part (or a `refusal` part) and one item per tool call:
 * `function_call`, `custom_tool_call`, or for the emulated `shell` and `apply_patch` tools (`state.clientTools`) a `shell_call` / `apply_patch_call`.
 * The message's `annotations` are the `annotations` of the `output_text` part (`url_citation`, `file_citation`; see `lib/citations.mjs`). A `length`
 * stop makes the response `incomplete` with reason `max_output_tokens`, a content filter one with reason `content_filter`.
 *
 * A reply the hosted tool runner built (`lib/hostedtools.mjs`) carries `llmt_rounds`, `[{ message, hosted }]`: each upstream round's assistant message and
 * the Responses items of the hosted tools it called. Each round gives its items in the order above with its hosted items after the text, and the rounds
 * follow each other. `llmt_incomplete` is the reason of a response the runner cut off at its round limit (`incomplete` with that reason).
 * @param {any} completion - Chat Completions `chat.completion` object.
 * @param {any} state - State from the request converter (`model`, `echo`); `id` is the response id when the caller chose it, else one is made.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {any} Responses object.
 * @throws {TranslatorError} When the completion has no choices.
 */
export function response(completion: any, state: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): any;

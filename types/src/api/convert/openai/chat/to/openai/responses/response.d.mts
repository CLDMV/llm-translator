/**
 * Convert a (non-streaming) Chat Completions reply into a Responses object.
 *
 * The output holds, in this order, a `reasoning` item (the reply's reasoning text as one summary part, and with `reasoningRoundTrip` its
 * `reasoning_details` as `encrypted_content`), a `message` item with an `output_text` part (or a `refusal` part) and one `function_call`
 * item per tool call. A `length` stop makes the response `incomplete` with reason `max_output_tokens`, a content filter one with reason
 * `content_filter`.
 * @param {any} completion - Chat Completions `chat.completion` object.
 * @param {any} state - State from the request converter (`model`, `echo`).
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {any} Responses object.
 * @throws {TranslatorError} When the completion has no choices.
 */
export function response(completion: any, state: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): any;

/**
 * Convert a (non-streaming) OpenAI chat completion into an Anthropic message.
 *
 * Reasoning (`reasoning`, `reasoning_content`, or a leading `<think>` block when `thinkTags` is on, or a block closed by `</think>` when `thinkOpen` is also on) becomes a
 * `thinking` block with a translator-marked signature (which carries the provider's reasoning fields when `reasoningRoundTrip` is on). Tool calls become `tool_use` blocks; arguments that are not
 * a JSON object are passed through under `_raw_arguments` so the client reports a tool error the model can recover
 * from.
 * @param {any} completion - OpenAI `chat.completion` object.
 * @param {any} [state] - State from the request converter (original model, tool-name map).
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {any} Anthropic message.
 * @throws {TranslatorError} When the completion has no choices.
 */
export function response(completion: any, state?: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): any;

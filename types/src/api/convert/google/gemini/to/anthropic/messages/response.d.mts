/**
 * Convert a `generateContent` reply to an Anthropic message: the reply is read as a Chat Completions `chat.completion` (reasoning, tool calls with the
 * model's ids, thought signatures as `reasoning_details`, `finishReason` as `finish_reason`, `usageMetadata` as `usage`) and the Chat Completions conversion builds the message.
 * @param {any} reply - Parsed `generateContent` reply.
 * @param {any} [state] - State from the request converter.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {any} Anthropic message.
 * @throws {import("../../../../../../../lib/errors.mjs").TranslatorError} When the reply has no message or ends in a failure.
 */
export function response(reply: any, state?: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): any;

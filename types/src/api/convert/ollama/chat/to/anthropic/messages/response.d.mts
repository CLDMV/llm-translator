/**
 * Convert an Ollama reply to an Anthropic message: the reply is read as a Chat Completions `chat.completion` (thinking, tool calls with generated
 * ids, `done_reason` as `finish_reason`, the evaluation counts as `usage`) and the Chat Completions conversion builds the message.
 * @param {any} reply - Parsed Ollama reply.
 * @param {any} [state] - State from the request converter.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {any} Anthropic message.
 * @throws {import("../../../../../../../lib/errors.mjs").TranslatorError} When the reply is an error.
 */
export function response(reply: any, state?: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): any;

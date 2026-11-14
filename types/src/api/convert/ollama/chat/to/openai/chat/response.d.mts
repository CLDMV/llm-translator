/**
 * Convert an Ollama reply to a Chat Completions `chat.completion` (see `completion`). The model name is the one the client asked for, and the
 * counts are kept on the state for the usage report.
 * @param {any} reply - Parsed Ollama reply.
 * @param {any} [state] - State from the request converter.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {any} `chat.completion` object.
 * @throws {import("../../../../../../../lib/errors.mjs").TranslatorError} When the reply is an error.
 */
export function response(reply: any, state?: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): any;

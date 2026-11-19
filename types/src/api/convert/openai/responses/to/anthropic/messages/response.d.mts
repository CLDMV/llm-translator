/**
 * Convert a (non-streaming) Responses reply into an Anthropic message: read as a Chat Completions reply first, then converted from there.
 * @param {any} reply - Responses object.
 * @param {any} [state] - State from the request converter.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {any} Anthropic message.
 */
export function response(reply: any, state?: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): any;

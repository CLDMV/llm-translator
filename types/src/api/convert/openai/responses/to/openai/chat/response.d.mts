/**
 * Convert a (non-streaming) Responses reply into a Chat Completions reply. See `lib/responses-upstream.mjs` for the mapping.
 * @param {any} reply - Responses object.
 * @param {any} [state] - State from the request converter.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {any} Chat completion.
 */
export function response(reply: any, state?: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): any;

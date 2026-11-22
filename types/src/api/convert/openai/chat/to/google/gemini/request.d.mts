/**
 * Convert a Chat Completions request to a `generateContent` body (see `chatBody`). The upstream's `sampling` setting becomes further `generationConfig` fields.
 * @param {any} body - Chat Completions request body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @param {any} [context] - `{ model }`, the model the request goes to (the body's `model` is the client's name for it).
 * @returns {{body: any, state: any}} The Gemini body and the conversion state the response converters read.
 * @throws {TranslatorError} `invalid_request` when `messages` is missing.
 */
export function request(body: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>, context?: any): {
    body: any;
    state: any;
};

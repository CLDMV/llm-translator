/**
 * Convert a Chat Completions request to a Cohere body (see `chatBody`). The upstream's `sampling` setting becomes further Cohere fields.
 * @param {any} body - Chat Completions request body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {{body: any, state: any}} The Cohere body and the conversion state the response converters read.
 * @throws {TranslatorError} `invalid_request` when `messages` is missing.
 */
export function request(body: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): {
    body: any;
    state: any;
};

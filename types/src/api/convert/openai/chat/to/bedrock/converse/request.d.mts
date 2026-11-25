/**
 * Convert a Chat Completions request to a Converse body (see `chatBody`: `response_format` is sent as a tool, and reasoning with its signature in `reasoning_details` is sent back). The upstream's `sampling` setting becomes `additionalModelRequestFields`.
 * @param {any} body - Chat Completions request body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {{body: any, state: any}} The Converse body and the conversion state the response converters read.
 * @throws {TranslatorError} `invalid_request` when `messages` is missing.
 */
export function request(body: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): {
    body: any;
    state: any;
};

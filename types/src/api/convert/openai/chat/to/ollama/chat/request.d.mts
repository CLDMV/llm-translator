/**
 * Convert a Chat Completions request to an Ollama `/api/chat` body (see `chatBody`). A client may also send Ollama's own `think`, `options`,
 * `format` and `keep_alive`; they are used as sent. The upstream's `sampling` setting fills in `options` fields the request does not name.
 * @param {any} body - Chat Completions request body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {{body: any, state: any}} The Ollama body and the conversion state the response converters read.
 * @throws {TranslatorError} `invalid_request` when `messages` is missing.
 */
export function request(body: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): {
    body: any;
    state: any;
};

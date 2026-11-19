/**
 * Convert a Chat Completions request body into a Responses request body (for an OpenAI-protocol client talking to an upstream on the
 * Responses API). See `lib/responses-upstream.mjs` for the mapping.
 * @param {any} chatBody - OpenAI `POST /v1/chat/completions` body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {Promise<{ body: any, state: any }>} Responses request body and conversion state.
 * @throws {import("../../../../../../../lib/errors.mjs").TranslatorError} For malformed requests, `n` above 1 (`send` fans that out instead), unknown roles, or unknown fields when configured to error.
 */
export function request(chatBody: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>): Promise<{
    body: any;
    state: any;
}>;

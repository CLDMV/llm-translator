/**
 * Convert an Anthropic Messages request body into a Responses request body (for an Anthropic-protocol client talking to an upstream on the
 * Responses API). The request goes through the Anthropic to Chat Completions converter first, so tool search, documents, thinking,
 * reasoning round trips and every other conversion apply as they do for Chat Completions, and the result is then written as a Responses
 * body (see `lib/responses-upstream.mjs`). The state is the Chat Completions one, which the reply converters read, with the fields the
 * second step dropped added to `dropped`.
 * @param {any} body - Anthropic `POST /v1/messages` body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @param {any} [context] - See the Anthropic to Chat Completions converter.
 * @returns {Promise<{ body: any, state: any }>} Responses request body and conversion state.
 * @throws {import("../../../../../../../lib/errors.mjs").TranslatorError} As the Anthropic to Chat Completions converter, and for fields the Responses API lacks when configured to error.
 */
export function request(body: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>, context?: any): Promise<{
    body: any;
    state: any;
}>;

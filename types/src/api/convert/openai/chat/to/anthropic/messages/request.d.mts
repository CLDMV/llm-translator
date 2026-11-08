/**
 * Convert an OpenAI Chat Completions request body into an Anthropic Messages request body (for an OpenAI-protocol
 * client talking to an Anthropic-protocol upstream).
 *
 * `system` and `developer` messages are hoisted into the top-level `system`; assistant reasoning is not forwarded
 * (real Anthropic rejects thinking blocks without its own signatures); consecutive same-role turns are merged and
 * tool results are grouped into one user turn with the results first, as Anthropic requires.
 * @param {any} chatBody - OpenAI `POST /v1/chat/completions` body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @param {{ toolCallIds?: { alphabet: string, min?: number, max?: number } }} [context] - `toolCallIds` is the driver's tool-call id policy: ids that do not satisfy it are rewritten (and recorded in `state.toolIds` for the way back).
 * @returns {Promise<{ body: any, state: any }>} Anthropic request body and conversion state.
 * @throws {TranslatorError} For malformed requests, `n` above 1, unknown roles, or unknown fields when configured to error.
 */
export function request(chatBody: any, settings?: Partial<import("../../../../../../../lib/settings.mjs").Settings>, context?: {
    toolCallIds?: {
        alphabet: string;
        min?: number;
        max?: number;
    };
}): Promise<{
    body: any;
    state: any;
}>;

/**
 * A stored conversation (`GET /v1/conversations/{id}`).
 * @param {string} id - Conversation id.
 * @returns {Promise<any>} Conversation object.
 * @throws {TranslatorError} 404 `responses_disabled` when `responses` is null, 404 `conversation_not_found`.
 */
export function get(id: string): Promise<any>;

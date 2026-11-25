/**
 * Replace a conversation's `metadata` (`POST /v1/conversations/{id}`).
 * @param {string} id - Conversation id.
 * @param {{ metadata: any }} body - The request body; `metadata` is required.
 * @returns {Promise<any>} Conversation object.
 * @throws {TranslatorError} 404 `responses_disabled` when `responses` is null, 404 `conversation_not_found`, 400 for missing or bad `metadata`.
 */
export function update(id: string, body: {
    metadata: any;
}): Promise<any>;

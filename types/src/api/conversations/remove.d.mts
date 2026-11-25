/**
 * Delete a conversation and the items it holds (`DELETE /v1/conversations/{id}`).
 * @param {string} id - Conversation id.
 * @returns {Promise<{ id: string, object: "conversation.deleted", deleted: true }>} Confirmation.
 * @throws {TranslatorError} 404 `responses_disabled` when `responses` is null, 404 `conversation_not_found`.
 */
export function remove(id: string): Promise<{
    id: string;
    object: "conversation.deleted";
    deleted: true;
}>;

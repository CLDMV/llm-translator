/**
 * Delete one item of a conversation (`DELETE /v1/conversations/{id}/items/{item_id}`).
 * @param {string} id - Conversation id.
 * @param {string} itemId - Item id.
 * @returns {Promise<any>} The conversation object.
 * @throws {TranslatorError} 404 `responses_disabled` when `responses` is null, 404 `conversation_not_found` or `item_not_found`.
 */
export function remove(id: string, itemId: string): Promise<any>;

/**
 * Add 1 to 20 items to the end of a conversation (`POST /v1/conversations/{id}/items`).
 * @param {string} id - Conversation id.
 * @param {{ items: any[] }} body - The request body.
 * @returns {Promise<any>} List object of the items that were added, `{ object: "list", data, first_id, last_id, has_more }`.
 * @throws {TranslatorError} 404 `responses_disabled` when `responses` is null, 404 `conversation_not_found`, 400 for `items` that are not a list of 1 to 20, an unsupported type, an id the conversation holds, or more items than `maxItems`.
 */
export function create(id: string, body: {
    items: any[];
}): Promise<any>;

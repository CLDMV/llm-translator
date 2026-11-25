/**
 * The items of a conversation (`GET /v1/conversations/{id}/items`). Newest first unless `order` is `asc`; `limit` is 1 to 100 (default 20); `after`
 * and `before` take an item id. `include` is accepted and has no effect.
 * @param {string} id - Conversation id.
 * @param {{ limit?: any, order?: string, after?: string, before?: string }} [query] - Query parameters as the client sent them.
 * @returns {Promise<any>} List object `{ object: "list", data, first_id, last_id, has_more }`.
 * @throws {TranslatorError} 404 `responses_disabled` when `responses` is null, 404 `conversation_not_found` or `item_not_found`, 400 for a bad `limit` or `order`.
 */
export function list(id: string, query?: {
    limit?: any;
    order?: string;
    after?: string;
    before?: string;
}): Promise<any>;

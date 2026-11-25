/**
 * Delete a stored response (`DELETE /v1/responses/{id}`). A background response still running is cancelled first. A conversation keeps the items the
 * response added to it.
 * @param {string} id - Response id.
 * @returns {Promise<{ id: string, object: "response.deleted", deleted: true }>} Confirmation.
 * @throws {TranslatorError} 404 `responses_disabled` when `responses` is null, 404 `response_not_found`.
 */
export function remove(id: string): Promise<{
    id: string;
    object: "response.deleted";
    deleted: true;
}>;

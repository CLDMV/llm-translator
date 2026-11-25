/**
 * A stored response (`GET /v1/responses/{id}`): the response object as it was returned, or for a background response still running its current
 * status (`queued` or `in_progress`). `include` is accepted and has no effect.
 * @param {string} id - Response id.
 * @returns {Promise<any>} Response object.
 * @throws {TranslatorError} 404 `responses_disabled` when `responses` is null, 404 `response_not_found` for an unknown, deleted, evicted or expired id (and for a response made with `store: false`).
 */
export function get(id: string): Promise<any>;

/**
 * Cancel a background response (`POST /v1/responses/{id}/cancel`): the upstream request is aborted and the response is kept with the status
 * `cancelled` and no output. A response that already finished (or was cancelled before) is returned as it is.
 * @param {string} id - Response id.
 * @returns {Promise<any>} Response object.
 * @throws {TranslatorError} 404 `responses_disabled` when `responses` is null, 404 `response_not_found`, 400 `not_background` for a response that was not made with `background: true`.
 */
export function cancel(id: string): Promise<any>;

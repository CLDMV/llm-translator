/**
 * Delete a stored file (`DELETE /v1/files/{id}`) and return the front's confirmation: Anthropic `{ id, type: "file_deleted" }`, OpenAI
 * `{ id, object: "file", deleted: true }`.
 * @param {string} id - File id.
 * @param {any} [options] - `{ front }`.
 * @returns {Promise<any>} Confirmation.
 * @throws {TranslatorError} 404 `files_disabled` when `files` is null, 404 `file_not_found` for an unknown or expired id.
 */
export function remove(id: string, options?: any): Promise<any>;

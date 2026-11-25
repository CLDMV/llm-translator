/**
 * The file object of a stored file, in the client protocol's shape.
 * @param {string} id - File id.
 * @param {any} [options] - `{ front, beta }`.
 * @returns {Promise<any>} File object.
 * @throws {TranslatorError} 404 `files_disabled` when `files` is null, 404 `file_not_found` for an unknown or expired id.
 */
export function get(id: string, options?: any): Promise<any>;

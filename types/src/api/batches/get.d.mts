/**
 * The batch object of a batch, in the client protocol's shape. A batch made through the other front is not found.
 * @param {string} id - Batch id.
 * @param {any} [options] - `{ front, base }`.
 * @returns {Promise<any>} Batch object.
 * @throws {TranslatorError} 404 `batches_disabled` when `batches` is null, 404 `batch_not_found` for an unknown or expired id.
 */
export function get(id: string, options?: any): Promise<any>;

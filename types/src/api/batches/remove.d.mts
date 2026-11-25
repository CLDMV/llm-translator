/**
 * Delete a batch that has ended (`DELETE /v1/messages/batches/{id}`) and answer with the front's confirmation: Anthropic `{ id, type: "message_batch_deleted" }`,
 * OpenAI `{ id, object: "batch", deleted: true }`. OpenAI has no such route; the leaf is there for code that uses the api directly.
 * @param {string} id - Batch id.
 * @param {any} [options] - `{ front }`.
 * @returns {Promise<any>} Confirmation.
 * @throws {TranslatorError} 404 `batches_disabled` / `batch_not_found`, 400 `batch_in_progress` when the batch has not ended.
 */
export function remove(id: string, options?: any): Promise<any>;

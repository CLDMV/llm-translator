/**
 * Cancel a batch that has not ended. It becomes `cancelling` (Message Batches: `canceling`) at once, its requests in flight are aborted and the ones that
 * did not run are ended as cancelled (a `canceled` result, or a `batch_cancelled` line in the error file), then the batch is `cancelled` (`ended`). The
 * requests that finished keep their results. Cancelling a batch that is already cancelling answers it as it is.
 * @param {string} id - Batch id.
 * @param {any} [options] - `{ front, base }`.
 * @returns {Promise<any>} Batch object.
 * @throws {TranslatorError} 404 `batches_disabled` / `batch_not_found`, 409 `batch_ended` (OpenAI) or 400 `batch_ended` (Anthropic) when the batch has ended.
 */
export function cancel(id: string, options?: any): Promise<any>;

/**
 * The results of a message batch that has ended, as JSON lines (`{ custom_id, result }`, `result.type` is `succeeded`, `errored`, `canceled` or `expired`),
 * in request order. OpenAI batches have no such endpoint: their results are the files `output_file_id` and `error_file_id` name.
 * @param {string} id - Batch id.
 * @param {any} [options] - `{ front }`.
 * @returns {Promise<string>} The JSON lines.
 * @throws {TranslatorError} 404 `batches_disabled` / `batch_not_found`, 400 `batch_in_progress` when the batch has not ended, 404 `no_results_endpoint` on the OpenAI front.
 */
export function results(id: string, options?: any): Promise<string>;

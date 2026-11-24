/**
 * Create a batch and start running it in the background, answering with the batch object in the client protocol's shape. Both fronts run the batch's
 * requests through the normal request path, so every upstream and conversion works, with at most `batches.concurrency` requests in flight (across all
 * batches). Anthropic: `{ requests: [{ custom_id, params }] }`, answered with a message batch (`processing_status: "in_progress"`). OpenAI:
 * `{ input_file_id, endpoint, completion_window: "24h", metadata, output_expires_after }` where the input is a stored file of purpose `batch` (JSON
 * lines of `{ custom_id, method: "POST", url, body }`) and `endpoint` is `/v1/chat/completions`, `/v1/responses` or `/v1/embeddings`; the batch answers
 * `validating`, and the results land in files of purpose `batch_output` and `batch_error`.
 * @param {any} input - The request body.
 * @param {any} [options] - `{ front, base }`; `base` is the origin (`https://host`) a message batch's `results_url` is built on.
 * @returns {Promise<any>} Batch object.
 * @throws {TranslatorError} 404 `batches_disabled` when `batches` is null, 400 for an invalid body or input file, 400 `storage_limit_exceeded`.
 */
export function create(input: any, options?: any): Promise<any>;

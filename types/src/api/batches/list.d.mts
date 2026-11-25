/**
 * List the batches made through the front, newest first, in the client protocol's list shape. Anthropic: `{ data, has_more, first_id, last_id }` with
 * `limit` (default 20, at most 1000), `before_id` and `after_id`. OpenAI: `{ object: "list", data, first_id, last_id, has_more }` with `limit` (default 20,
 * at most 100) and `after`.
 * @param {any} [query] - Query parameters as the client sent them.
 * @param {any} [options] - `{ front, base }`.
 * @returns {Promise<any>} List.
 * @throws {TranslatorError} 404 `batches_disabled` when `batches` is null; 400 for a bad parameter.
 */
export function list(query?: any, options?: any): Promise<any>;

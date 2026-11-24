/**
 * List the stored files, newest first, in the client protocol's list shape. Anthropic: `{ data, next_page }` paged with `page` (or up to 100 `ids`), or with
 * `beta: true` `{ data, has_more, first_id, last_id }` paged with `before_id` and `after_id`; `limit` defaults to 20 (at most 1000). OpenAI:
 * `{ object: "list", data, first_id, last_id, has_more }` with `purpose`, `limit` (default and most 10000), `after` and `order`.
 * @param {any} [query] - Query parameters as the client sent them.
 * @param {any} [options] - `{ front, beta }`.
 * @returns {Promise<any>} List.
 * @throws {TranslatorError} 404 `files_disabled` when `files` is null; 400 for a bad parameter.
 */
export function list(query?: any, options?: any): Promise<any>;

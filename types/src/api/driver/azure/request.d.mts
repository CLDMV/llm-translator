/**
 * Drop tool fields Azure rejects when no tools are present, and send `max_tokens` when the upstream pins an `api-version` older than the one
 * that introduced `max_completion_tokens`. Versions that are not dated (`preview`, `latest`) and the v1 API keep `max_completion_tokens`.
 * @param {any} body - Chat Completions request body.
 * @param {any} [context] - `{ endpoint }`.
 * @returns {any} Normalized body.
 */
export function request(body: any, context?: any): any;

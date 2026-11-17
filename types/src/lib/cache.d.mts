/**
 * Is a salt or key value usable?
 * @param {any} value - Setting or request value.
 * @returns {boolean} True for a non-empty string, or an absent value.
 */
export function valid(value: any): boolean;
/**
 * Add the cache hints to an OpenAI-protocol body.
 *
 * - `cache_salt` comes only from trusted places: the `cacheSalt` call option (the server passes the `authorize` hook's `cacheSalt`) or the upstream's `cacheSalt` setting,
 *   in that order. It always replaces a `cache_salt` the body carries, so a client cannot choose its own tenant. A backend without the feature
 *   follows `unknownFields`: dropped (listed in `dropped`) or rejected.
 * - `prompt_cache_key` comes from the client (`metadata.prompt_cache_key` on the Anthropic front; the OpenAI front's own field is kept) or the upstream's `promptCacheKey` setting. A
 *   key the body already carries wins over the setting.
 * @param {any} body - Converted or forwarded Chat Completions body.
 * @param {{ salt?: any, key?: any }} asked - The call's `cacheSalt` option and the request's prompt cache key.
 * @param {any} settings - Resolved settings (`cacheSalt`, `promptCacheKey`, `unknownFields`).
 * @param {string} driver - Driver name of the upstream.
 * @param {string[]} [dropped] - Receives the names that were left out.
 * @returns {any} The body, with the fields added (a copy when anything was added).
 * @throws {TranslatorError} `invalid_request` for a malformed salt or key; `unsupported_field` when the backend lacks the feature and `unknownFields` is `"error"`.
 */
export function addCache(body: any, asked: {
    salt?: any;
    key?: any;
}, settings: any, driver: string, dropped?: string[]): any;
/** Drivers whose servers take `cache_salt` (vLLM's per-tenant prefix-cache isolation). */
export const SALT_DRIVERS: string[];
/** Drivers whose servers take `prompt_cache_key` (OpenAI's cache routing hint). */
export const KEY_DRIVERS: string[];

/**
 * Make a request use a cached content of the Gemini API (`POST /v1beta/cachedContents`), or leave it whole when one cannot be made.
 * @param {any} context - `{ endpoint, model, cache, body, headers, transport, timeout, warn }`: the plan the converter made for the request's `cache_control` breakpoint, and the body and headers about to be sent.
 * @returns {Promise<any>} The body to send.
 */
export function cache({ endpoint, model, cache: plan, body, headers, transport, timeout, warn }: any): Promise<any>;

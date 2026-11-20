/**
 * Add the Google access token as the bearer token and drop the headers Vertex AI does not take (`x-api-key`, `anthropic-version`; a client's
 * `anthropic-beta` is kept). The token comes from `lib/google-auth.mjs`.
 * @param {any} context - `{ endpoint, headers, transport, timeout }`.
 * @returns {Promise<Record<string,string>>} Headers to send.
 */
export function auth({ endpoint, headers, transport, timeout }: any): Promise<Record<string, string>>;

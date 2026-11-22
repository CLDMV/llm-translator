/**
 * Authenticate a call. The native `generateContent` API takes the API key in the `x-goog-api-key` header, not as a bearer token (which is what
 * the OpenAI-compatible endpoint takes), so a native call has the bearer header the key made replaced by it. Any other call is unchanged.
 * @param {any} context - `{ endpoint, protocol, headers }`.
 * @returns {Record<string, string>} The headers to send.
 */
export function sign({ endpoint, protocol, headers }: any): Record<string, string>;

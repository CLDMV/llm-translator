/**
 * Authenticate a call: a Bedrock API key (the upstream's `apiKey` or `AWS_BEARER_TOKEN_BEDROCK`) is sent as a bearer token, and otherwise the
 * call is signed with SigV4 from the upstream's access keys or the `AWS_*` environment variables (see `lib/bedrock`). The signature covers the
 * exact JSON text of the body, which is what the transport sends.
 * @param {any} context - `{ endpoint, method, url, headers, body, stream }`.
 * @returns {Record<string, string>} The headers to send.
 * @throws {import("../../../lib/errors.mjs").TranslatorError} `missing_credentials` or `missing_region` (500).
 */
export function sign({ endpoint, method, url, headers, body, stream }: any): Record<string, string>;

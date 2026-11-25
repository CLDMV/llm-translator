/**
 * Authenticate a call: a Bedrock API key (the upstream's `apiKey` or `AWS_BEARER_TOKEN_BEDROCK`) is sent as a bearer token, and otherwise the
 * call is signed with SigV4 from the upstream's access keys, the `AWS_*` environment variables or the AWS credential chain (see `lib/bedrock`). The signature covers the
 * exact JSON text of the body, which is what the transport sends.
 * The `anthropic-beta` and `anthropic-version` headers of a client are not sent: InvokeModel takes both in the body (`anthropic_beta`, `anthropic_version`; see the `request` leaf).
 * @param {any} context - `{ endpoint, method, url, headers, body, stream, transport, timeout, signal }`; the last three are for the credential lookups of the AWS chain.
 * @returns {Promise<Record<string, string>>} The headers to send.
 * @throws {import("../../../lib/errors.mjs").TranslatorError} `missing_credentials` or `missing_region` (500).
 */
export function sign({ endpoint, method, url, headers, body, stream, transport, timeout, signal }: any): Promise<Record<string, string>>;

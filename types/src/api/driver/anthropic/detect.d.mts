/**
 * Match `api.anthropic.com` by host name with no request. Any other host is asked for `GET /v1/models` with the Anthropic headers
 * (`anthropic-version`, `x-api-key` from the upstream's key) and matches only when the answer is an Anthropic-shaped model list.
 * The request is part of the batch started at the first probing driver, so it adds no round trip. A server that needs a key and was
 * given none answers 401 and is not matched; give it the key or set `backend: "anthropic"`.
 * @param {any} context - `{ endpoint, transport, signal, timeout, probes }`.
 * @returns {Promise<{host: string} | {models: string[]} | null>} Facts, or null when the endpoint is not an Anthropic-protocol server.
 */
export function detect(context: any): Promise<{
    host: string;
} | {
    models: string[];
} | null>;

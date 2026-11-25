/**
 * Count tokens with `POST /model/<model>/count-tokens`. A Converse request is counted as `input.converse` (its messages, system prompt, tools and
 * model fields), and an InvokeModel request as `input.invokeModel` with the exact body that would be sent, base64 encoded. The call is
 * authenticated like every Bedrock call. Any failure (a model `CountTokens` does not serve, a missing permission, no credentials, a network
 * error) gives null, so the caller uses the estimate.
 * @param {any} context - `{ endpoint, request, path, state, transport, signal, timeout }`; `path` is the path of the call the request would make.
 * @returns {Promise<number | null>} Token count, or null when Bedrock did not answer.
 */
export function count({ endpoint, request, path, state, transport, signal, timeout }: any): Promise<number | null>;

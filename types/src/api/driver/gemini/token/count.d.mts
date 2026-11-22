/**
 * Count tokens with `POST /v1beta/models/<model>:countTokens` for an upstream on the native API. The prompt is the `generateContent` body the
 * request would send. Any failure (an upstream on the OpenAI-compatible endpoint, a rejected key, a network error) gives null, so the caller uses the estimate.
 * @param {any} context - `{ endpoint, request, path, state, transport, signal, timeout }`; `path` is the path of the call the request would make.
 * @returns {Promise<number | null>} Token count, or null when Gemini did not answer.
 */
export function count({ endpoint, request, path, state, transport, signal, timeout }: any): Promise<number | null>;

/**
 * Count tokens with `POST .../publishers/anthropic/models/count-tokens:rawPredict`, which takes the model in the body, or, for a request on the
 * `google.gemini` protocol, with `POST .../publishers/google/models/<model>:countTokens` and the prompt as `contents`, `systemInstruction` and `tools`. Any failure (a missing
 * project or credentials, a 404 from a region or project without the method, a network error) gives null, so the caller uses the estimate.
 * @param {any} context - `{ endpoint, request, path, state, transport, signal, timeout }`; `path` is the path of the call the request would make.
 * @returns {Promise<number | null>} Token count, or null when Vertex AI did not answer.
 */
export function count({ endpoint, request, path, state, transport, signal, timeout }: any): Promise<number | null>;

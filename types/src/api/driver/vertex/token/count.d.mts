/**
 * Count tokens with `POST .../publishers/anthropic/models/count-tokens:rawPredict`, which takes the model in the body. Any failure (a missing
 * project or credentials, a 404 from a region or project without the method, a network error) gives null, so the caller uses the estimate.
 * @param {any} context - `{ endpoint, request, transport, signal, timeout }`.
 * @returns {Promise<number | null>} Token count, or null when Vertex AI did not answer.
 */
export function count({ endpoint, request, transport, signal, timeout }: any): Promise<number | null>;

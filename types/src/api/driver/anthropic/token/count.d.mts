/**
 * Count tokens with the Anthropic API.
 * @param {any} context - `{ endpoint, request, transport, signal, timeout }`.
 * @returns {Promise<number | null>} Token count, or null when the API did not answer.
 */
export function count({ endpoint, request, transport, signal, timeout }: any): Promise<number | null>;

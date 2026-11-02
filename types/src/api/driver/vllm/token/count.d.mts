/**
 * Count the prompt tokens of a converted Chat Completions request with the server's own tokenizer and chat template.
 * @param {any} context - `{ endpoint, request, transport, signal, timeout }`.
 * @returns {Promise<number | null>} Token count, or null when the server did not answer (caller falls back to an estimate).
 */
export function count({ endpoint, request, transport, signal, timeout }: any): Promise<number | null>;

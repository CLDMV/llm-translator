/**
 * List the models the vLLM server serves (including `max_model_len`).
 * @param {any} context - `{ endpoint, transport, signal, timeout }`.
 * @returns {Promise<any[] | null>} Models, or null when unreachable.
 */
export function list(context: any): Promise<any[] | null>;

/**
 * List the models the Anthropic API reports.
 * @param {any} context - `{ endpoint, transport, signal, timeout }`.
 * @returns {Promise<any[] | null>} Models, or null when unreachable.
 */
export function list(context: any): Promise<any[] | null>;

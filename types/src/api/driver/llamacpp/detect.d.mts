/**
 * Probe an endpoint for `llama-server`.
 * @param {any} context - `{ endpoint, transport, signal, timeout, probes }`.
 * @returns {Promise<any | null>} Facts `{ models, build, vision }`, or null when the endpoint is not llama-server.
 */
export function detect(context: any): Promise<any | null>;

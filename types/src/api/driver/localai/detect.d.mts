/**
 * Probe an endpoint for LocalAI.
 * @param {any} context - `{ endpoint, transport, signal, timeout, probes }`.
 * @returns {Promise<any | null>} Facts `{ version, models }`, or null when the endpoint is not LocalAI.
 */
export function detect(context: any): Promise<any | null>;

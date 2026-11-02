/**
 * Probe an endpoint for Ollama.
 * @param {any} context - `{ endpoint, transport, signal, timeout, probes }`.
 * @returns {Promise<any | null>} Facts `{ version, models }`, or null when the endpoint is not Ollama.
 */
export function detect(context: any): Promise<any | null>;

/**
 * Probe an endpoint for vLLM.
 * @param {any} context - `{ endpoint, transport, signal, timeout, probes }`.
 * @returns {Promise<any | null>} Facts `{ version, models, maxModelLen }`, or null when the endpoint is not vLLM (or is SGLang or llama.cpp, which also answer `/version`).
 */
export function detect({ endpoint, transport, signal, timeout, probes }: any): Promise<any | null>;

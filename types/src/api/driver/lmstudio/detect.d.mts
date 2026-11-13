/**
 * Probe an endpoint for LM Studio.
 * @param {any} context - `{ endpoint, transport, signal, timeout, probes }`.
 * @returns {Promise<any | null>} Facts `{ models, loaded }` (ids of chat models, and of those currently loaded), or null when the endpoint is not LM Studio.
 */
export function detect(context: any): Promise<any | null>;

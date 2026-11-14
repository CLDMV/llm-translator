/**
 * Probe an endpoint for Text Generation Inference.
 * @param {any} context - `{ endpoint, transport, signal, timeout, probes }`.
 * @returns {Promise<any | null>} Facts `{ version, model, maxInputTokens, maxTotalTokens }`, or null when the endpoint is not TGI.
 */
export function detect(context: any): Promise<any | null>;

/**
 * Probe an endpoint for SGLang.
 * @param {any} context - `{ endpoint, transport, signal, timeout, probes }`.
 * @returns {Promise<any | null>} Facts `{ version, models, modelPath, reasoningParser, toolCallParser }`, or null when the endpoint is not SGLang.
 */
export function detect(context: any): Promise<any | null>;

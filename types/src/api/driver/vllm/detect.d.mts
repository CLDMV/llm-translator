/**
 * Probe an endpoint for vLLM.
 * @param {any} context - `{ endpoint, transport, signal, timeout, probes }`.
 * @returns {Promise<any | null>} Facts `{ version, models, adapters, maxModelLen }` (`models` lists the base models and the LoRA adapters, `adapters` the adapters alone as `{ id, parent }`, taken from the entries whose `parent` names the base model), or null when the endpoint is not vLLM (or is LocalAI, SGLang, llama.cpp or TGI, which can also answer `/version`).
 */
export function detect({ endpoint, transport, signal, timeout, probes }: any): Promise<any | null>;

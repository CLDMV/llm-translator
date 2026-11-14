/**
 * List the models the vLLM server serves (including `max_model_len`, and `parent` on a LoRA adapter). What the server answers is also what the
 * upstream serves from now on: adapters loaded at runtime (`/v1/load_lora_adapter`) become routable, and unloaded ones stop being. An upstream
 * with a configured `models` list keeps that list.
 * @param {any} context - `{ endpoint, transport, signal, timeout }`.
 * @returns {Promise<any[] | null>} Models, or null when unreachable.
 */
export function list(context: any): Promise<any[] | null>;

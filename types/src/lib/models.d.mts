/**
 * The usable entries of a `/v1/models` reply.
 * @param {{ok: boolean, body: any}} result - Outcome of the request.
 * @returns {{id: string, created?: number, owned_by?: string, max_model_len?: number}[] | null} Models, or null when the reply is not a model list.
 */
export function modelsOf(result: {
    ok: boolean;
    body: any;
}): {
    id: string;
    created?: number;
    owned_by?: string;
    max_model_len?: number;
}[] | null;
/**
 * The LoRA adapters in a `/v1/models` list: vLLM lists each one as a model whose `parent` is the base model it adapts (`--lora-modules`, or
 * `/v1/load_lora_adapter` when `VLLM_ALLOW_RUNTIME_LORA_UPDATING` is on); base models have no `parent`.
 * @param {any[]} models - Entries of the model list.
 * @returns {{id: string, parent: string}[]} The adapters.
 */
export function adaptersOf(models: any[]): {
    id: string;
    parent: string;
}[];
/**
 * The model ids an endpoint serves that are not LoRA adapters (all of them for a driver that detects none).
 * @param {any} endpoint - Runtime endpoint.
 * @returns {string[]} Configured or detected model ids, adapters left out.
 */
export function baseModels(endpoint: any): string[];
/**
 * The entries a model list shows for an endpoint when the server was not asked: its configured or detected ids, an adapter with its `parent`.
 * @param {any} endpoint - Runtime endpoint.
 * @returns {{id: string, parent?: string}[]} Entries.
 */
export function knownModels(endpoint: any): {
    id: string;
    parent?: string;
}[];
/**
 * Fetch and normalize the models an upstream reports.
 * @param {any} context - `{ endpoint, transport, signal, timeout, auth, extraHeaders, path }`. `path` replaces `/v1/models`.
 * @returns {Promise<{id: string, created?: number, owned_by?: string, max_model_len?: number}[] | null>} Models, or null when the upstream did not answer with a model list.
 */
export function fetchModels({ endpoint, transport, signal, timeout, auth, extraHeaders, path }: any): Promise<{
    id: string;
    created?: number;
    owned_by?: string;
    max_model_len?: number;
}[] | null>;

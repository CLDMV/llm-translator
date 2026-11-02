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
 * Fetch and normalize the models an upstream reports.
 * @param {any} context - `{ endpoint, transport, signal, timeout, auth, extraHeaders }`.
 * @returns {Promise<{id: string, created?: number, owned_by?: string, max_model_len?: number}[] | null>} Models, or null when the upstream did not answer with a model list.
 */
export function fetchModels({ endpoint, transport, signal, timeout, auth, extraHeaders }: any): Promise<{
    id: string;
    created?: number;
    owned_by?: string;
    max_model_len?: number;
}[] | null>;

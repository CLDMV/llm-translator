/**
 * List the models that serve chat (`GET /v1/models?endpoint=chat`), following `next_page_token`. Cohere's own shape (`models[].name`,
 * `context_length`) is mapped to the translator's list entries.
 * @param {any} context - `{ endpoint, transport, signal, timeout }`.
 * @returns {Promise<{id: string, owned_by: string, max_model_len?: number}[] | null>} Models, or null when unreachable, not authenticated or not a model list.
 */
export function list({ endpoint, transport, signal, timeout }: any): Promise<{
    id: string;
    owned_by: string;
    max_model_len?: number;
}[] | null>;

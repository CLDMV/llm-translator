/**
 * List the models of an upstream on the native API (`GET /v1beta/models`, every page, with the `models/` prefix taken off the names). Only models
 * that can `generateContent` are listed. An upstream on the OpenAI-compatible endpoint is not asked here (null: its configured models are shown).
 * @param {any} context - `{ endpoint, transport, signal, timeout }`.
 * @returns {Promise<{id: string, owned_by: string, max_model_len?: number}[] | null>} Models, or null when the upstream is not on the native API, not reachable or did not answer with a model list.
 */
export function list({ endpoint, transport, signal, timeout }: any): Promise<{
    id: string;
    owned_by: string;
    max_model_len?: number;
}[] | null>;

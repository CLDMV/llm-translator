/**
 * List the foundation models Bedrock reports for the region (`GET /foundation-models` on the control plane, signed like every call). Models that
 * do not produce text are left out. Inference profiles (`us.anthropic.claude-...`, which many models need instead of the bare id) are not
 * listed; name them in the upstream's `models`.
 * @param {any} context - `{ endpoint, transport, signal, timeout }`.
 * @returns {Promise<{id: string, owned_by: string}[] | null>} Models, or null when unreachable, not authenticated or not a model list.
 */
export function list({ endpoint, transport, signal, timeout }: any): Promise<{
    id: string;
    owned_by: string;
}[] | null>;

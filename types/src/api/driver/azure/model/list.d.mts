/**
 * List the models the Azure OpenAI resource reports (`/openai/v1/models`, or `/openai/models?api-version=...` with the classic URLs). Azure lists
 * base models there, not the resource's deployments, so an upstream that serves deployments should set `models`.
 * @param {any} context - `{ endpoint, transport, signal, timeout }`.
 * @returns {Promise<any[] | null>} Models, or null when unreachable or not a model list.
 */
export function list(context: any): Promise<any[] | null>;

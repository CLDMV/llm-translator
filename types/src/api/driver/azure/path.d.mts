/**
 * Build the path of a call from the upstream's `apiVersion` and `deployment` (see `lib/azure.mjs`).
 * @param {"chat" | "embeddings" | "models"} kind - Which call.
 * @param {any} context - `{ endpoint, model }`.
 * @returns {string} Path with the `api-version` query when the classic URLs are in use.
 */
export function path(kind: "chat" | "embeddings" | "models", { endpoint, model }: any): string;

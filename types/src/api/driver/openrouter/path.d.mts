/**
 * Put the calls under `/api`, so the upstream can be given as `https://openrouter.ai` or `https://openrouter.ai/api` (a trailing `/v1` is removed
 * by the config).
 * @param {"chat" | "embeddings" | "models"} kind - Which call.
 * @param {any} context - `{ endpoint }`.
 * @returns {string} Path starting with `/`.
 */
export function path(kind: "chat" | "embeddings" | "models", { endpoint }: any): string;

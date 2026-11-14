/**
 * Put the calls under the provider's path root, unless the upstream URL already ends in it.
 * @param {"chat" | "embeddings" | "models"} kind - Which call.
 * @param {any} context - `{ endpoint }`.
 * @returns {string} Path starting with `/`.
 */
export function path(kind: "chat" | "embeddings" | "models", { endpoint }: any): string;

/**
 * Build the path of a call. A chat request over `cohere.chat` is `/v2/chat`; the rest go through the Compatibility API (`/compatibility/v1/...`,
 * unless the upstream URL already ends in `/compatibility`), except the model list, which is Cohere's own `/v1/models`.
 * @param {"chat" | "embeddings" | "models"} kind - Which call.
 * @param {any} context - `{ endpoint, protocol }`.
 * @returns {string} Path starting with `/`.
 */
export function path(kind: "chat" | "embeddings" | "models", { endpoint, protocol }: any): string;

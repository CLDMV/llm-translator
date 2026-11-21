/**
 * Put the calls under the provider's path root, unless the upstream URL already ends in it. A native call (`kind` `gemini`) is
 * `models/<model>:generateContent`, or `:streamGenerateContent?alt=sse` for a stream, under `/v1beta`.
 * @param {"chat" | "gemini" | "embeddings" | "models"} kind - Which call.
 * @param {any} context - `{ endpoint, model, protocol, stream }`.
 * @returns {string} Path starting with `/`.
 */
export function path(kind: "chat" | "gemini" | "embeddings" | "models", { endpoint, model, protocol, stream }: any): string;

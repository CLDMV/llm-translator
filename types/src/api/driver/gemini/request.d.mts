/**
 * Drop tool fields when there are no tools, and the fields Gemini (OpenAI-compatible endpoint) rejects (each recorded in `state.dropped`).
 * @param {any} body - Chat Completions request body.
 * @param {any} [context] - `{ state }`.
 * @returns {any} Normalized body.
 */
export function request(body: any, context?: any): any;

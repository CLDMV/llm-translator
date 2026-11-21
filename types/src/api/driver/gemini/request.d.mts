/**
 * Drop tool fields when there are no tools, and the fields Gemini (OpenAI-compatible endpoint) rejects (each recorded in `state.dropped`). A
 * native `generateContent` body loses `model` and `stream` instead: the URL carries both, and the API rejects fields it does not know.
 * @param {any} body - Chat Completions or `generateContent` request body.
 * @param {any} [context] - `{ state, protocol }`.
 * @returns {any} Normalized body.
 */
export function request(body: any, context?: any): any;

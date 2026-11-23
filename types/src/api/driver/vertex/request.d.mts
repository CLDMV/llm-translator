/**
 * Add `anthropic_version` and take the model out of the body: Vertex AI names the model in the URL. A `generateContent` body has no version, and
 * loses `model` and `stream` (the URL carries both, and the API rejects fields it does not know).
 * @param {any} request - Messages or `generateContent` request body.
 * @param {any} [context] - `{ protocol }`.
 * @returns {any} Vertex AI body.
 */
export function request(request: any, context?: any): any;

/**
 * Normalize an error of the native `generateContent` API (Google's `{ error: { code, message, status } }` envelope, which becomes the nested
 * shape with the status, for example `INVALID_ARGUMENT`, as the code). An error of the OpenAI-compatible endpoint is left as it is.
 * @param {number} status - HTTP status.
 * @param {*} body - Parsed upstream error body.
 * @param {any} [context] - `{ state }`, the state returned by `request`.
 * @returns {*} Error body.
 */
export function error(status: number, body: any, context?: any): any;

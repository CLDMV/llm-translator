/**
 * Flatten typed content chunks: a reasoning model answers with `content` as a list of `text` and `thinking` chunks. The text becomes the
 * string `content` and the thinking becomes `reasoning_content`.
 * @param {any} body - Chat Completions response body.
 * @returns {any} Normalized body.
 */
export function response(body: any): any;

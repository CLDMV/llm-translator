/**
 * Normalize a streamed chunk: drop the duplicate reasoning block of `deepseek-legacy` and give tool calls without an id one.
 * @param {any} chunk - Parsed `chat.completion.chunk`.
 * @param {any} [ctx] - `{ state }`.
 * @returns {any} Normalized chunk.
 */
export function chunk(chunk: any, ctx?: any): any;

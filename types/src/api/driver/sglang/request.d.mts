/**
 * Drop tool fields when there are no tools, and ask for reasoning to be returned separately (`separate_reasoning: true`) when the server
 * was started with a `--reasoning-parser`. The client's own `separate_reasoning` always wins.
 * @param {any} body - Chat Completions request body.
 * @param {any} [ctx] - `{ endpoint }`.
 * @returns {any} Normalized body.
 */
export function request(body: any, ctx?: any): any;

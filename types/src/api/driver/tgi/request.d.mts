/**
 * Drop tool fields when there are no tools; fold a client's `grammar` into `response_format` (the chat endpoint reads a grammar only
 * there) and rewrite `response_format` into TGI's shape; and drop `response_format` when the request also has tools, which TGI refuses
 * (the tools win, and the drop is recorded in `state.dropped`).
 * @param {any} body - Chat Completions request body.
 * @param {any} [ctx] - `{ state }`.
 * @returns {any} Normalized body.
 */
export function request(body: any, ctx?: any): any;

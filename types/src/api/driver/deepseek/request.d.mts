/**
 * Drop tool fields when there are no tools. In thinking mode also remove what DeepSeek rejects there: `tool_choice` of `required` or a named
 * function (`auto` and `none` stay) and `logprobs`/`top_logprobs`; each removal is recorded in `state.dropped`.
 * @param {any} body - Chat Completions request body.
 * @param {any} [ctx] - `{ state }`.
 * @returns {any} Normalized body.
 */
export function request(body: any, ctx?: any): any;

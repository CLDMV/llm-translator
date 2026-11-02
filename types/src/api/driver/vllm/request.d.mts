/**
 * Drop tool fields vLLM rejects when no tools are present, and clamp `reasoning_effort` to what vLLM accepts
 * (`xhigh` and `max` become `high`) unless the `effortPassthrough` setting is on.
 * @param {any} body - Chat Completions request body.
 * @param {any} [ctx] - `{ settings }`.
 * @returns {any} Normalized body.
 */
export function request(body: any, ctx?: any): any;

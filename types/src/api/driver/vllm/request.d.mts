/**
 * Drop tool fields vLLM rejects when no tools are present, and clamp `reasoning_effort` to what vLLM accepts
 * (`xhigh` and `max` become `high`) unless the `effortPassthrough` setting is on or the model has a configured level list (`ctx.levels`,
 * which `request` has already fitted the effort to).
 * @param {any} body - Chat Completions request body.
 * @param {any} [ctx] - `{ settings, levels }`.
 * @returns {any} Normalized body.
 */
export function request(body: any, ctx?: any): any;

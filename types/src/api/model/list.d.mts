/**
 * List the models the upstreams serve (live when the driver can, else detection/config data), plus the configured aliases,
 * in the client protocol's list shape (Anthropic `{data:[{type:"model",...}]}` or OpenAI `{object:"list",data:[...]}`).
 * @param {any} [options] - `{ signal, front }`.
 * @returns {Promise<any>} Model list.
 */
export function list(options?: any): Promise<any>;

/**
 * Probe every upstream whose driver names a health path (vLLM: `GET /health`) right away, whatever `pool.healthInterval` says, and return the
 * pool status. `send` already does this before it routes a request to a model that has more than one endpoint; call this to refresh the
 * `ready` field of `endpoint.status()` and `status()` for a lone upstream, or on a schedule of your own.
 * @param {any} [options] - `{ signal }`.
 * @returns {Promise<any>} The `endpoint.status()` result.
 */
export function check(options?: any): Promise<any>;

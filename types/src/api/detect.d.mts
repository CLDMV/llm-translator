/**
 * Bind every endpoint to a driver. `backend: "auto"` endpoints are probed (drivers tried in `info().order`, the generic
 * driver matches last); endpoints with an explicit `backend` skip detection. Call it again to re-probe.
 * @param {any} [options] - `{ network, signal }`. `network: false` skips all probing (auto endpoints fall back to the generic driver).
 * @returns {Promise<any>} The `status()` result.
 */
export function detect(options?: any): Promise<any>;

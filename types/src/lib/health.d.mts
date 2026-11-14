/**
 * Probe the endpoints that name a health path and whose last verdict is older than `pool.healthInterval` (all of them with `force`). A request
 * that was answered counts as a verdict too, so an endpoint that is serving is not probed. Probes run in parallel, and requests that arrive
 * while one is running share it.
 * @param {any} c - Captured translator parts (`lib/capture`).
 * @param {any[]} endpoints - Runtime endpoints.
 * @param {{ signal?: AbortSignal, force?: boolean }} [options] - `force` probes regardless of the interval and of an earlier "no such path" answer.
 * @returns {Promise<void>} Resolves when every probe has finished.
 */
export function probe(c: any, endpoints: any[], options?: {
    signal?: AbortSignal;
    force?: boolean;
}): Promise<void>;
/**
 * Refresh the readiness of the endpoints a request could go to, before it is routed. Only a model with more than one endpoint is probed: a
 * lone endpoint is tried whatever it reports, so asking would only add a round trip.
 * @param {any} c - Captured translator parts (`lib/capture`).
 * @param {any} body - Client request body (only its `model` is read; anything that is not an object is left for `request` to reject).
 * @param {AbortSignal | undefined} signal - The caller's abort signal.
 * @returns {Promise<void>} Resolves when the pool's probes have finished.
 */
export function refresh(c: any, body: any, signal: AbortSignal | undefined): Promise<void>;

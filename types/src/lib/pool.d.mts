/**
 * Pool config as the translator accepts it.
 * @typedef {object} PoolConfig
 * @property {"failover" | "round_robin" | "least_busy"} [strategy] Default strategy (default `"failover"`).
 * @property {{base?: number, max?: number}} [backoff] Backoff in ms for a failing endpoint (defaults `1000` and `60000`).
 * @property {number} [connectTimeout] Milliseconds to wait for the TCP connection of a request to an endpoint with pool mates (default `10000`, `0` disables). Needs the default transport.
 * @property {number} [headersTimeout] Milliseconds to wait for the response headers of such a request (default `0`, off). Once the headers have arrived nothing caps the body.
 * @property {number} [healthInterval] Milliseconds a readiness probe result (see `lib/health`) is trusted before the next request that has pool mates probes again (default `10000`, `0` turns probing off). Only drivers that name a health path (vLLM: `/health`) are probed.
 * @property {number} [healthTimeout] Milliseconds a readiness probe may take before the endpoint counts as not ready (default `2000`).
 * @property {Record<string, "failover" | "round_robin" | "least_busy">} [models] Strategy per model, keyed by the model name after aliases.
 */
/**
 * Fresh health record for an endpoint.
 * `ready` is the result of the last readiness probe: `true`, `false`, or `null` when none has run (or the server has no health path); `checkedAt` is when it ran, `unsupported` is set once the server answered the probe with a 4xx (no such path), and `checking` holds a probe in flight so concurrent requests share it.
 * @returns {{failures: number, until: number, inflight: number, requests: number, errors: number, lastError: string | null, lastFailure: number | null, lastSuccess: number | null, ready: boolean | null, checkedAt: number | null, readyReason: string | null, unsupported: boolean, checking: Promise<void> | null}} Record.
 */
export function health(): {
    failures: number;
    until: number;
    inflight: number;
    requests: number;
    errors: number;
    lastError: string | null;
    lastFailure: number | null;
    lastSuccess: number | null;
    ready: boolean | null;
    checkedAt: number | null;
    readyReason: string | null;
    unsupported: boolean;
    checking: Promise<void> | null;
};
/**
 * Validate and normalize the `pool` config.
 * @param {PoolConfig | undefined} raw - Raw config.
 * @returns {{strategy: string, backoff: {base: number, max: number}, connectTimeout: number, headersTimeout: number, healthInterval: number, healthTimeout: number, models: Record<string, string>}} Normalized config.
 * @throws {TranslatorError} `INVALID_CONFIG` for an unknown strategy, a bad backoff or a bad timeout.
 */
export function normalize(raw?: PoolConfig | undefined): {
    strategy: string;
    backoff: {
        base: number;
        max: number;
    };
    connectTimeout: number;
    headersTimeout: number;
    healthInterval: number;
    healthTimeout: number;
    models: Record<string, string>;
};
/**
 * Order the endpoints that serve a model into the sequence in which they are tried: healthy endpoints first, arranged by the model's
 * strategy, then the unhealthy ones (backing off after a failure, or not ready), soonest to recover first. Every endpoint is included, so an all-unhealthy pool is still tried.
 * @param {any} config - Normalized config (`pool`).
 * @param {any} state - Translator state (`cursors`).
 * @param {any[]} list - Endpoints serving the model, in configuration order.
 * @param {string} model - Model name after aliases.
 * @param {boolean} advance - Move the round robin cursor (false to only look).
 * @param {number} [now] - Current time in ms.
 * @returns {any[]} Endpoints in try order.
 */
export function order(config: any, state: any, list: any[], model: string, advance: boolean, now?: number): any[];
/**
 * Record a connection error or 5xx from an endpoint: it is skipped for an exponentially growing backoff.
 * @param {any} config - Normalized config (`pool.backoff`).
 * @param {any} endpoint - Runtime endpoint.
 * @param {string} reason - Short description kept for status output.
 * @param {number} [now] - Current time in ms.
 * @returns {void}
 */
export function failed(config: any, endpoint: any, reason: string, now?: number): void;
/**
 * Record that an endpoint answered (any status below 500): it is healthy again.
 * @param {any} endpoint - Runtime endpoint.
 * @param {number} [now] - Current time in ms.
 * @returns {void}
 */
export function succeeded(endpoint: any, now?: number): void;
/**
 * Health of an endpoint as status output shows it.
 * @param {any} endpoint - Runtime endpoint.
 * @param {number} [now] - Current time in ms.
 * @returns {{healthy: boolean, ready: boolean | null, readyReason: string | null, checkedAt: string | null, failures: number, retryAt: string | null, inflight: number, requests: number, errors: number, lastError: string | null, lastFailure: string | null, lastSuccess: string | null}} Health report (times are ISO strings). `healthy` is false while the endpoint backs off after a failure or its last readiness probe said it is not ready; `ready` is that probe's verdict (null when none ran), `readyReason` why it failed.
 */
export function describe(endpoint: any, now?: number): {
    healthy: boolean;
    ready: boolean | null;
    readyReason: string | null;
    checkedAt: string | null;
    failures: number;
    retryAt: string | null;
    inflight: number;
    requests: number;
    errors: number;
    lastError: string | null;
    lastFailure: string | null;
    lastSuccess: string | null;
};
/** Strategies a pool of endpoints serving the same model can use. */
export const STRATEGIES: readonly string[];
/** Default backoff in ms: the first failure skips the endpoint for `base`, each further failure doubles it up to `max`. */
export const BACKOFF: Readonly<{
    base: 1000;
    max: 60000;
}>;
/** Default timeouts in ms for a request to an endpoint that has pool mates (0 disables). Connect is short because a dead host is the common failure; headers is off because a server may legitimately take minutes to prefill a long prompt before it sends any header. */
export const TIMEOUTS: Readonly<{
    connect: 10000;
    headers: 0;
}>;
/** Default readiness probing: how long a result is trusted (ms, 0 turns probing off) and how long a probe may take (ms). */
export const PROBES: Readonly<{
    interval: 10000;
    timeout: 2000;
}>;
/**
 * Pool config as the translator accepts it.
 */
export type PoolConfig = {
    /**
     * Default strategy (default `"failover"`).
     */
    strategy?: "failover" | "round_robin" | "least_busy";
    /**
     * Backoff in ms for a failing endpoint (defaults `1000` and `60000`).
     */
    backoff?: {
        base?: number;
        max?: number;
    };
    /**
     * Milliseconds to wait for the TCP connection of a request to an endpoint with pool mates (default `10000`, `0` disables). Needs the default transport.
     */
    connectTimeout?: number;
    /**
     * Milliseconds to wait for the response headers of such a request (default `0`, off). Once the headers have arrived nothing caps the body.
     */
    headersTimeout?: number;
    /**
     * Milliseconds a readiness probe result (see `lib/health`) is trusted before the next request that has pool mates probes again (default `10000`, `0` turns probing off). Only drivers that name a health path (vLLM: `/health`) are probed.
     */
    healthInterval?: number;
    /**
     * Milliseconds a readiness probe may take before the endpoint counts as not ready (default `2000`).
     */
    healthTimeout?: number;
    /**
     * Strategy per model, keyed by the model name after aliases.
     */
    models?: Record<string, "failover" | "round_robin" | "least_busy">;
};

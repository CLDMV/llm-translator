/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/pool.mjs
 *	@Date: 2026-10-26T06:00:20-07:00 (1793019620)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-26T15:38:55-07:00 (1793054335)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/** Strategies a pool of endpoints serving the same model can use. */
export declare const STRATEGIES: readonly string[];
/** Default backoff in ms: the first failure skips the endpoint for `base`, each further failure doubles it up to `max`. */
export declare const BACKOFF: Readonly<{
    base: 1000;
    max: 60000;
}>;
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
     * Strategy per model, keyed by the model name after aliases.
     */
    models?: Record<string, "failover" | "round_robin" | "least_busy">;
};
/**
 * Pool config as the translator accepts it.
 * @typedef {object} PoolConfig
 * @property {"failover" | "round_robin" | "least_busy"} [strategy] Default strategy (default `"failover"`).
 * @property {{base?: number, max?: number}} [backoff] Backoff in ms for a failing endpoint (defaults `1000` and `60000`).
 * @property {Record<string, "failover" | "round_robin" | "least_busy">} [models] Strategy per model, keyed by the model name after aliases.
 */
/**
 * Fresh health record for an endpoint.
 * @returns {{failures: number, until: number, inflight: number, requests: number, errors: number, lastError: string | null, lastFailure: number | null, lastSuccess: number | null}} Record.
 */
export declare function health(): {
    failures: number;
    until: number;
    inflight: number;
    requests: number;
    errors: number;
    lastError: string | null;
    lastFailure: number | null;
    lastSuccess: number | null;
};
/**
 * Validate and normalize the `pool` config.
 * @param {PoolConfig | undefined} raw - Raw config.
 * @returns {{strategy: string, backoff: {base: number, max: number}, models: Record<string, string>}} Normalized config.
 * @throws {TranslatorError} `INVALID_CONFIG` for an unknown strategy or a bad backoff.
 */
export declare function normalize(raw?: PoolConfig | undefined): {
    strategy: string;
    backoff: {
        base: number;
        max: number;
    };
    models: Record<string, string>;
};
/**
 * Order the endpoints that serve a model into the sequence in which they are tried: healthy endpoints first, arranged by the model's
 * strategy, then the unhealthy ones, soonest to recover first. Every endpoint is included, so an all-unhealthy pool is still tried.
 * @param {any} config - Normalized config (`pool`).
 * @param {any} state - Translator state (`cursors`).
 * @param {any[]} list - Endpoints serving the model, in configuration order.
 * @param {string} model - Model name after aliases.
 * @param {boolean} advance - Move the round robin cursor (false to only look).
 * @param {number} [now] - Current time in ms.
 * @returns {any[]} Endpoints in try order.
 */
export declare function order(config: any, state: any, list: any[], model: string, advance: boolean, now?: number): any[];
/**
 * Record a connection error or 5xx from an endpoint: it is skipped for an exponentially growing backoff.
 * @param {any} config - Normalized config (`pool.backoff`).
 * @param {any} endpoint - Runtime endpoint.
 * @param {string} reason - Short description kept for status output.
 * @param {number} [now] - Current time in ms.
 * @returns {void}
 */
export declare function failed(config: any, endpoint: any, reason: string, now?: number): void;
/**
 * Record that an endpoint answered (any status below 500): it is healthy again.
 * @param {any} endpoint - Runtime endpoint.
 * @param {number} [now] - Current time in ms.
 * @returns {void}
 */
export declare function succeeded(endpoint: any, now?: number): void;
/**
 * Health of an endpoint as status output shows it.
 * @param {any} endpoint - Runtime endpoint.
 * @param {number} [now] - Current time in ms.
 * @returns {{healthy: boolean, failures: number, retryAt: string | null, inflight: number, requests: number, errors: number, lastError: string | null, lastFailure: string | null, lastSuccess: string | null}} Health report (times are ISO strings).
 */
export declare function describe(endpoint: any, now?: number): {
    healthy: boolean;
    failures: number;
    retryAt: string | null;
    inflight: number;
    requests: number;
    errors: number;
    lastError: string | null;
    lastFailure: string | null;
    lastSuccess: string | null;
};

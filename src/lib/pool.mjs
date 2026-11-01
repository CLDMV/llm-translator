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

/**
 * @fileoverview Endpoint pools: strategy ordering, health state with exponential backoff and the pool config.
 * @module @cldmv/llm-translator/lib/pool
 */
import { TranslatorError } from "./errors.mjs";

/** Strategies a pool of endpoints serving the same model can use. */
export const STRATEGIES = Object.freeze(["failover", "round_robin", "least_busy"]);

/** Default backoff in ms: the first failure skips the endpoint for `base`, each further failure doubles it up to `max`. */
export const BACKOFF = Object.freeze({ base: 1000, max: 60000 });

/** Default timeouts in ms for a request to an endpoint that has pool mates (0 disables). Connect is short because a dead host is the common failure; headers is off because a server may legitimately take minutes to prefill a long prompt before it sends any header. */
export const TIMEOUTS = Object.freeze({ connect: 10000, headers: 0 });

/**
 * Pool config as the translator accepts it.
 * @typedef {object} PoolConfig
 * @property {"failover" | "round_robin" | "least_busy"} [strategy] Default strategy (default `"failover"`).
 * @property {{base?: number, max?: number}} [backoff] Backoff in ms for a failing endpoint (defaults `1000` and `60000`).
 * @property {number} [connectTimeout] Milliseconds to wait for the TCP connection of a request to an endpoint with pool mates (default `10000`, `0` disables). Needs the default transport.
 * @property {number} [headersTimeout] Milliseconds to wait for the response headers of such a request (default `0`, off). Once the headers have arrived nothing caps the body.
 * @property {Record<string, "failover" | "round_robin" | "least_busy">} [models] Strategy per model, keyed by the model name after aliases.
 */

/**
 * Fresh health record for an endpoint.
 * @returns {{failures: number, until: number, inflight: number, requests: number, errors: number, lastError: string | null, lastFailure: number | null, lastSuccess: number | null}} Record.
 */
export function health() {
	return { failures: 0, until: 0, inflight: 0, requests: 0, errors: 0, lastError: null, lastFailure: null, lastSuccess: null };
}

/**
 * Validate and normalize the `pool` config.
 * @param {PoolConfig | undefined} raw - Raw config.
 * @returns {{strategy: string, backoff: {base: number, max: number}, connectTimeout: number, headersTimeout: number, models: Record<string, string>}} Normalized config.
 * @throws {TranslatorError} `INVALID_CONFIG` for an unknown strategy, a bad backoff or a bad timeout.
 */
export function normalize(raw = {}) {
	const bad = (message) => new TranslatorError(`pool: ${message}`, { code: "INVALID_CONFIG", status: 500 });
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw bad("must be an object");
	const strategy = raw.strategy ?? "failover";
	const models = { ...raw.models };
	for (const [where, value] of [["strategy", strategy], ...Object.entries(models).map(([name, entry]) => [`models.${name}`, entry])]) {
		if (!STRATEGIES.includes(value)) throw bad(`${where} must be one of ${STRATEGIES.join(", ")} (got ${JSON.stringify(value)})`);
	}
	const base = raw.backoff?.base ?? BACKOFF.base;
	const max = raw.backoff?.max ?? BACKOFF.max;
	if (!(Number.isFinite(base) && base > 0) || !(Number.isFinite(max) && max >= base)) {
		throw bad("backoff.base must be a positive number of ms and backoff.max at least backoff.base");
	}
	const connectTimeout = raw.connectTimeout ?? TIMEOUTS.connect;
	const headersTimeout = raw.headersTimeout ?? TIMEOUTS.headers;
	for (const name of ["connectTimeout", "headersTimeout"]) {
		const value = name === "connectTimeout" ? connectTimeout : headersTimeout;
		if (typeof value !== "number" || !(Number.isFinite(value) && value >= 0)) {
			throw bad(`${name} must be a number of ms, 0 or more (got ${JSON.stringify(value)})`);
		}
	}
	return { strategy, backoff: { base, max }, connectTimeout, headersTimeout, models };
}

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
export function order(config, state, list, model, advance, now = Date.now()) {
	const strategy = config.pool.models[model] ?? config.pool.strategy;
	const up = list.filter((entry) => entry.health.until <= now);
	const down = list.filter((entry) => entry.health.until > now).sort((left, right) => left.health.until - right.health.until);
	let first = up;
	if (strategy === "least_busy") {
		first = [...up].sort((left, right) => left.health.inflight - right.health.inflight);
	} else if (strategy === "round_robin" && up.length > 0) {
		const turn = state.cursors.get(model) ?? 0;
		if (advance) state.cursors.set(model, turn + 1);
		const start = turn % up.length;
		first = [...up.slice(start), ...up.slice(0, start)];
	}
	return [...first, ...down];
}

/**
 * Record a connection error or 5xx from an endpoint: it is skipped for an exponentially growing backoff.
 * @param {any} config - Normalized config (`pool.backoff`).
 * @param {any} endpoint - Runtime endpoint.
 * @param {string} reason - Short description kept for status output.
 * @param {number} [now] - Current time in ms.
 * @returns {void}
 */
export function failed(config, endpoint, reason, now = Date.now()) {
	const record = endpoint.health;
	record.failures++;
	record.errors++;
	record.lastError = reason;
	record.lastFailure = now;
	const { base, max } = config.pool.backoff;
	record.until = now + Math.min(max, base * 2 ** Math.min(record.failures - 1, 30));
}

/**
 * Record that an endpoint answered (any status below 500): it is healthy again.
 * @param {any} endpoint - Runtime endpoint.
 * @param {number} [now] - Current time in ms.
 * @returns {void}
 */
export function succeeded(endpoint, now = Date.now()) {
	const record = endpoint.health;
	record.failures = 0;
	record.until = 0;
	record.lastSuccess = now;
}

/**
 * Health of an endpoint as status output shows it.
 * @param {any} endpoint - Runtime endpoint.
 * @param {number} [now] - Current time in ms.
 * @returns {{healthy: boolean, failures: number, retryAt: string | null, inflight: number, requests: number, errors: number, lastError: string | null, lastFailure: string | null, lastSuccess: string | null}} Health report (times are ISO strings).
 */
export function describe(endpoint, now = Date.now()) {
	const record = endpoint.health;
	const iso = (time) => (time === null ? null : new Date(time).toISOString());
	const down = record.until > now;
	return {
		healthy: !down,
		failures: record.failures,
		retryAt: down ? iso(record.until) : null,
		inflight: record.inflight,
		requests: record.requests,
		errors: record.errors,
		lastError: record.lastError,
		lastFailure: iso(record.lastFailure),
		lastSuccess: iso(record.lastSuccess)
	};
}

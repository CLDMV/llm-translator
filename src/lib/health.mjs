/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/health.mjs
 *	@Date: 2026-11-13T10:00:00-08:00 (1794247200)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-13T10:00:00-08:00 (1794247200)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Readiness probes: ask an upstream's health path (a driver names it in `info().paths.health`) before a request is routed to a pool.
 * @module @cldmv/llm-translator/lib/health
 */
import * as http from "./http.mjs";
import { emit } from "./events.mjs";
import { pick } from "./route.mjs";

/**
 * Probe one endpoint and record the verdict: a 2xx is ready; a connection error, a timeout or a 5xx (vLLM answers 503 once its engine is dead)
 * is not ready; any other answer means the server has no such path, and the endpoint is not probed again until the next detection. A probe cut
 * short by the caller's own abort says nothing about the server and is not recorded. A change between ready and not ready is an event.
 * @param {any} c - Captured translator parts (`lib/capture`).
 * @param {any} endpoint - Runtime endpoint.
 * @param {any} driver - The endpoint's driver record.
 * @param {AbortSignal | undefined} signal - The caller's abort signal.
 * @returns {Promise<void>} Resolves when the verdict is recorded.
 */
async function run(c, endpoint, driver, signal) {
	const record = endpoint.health;
	const result = await http.json(c.state.transport, http.join(endpoint.url, driver.info.paths.health), {
		method: "GET",
		headers: http.headers(endpoint, driver.info.auth),
		signal,
		timeout: c.config.pool.healthTimeout
	});
	if (signal?.aborted) return;
	const before = record.ready;
	record.checkedAt = Date.now();
	if (result.ok) {
		record.ready = true;
		record.readyReason = null;
	} else if (result.status === 0 || result.status >= 500) {
		record.ready = false;
		record.readyReason = result.status === 0 ? String(result.error?.message ?? "no answer") : `HTTP ${result.status}`;
	} else {
		record.ready = null;
		record.readyReason = null;
		record.unsupported = true;
	}
	if (record.ready === false && before !== false) {
		emit(c, {
			type: "health",
			kind: "down",
			level: "warn",
			message: `Upstream ${endpoint.name} is not ready (${record.readyReason}); requests go to other endpoints that serve the same model first`,
			endpoint: endpoint.name,
			reason: record.readyReason
		});
	} else if (record.ready === true && before === false) {
		emit(c, { type: "health", kind: "up", level: "info", message: `Upstream ${endpoint.name} is ready again`, endpoint: endpoint.name });
	}
}

/**
 * Probe the endpoints that name a health path and whose last verdict is older than `pool.healthInterval` (all of them with `force`). A request
 * that was answered counts as a verdict too, so an endpoint that is serving is not probed. Probes run in parallel, and requests that arrive
 * while one is running share it.
 * @param {any} c - Captured translator parts (`lib/capture`).
 * @param {any[]} endpoints - Runtime endpoints.
 * @param {{ signal?: AbortSignal, force?: boolean }} [options] - `force` probes regardless of the interval and of an earlier "no such path" answer.
 * @returns {Promise<void>} Resolves when every probe has finished.
 */
export async function probe(c, endpoints, options = {}) {
	const now = Date.now();
	const { healthInterval } = c.config.pool;
	await Promise.all(
		endpoints.map((endpoint) => {
			const record = endpoint.health;
			const driver = c.driver(endpoint);
			if (!driver.info.paths?.health) return undefined;
			if (options.force) record.unsupported = false;
			else if (record.unsupported || healthInterval <= 0) return undefined;
			const seen = Math.max(record.checkedAt ?? 0, record.ready === false ? 0 : (record.lastSuccess ?? 0));
			if (!options.force && now - seen < healthInterval) return undefined;
			record.checking ??= run(c, endpoint, driver, options.signal).finally(() => {
				record.checking = null;
			});
			return record.checking;
		})
	);
}

/**
 * Refresh the readiness of the endpoints a request could go to, before it is routed. Only a model with more than one endpoint is probed: a
 * lone endpoint is tried whatever it reports, so asking would only add a round trip.
 * @param {any} c - Captured translator parts (`lib/capture`).
 * @param {any} body - Client request body (only its `model` is read; anything that is not an object is left for `request` to reject).
 * @param {AbortSignal | undefined} signal - The caller's abort signal.
 * @returns {Promise<void>} Resolves when the pool's probes have finished.
 */
export async function refresh(c, body, signal) {
	if (c.config.pool.healthInterval <= 0 || !body || typeof body !== "object") return;
	const { pool } = pick(c.config, c.state.endpoints, body.model, c.state);
	if (pool.length > 1) await probe(c, pool, { signal });
}

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/endpoint/status.mjs
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
 * @fileoverview Root api: health of the upstream endpoints.
 * @module @cldmv/llm-translator/endpoint
 */
import { context } from "../../lib/runtime.mjs";
import { describe } from "../../lib/pool.mjs";

/**
 * Health of every endpoint, for status output. An endpoint is unhealthy while it is backing off after a connection error or a 5xx, or while its last readiness probe (`GET /health` for vLLM, see `health.check`) said it is not ready; it is still
 * tried when nothing healthy serves the model. Secrets are never included.
 * @returns {{strategy: string, backoff: {base: number, max: number}, models: Record<string, string>, endpoints: {name: string, url: string, models: string[], healthy: boolean, ready: boolean | null, readyReason: string | null, checkedAt: string | null, failures: number, retryAt: string | null, inflight: number, requests: number, errors: number, lastError: string | null, lastFailure: string | null, lastSuccess: string | null}[]}} The pool config and one record per endpoint (`inflight` counts requests whose reply has not finished, `requests` and `errors` count attempts since start).
 */
export function status() {
	const { config, state } = context;
	return {
		...config.pool,
		endpoints: state.endpoints.map((endpoint) => ({
			name: endpoint.name,
			url: endpoint.url,
			models: endpoint.models ?? endpoint.facts?.models ?? [],
			...describe(endpoint)
		}))
	};
}

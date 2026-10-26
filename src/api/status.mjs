/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/status.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:01-07:00 (1792958341)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Root api: report what detection found.
 * @module @cldmv/llm-translator/status
 */
import { context } from "../lib/runtime.mjs";

/**
 * Describe the translator's upstreams. Secrets (API keys, headers) are never included.
 * @returns {{front: string, upstreams: any[]}} Front protocol and per-upstream detection results.
 */
export function status() {
	const { config, state } = context;
	return {
		front: config.front,
		upstreams: state.endpoints.map((endpoint) => ({
			name: endpoint.name,
			url: endpoint.url,
			backend: endpoint.backend,
			driver: endpoint.driver,
			protocol: endpoint.protocol,
			version: endpoint.facts?.version ?? endpoint.version,
			models: endpoint.models ?? endpoint.facts?.models ?? [],
			default: endpoint.default,
			facts: endpoint.facts,
			probed: endpoint.probed
		}))
	};
}

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
import { describe } from "../lib/pool.mjs";
import { resolve } from "../lib/settings.mjs";
import { wants } from "../lib/vllm.mjs";

/**
 * Describe the translator's upstreams. Secrets (API keys, headers) are never included.
 * @returns {{front: string, upstreams: any[]}} Front protocol and per-upstream detection results and health (see `endpoint.status`). `messages` is true while an Anthropic-front request to a vLLM upstream goes to its native `/v1/messages` (the `nativeMessages` setting; a request it cannot take is still converted), false when it is converted, and null for any other driver.
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
			probed: endpoint.probed,
			messages:
				endpoint.driver === "vllm"
					? wants(endpoint, resolve(endpoint.driverSettings, endpoint.probed, config.settings, endpoint.settings)) &&
						!state.noMessages.has(endpoint.name)
					: null,
			health: describe(endpoint)
		}))
	};
}

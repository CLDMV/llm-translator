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
import { capture } from "../lib/capture.mjs";
import { self } from "../lib/runtime.mjs";
import { MESSAGES, RESPONSES, supported } from "../lib/protocol.mjs";

/**
 * Describe the translator's upstreams. Secrets (API keys, headers) are never included.
 * @returns {{front: string, upstreams: any[]}} Front protocol and per-upstream detection results and health (see `endpoint.status`). `api` is the upstream's `api` setting as the canonical id (or `"auto"`) and `protocols` the protocols its driver speaks. `protocol` is the one a request in the configured front's protocol goes over now (under `api: "auto"` that is the first of the client's own protocol and Chat Completions that the server has, so an upstream that answered 404, 405 or 501 to one has moved on until the next detection). `responses` is true while that holds for a Responses API request (a Responses client on an OpenAI front), and `messages` is true while an Anthropic request to a vLLM upstream goes to its native `/v1/messages` (a request it cannot take is still converted), false when it is converted, and null for any other driver.
 */
export function status() {
	const { config, state } = context;
	const c = capture(self, context);
	return {
		front: config.front,
		upstreams: state.endpoints.map((endpoint) => ({
			name: endpoint.name,
			url: endpoint.url,
			backend: endpoint.backend,
			driver: endpoint.driver,
			api: endpoint.api,
			protocols: supported(c.driver(endpoint).info),
			protocol: c.plan(endpoint).protocol,
			version: endpoint.facts?.version ?? endpoint.version,
			models: endpoint.models ?? endpoint.facts?.models ?? [],
			default: endpoint.default,
			facts: endpoint.facts,
			probed: endpoint.probed,
			responses: c.plan(endpoint, { wire: "responses" }).protocol === RESPONSES,
			messages: endpoint.driver === "vllm" ? c.plan(endpoint, { front: "anthropic" }).protocol === MESSAGES : null,
			health: describe(endpoint)
		}))
	};
}

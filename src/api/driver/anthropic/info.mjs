/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/anthropic/info.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:58:59-07:00 (1792958339)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Anthropic driver: static facts about the backend.
 * @module @cldmv/llm-translator/driver/anthropic
 */

/**
 * Describe the Anthropic driver (native Messages API upstream).
 * @returns {{name: string, protocol: string, order: number, auth: string, strict: boolean, hosts: string[], probes: string[], headers: Record<string,string>, paths: Record<string,string>}} Driver facts.
 */
export function info() {
	return {
		name: "anthropic",
		protocol: "anthropic.messages",
		order: 38,
		auth: "x-api-key",
		strict: true,
		// Hosted API: matched by name with no request, so the batched probes below are not started for it.
		hosts: ["api.anthropic.com"],
		// Any other host: `GET /v1/models` sent the Anthropic way, requested together with the later drivers' probes.
		probes: ["/v1/models"],
		headers: { "anthropic-version": "2023-06-01" },
		paths: { messages: "/v1/messages", models: "/v1/models", count: "/v1/messages/count_tokens" }
	};
}

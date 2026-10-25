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
 * @returns {{name: string, protocol: string, order: number, auth: string, headers: Record<string,string>, paths: Record<string,string>}} Driver facts.
 */
export function info() {
	return {
		name: "anthropic",
		protocol: "anthropic.messages",
		order: 20,
		auth: "x-api-key",
		headers: { "anthropic-version": "2023-06-01" },
		paths: { messages: "/v1/messages", models: "/v1/models", count: "/v1/messages/count_tokens" }
	};
}

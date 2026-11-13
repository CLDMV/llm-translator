/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/openrouter/info.mjs
 *	@Date: 2026-11-13T09:00:00-08:00 (1794589200)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-13T09:00:00-08:00 (1794589200)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview OpenRouter driver: static facts about the hosted OpenRouter API.
 * @module @cldmv/llm-translator/driver/openrouter
 */

/**
 * Describe the OpenRouter driver. The API lives under `/api`; the `path` leaf adds it, so `paths` holds the usual `/v1/...` ones.
 * @returns {{name: string, protocol: string, order: number, auth: string, strict: boolean, paths: Record<string,string>}} Driver facts.
 */
export function info() {
	return {
		name: "openrouter",
		protocol: "openai.chat",
		order: 37,
		auth: "bearer",
		strict: false,
		paths: { chat: "/v1/chat/completions", models: "/v1/models" }
	};
}

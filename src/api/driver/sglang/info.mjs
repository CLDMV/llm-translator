/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/sglang/info.mjs
 *	@Date: 2026-10-31T14:00:00-07:00 (1793480400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-31T14:00:00-07:00 (1793480400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview SGLang driver: static facts about the backend.
 * @module @cldmv/llm-translator/driver/sglang
 */

/**
 * Describe the SGLang driver.
 * @returns {{name: string, protocol: string, order: number, auth: string, probes: string[], paths: Record<string,string>}} Driver facts.
 */
export function info() {
	return {
		name: "sglang",
		protocol: "openai.chat",
		order: 50,
		auth: "bearer",
		probes: ["/get_server_info"],
		paths: { chat: "/v1/chat/completions", models: "/v1/models", serverInfo: "/get_server_info" }
	};
}

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/openai/info.mjs
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
 * @fileoverview OpenAI driver: static facts about the backend.
 * @module @cldmv/llm-translator/driver/openai
 */

/**
 * Describe the OpenAI driver.
 * @returns {{name: string, protocol: string, order: number, auth: string, paths: Record<string,string>}} Driver facts.
 */
export function info() {
	return {
		name: "openai",
		protocol: "openai.chat",
		order: 30,
		auth: "bearer",
		paths: { chat: "/v1/chat/completions", models: "/v1/models" }
	};
}

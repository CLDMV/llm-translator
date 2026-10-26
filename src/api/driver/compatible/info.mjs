/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/compatible/info.mjs
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
 * @fileoverview Generic OpenAI-compatible driver: static facts about the backend.
 * @module @cldmv/llm-translator/driver/compatible
 */

/**
 * Describe the generic OpenAI-compatible driver (matches last, after every specific driver).
 * @returns {{name: string, protocol: string, order: number, auth: string, paths: Record<string,string>}} Driver facts.
 */
export function info() {
	return {
		name: "compatible",
		protocol: "openai.chat",
		order: 100,
		auth: "bearer",
		paths: { chat: "/v1/chat/completions", models: "/v1/models" }
	};
}

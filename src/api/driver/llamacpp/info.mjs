/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/llamacpp/info.mjs
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
 * @fileoverview llama.cpp driver: static facts about `llama-server`.
 * @module @cldmv/llm-translator/driver/llamacpp
 */

/**
 * Describe the llama.cpp driver.
 * @returns {{name: string, protocol: string, order: number, auth: string, probes: string[], paths: Record<string,string>}} Driver facts.
 */
export function info() {
	return {
		name: "llamacpp",
		protocol: "openai.chat",
		order: 40,
		auth: "bearer",
		probes: ["/props"],
		paths: { chat: "/v1/chat/completions", models: "/v1/models", props: "/props" }
	};
}

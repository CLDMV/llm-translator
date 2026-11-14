/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/vllm/info.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:00-07:00 (1792958340)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview vLLM driver: static facts about the backend.
 * @module @cldmv/llm-translator/driver/vllm
 */

import { VLLM_FIELDS } from "../../../lib/passthrough.mjs";

/**
 * Describe the vLLM driver.
 * @returns {{name: string, protocol: string, order: number, auth: string, strict: boolean, fields: string[], paths: Record<string,string>}} Driver facts.
 */
export function info() {
	return {
		name: "vllm",
		protocol: "openai.chat",
		order: 10,
		auth: "bearer",
		strict: true,
		fields: VLLM_FIELDS,
		paths: { chat: "/v1/chat/completions", messages: "/v1/messages", models: "/v1/models", tokenize: "/tokenize", version: "/version" }
	};
}

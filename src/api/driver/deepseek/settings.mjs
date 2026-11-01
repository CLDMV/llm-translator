/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/deepseek/settings.mjs
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
 * @fileoverview DeepSeek driver: translator settings for the hosted DeepSeek API.
 * @module @cldmv/llm-translator/driver/deepseek
 */

/**
 * Settings for api.deepseek.com: reasoning in `reasoning_content`, no `top_k`, no prefill continuation, `json_object` response format only
 * (no `json_schema`), text-only models, and usage on the last content chunk (read as for any server). Thinking is chosen by the model name, so no
 * thinking switch is sent.
 * @returns {any} Partial settings.
 */
export function settings() {
	return {
		reasoningField: "reasoning_content",
		maxTokensField: "max_tokens",
		thinking: "none",
		thinkingBudget: false,
		effort: false,
		topK: false,
		prefill: "none",
		responseFormat: false,
		images: false,
		streamUsage: true,
		continuousUsage: false
	};
}

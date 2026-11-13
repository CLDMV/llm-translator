/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/azure/settings.mjs
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
 * @fileoverview Azure OpenAI driver: translator settings for Azure OpenAI.
 * @module @cldmv/llm-translator/driver/azure
 */

/**
 * Settings for Azure OpenAI: the same as the OpenAI API (`max_completion_tokens`, `reasoning_effort`, no `top_k`, no prefill continuation).
 * @returns {any} Partial settings.
 */
export function settings() {
	return {
		maxTokensField: "max_completion_tokens",
		thinking: "reasoning_effort",
		thinkingBudget: false,
		effort: true,
		topK: false,
		prefill: "none",
		deferredTools: "drop",
		streamUsage: true,
		continuousUsage: false
	};
}

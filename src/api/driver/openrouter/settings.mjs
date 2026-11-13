/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/openrouter/settings.mjs
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
 * @fileoverview OpenRouter driver: translator settings for the hosted OpenRouter API.
 * @module @cldmv/llm-translator/driver/openrouter
 */

/**
 * Settings for openrouter.ai: reasoning comes back in `reasoning` and `reasoning_details`, and `reasoning_details` is sent back unmodified and in
 * order (`reasoningRoundTrip`). Thinking and effort are sent as `reasoning_effort`, which the `request` normalizer turns into OpenRouter's
 * `reasoning` object. `max_tokens` is the output cap, `top_k` is accepted (OpenRouter drops what a model does not support), a trailing assistant
 * message is OpenRouter's own prefill, and usage comes in a final chunk.
 * @returns {any} Partial settings.
 */
export function settings() {
	return {
		reasoningField: "reasoning",
		reasoningRoundTrip: true,
		maxTokensField: "max_tokens",
		thinking: "reasoning_effort",
		thinkingBudget: false,
		effort: true,
		topK: true,
		prefill: "none",
		streamUsage: true,
		continuousUsage: false
	};
}

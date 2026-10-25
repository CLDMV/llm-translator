/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/vllm/settings.mjs
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
 * @fileoverview vLLM driver: version-mapped translator settings.
 * @module @cldmv/llm-translator/driver/vllm
 */
import { atLeast, semver } from "../../../lib/normalize.mjs";

/**
 * Settings for a vLLM server. An unknown version is treated as the latest release, except `thinkingBudget`, which needs a known version of 0.19.0 or later.
 * @param {{version?: string}} [facts] - Detection facts (or the configured version).
 * @returns {any} Partial settings.
 */
export function settings(facts = {}) {
	return {
		reasoningField: atLeast(facts.version, "0.16.0") ? "reasoning" : "reasoning_content",
		// Only enabled for a version known to support it; an unknown version stays conservative.
		thinkingBudget: semver(facts.version) !== null && atLeast(facts.version, "0.19.0"),
		effort: atLeast(facts.version, "0.22.0"),
		maxTokensField: "max_completion_tokens",
		streamUsage: true,
		continuousUsage: true,
		prefill: "continue_final_message",
		topK: true,
		responseFormat: true
	};
}

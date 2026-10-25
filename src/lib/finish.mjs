/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/finish.mjs
 *	@Date: 2026-10-25T12:28:19-07:00 (1792956499)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:01-07:00 (1792958341)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Stop-reason and usage mapping between the two protocols.
 */

/**
 * Anthropic stop reason (and stop sequence) for an OpenAI choice.
 * @param {string|null|undefined} finishReason - OpenAI `finish_reason`.
 * @param {{ hasToolCalls: boolean, matchedStop?: unknown, argumentsComplete?: boolean }} info - Whether tool calls were produced, vLLM's `stop_reason` (a string for a matched stop string), and whether the last tool call's arguments are complete. A `length` stop with incomplete arguments is `max_tokens`, not `tool_use`.
 * @returns {{ stop_reason: string, stop_sequence: string|null }} Anthropic stop fields.
 */
export function toAnthropicStop(finishReason, { hasToolCalls, matchedStop, argumentsComplete = true }) {
	if (hasToolCalls && (finishReason !== "length" || argumentsComplete)) return { stop_reason: "tool_use", stop_sequence: null };
	if (finishReason === "length") return { stop_reason: "max_tokens", stop_sequence: null };
	if (finishReason === "content_filter") return { stop_reason: "refusal", stop_sequence: null };
	if (typeof matchedStop === "string" && matchedStop !== "") return { stop_reason: "stop_sequence", stop_sequence: matchedStop };
	return { stop_reason: "end_turn", stop_sequence: null };
}

/**
 * OpenAI `finish_reason` for an Anthropic stop reason.
 * @param {string|null|undefined} stopReason - Anthropic `stop_reason`.
 * @returns {string} OpenAI finish reason.
 */
export function toOpenAIFinish(stopReason) {
	switch (stopReason) {
		case "max_tokens":
			return "length";
		case "tool_use":
			return "tool_calls";
		case "refusal":
			return "content_filter";
		default:
			return "stop";
	}
}

/**
 * Anthropic usage from an OpenAI usage object. Cached prompt tokens (reported by vLLM only with prompt-token
 * details enabled) are reported as `cache_read_input_tokens` and subtracted from `input_tokens`.
 * @param {{ prompt_tokens?: number, completion_tokens?: number, prompt_tokens_details?: { cached_tokens?: number }|null }|null|undefined} usage - OpenAI usage.
 * @returns {{ input_tokens: number, output_tokens: number, cache_creation_input_tokens: number, cache_read_input_tokens: number }} Anthropic usage.
 */
export function toAnthropicUsage(usage) {
	const prompt = usage?.prompt_tokens ?? 0;
	const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
	return {
		input_tokens: Math.max(0, prompt - cached),
		output_tokens: usage?.completion_tokens ?? 0,
		cache_creation_input_tokens: 0,
		cache_read_input_tokens: cached
	};
}

/**
 * OpenAI usage from an Anthropic usage object (cache tokens count as prompt tokens).
 * @param {{ input_tokens?: number, output_tokens?: number, cache_creation_input_tokens?: number|null, cache_read_input_tokens?: number|null }|null|undefined} usage - Anthropic usage.
 * @returns {{ prompt_tokens: number, completion_tokens: number, total_tokens: number, prompt_tokens_details?: { cached_tokens: number } }} OpenAI usage.
 */
export function toOpenAIUsage(usage) {
	const cached = usage?.cache_read_input_tokens ?? 0;
	const prompt = (usage?.input_tokens ?? 0) + cached + (usage?.cache_creation_input_tokens ?? 0);
	const completion = usage?.output_tokens ?? 0;
	const out = { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
	if (cached > 0) out.prompt_tokens_details = { cached_tokens: cached };
	return out;
}

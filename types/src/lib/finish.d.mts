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
export declare function toAnthropicStop(finishReason: string | null | undefined, { hasToolCalls, matchedStop, argumentsComplete }: {
    hasToolCalls: boolean;
    matchedStop?: unknown;
    argumentsComplete?: boolean;
}): {
    stop_reason: string;
    stop_sequence: string | null;
};
/**
 * OpenAI `finish_reason` for an Anthropic stop reason.
 * @param {string|null|undefined} stopReason - Anthropic `stop_reason`.
 * @returns {string} OpenAI finish reason.
 */
export declare function toOpenAIFinish(stopReason: string | null | undefined): string;
/**
 * Anthropic usage from an OpenAI usage object. Cached prompt tokens (reported by vLLM only with prompt-token
 * details enabled) are reported as `cache_read_input_tokens` and subtracted from `input_tokens`.
 * @param {{ prompt_tokens?: number, completion_tokens?: number, prompt_tokens_details?: { cached_tokens?: number }|null }|null|undefined} usage - OpenAI usage.
 * @returns {{ input_tokens: number, output_tokens: number, cache_creation_input_tokens: number, cache_read_input_tokens: number }} Anthropic usage.
 */
export declare function toAnthropicUsage(usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: {
        cached_tokens?: number;
    } | null;
} | null | undefined): {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
};
/**
 * OpenAI usage from an Anthropic usage object (cache tokens count as prompt tokens).
 * @param {{ input_tokens?: number, output_tokens?: number, cache_creation_input_tokens?: number|null, cache_read_input_tokens?: number|null }|null|undefined} usage - Anthropic usage.
 * @returns {{ prompt_tokens: number, completion_tokens: number, total_tokens: number, prompt_tokens_details?: { cached_tokens: number } }} OpenAI usage.
 */
export declare function toOpenAIUsage(usage: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
} | null | undefined): {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: {
        cached_tokens: number;
    };
};

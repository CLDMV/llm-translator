/**
 * The error a fatal OpenAI `finish_reason` stands for. Servers use `abort`, `aborted` and `error` when generation was cut off and
 * `insufficient_system_resource` when they ran out of resources mid-answer; none of them is a finished answer.
 * @param {string|null|undefined} finishReason - OpenAI `finish_reason`.
 * @returns {{ type: string, status: number, code: string, message: string }|null} Error details, or null when the reason is not fatal.
 */
export function finishError(finishReason: string | null | undefined): {
    type: string;
    status: number;
    code: string;
    message: string;
} | null;
/**
 * Anthropic stop reason (and stop sequence) for an OpenAI choice.
 * `model_length` is `max_tokens`; `eos`, `eos_token` and any other unknown value are `end_turn`. Fatal values are handled by {@link finishError} before this.
 * @param {string|null|undefined} finishReason - OpenAI `finish_reason`.
 * A `content_filter` stop also carries `stop_details` (`{ type: "refusal", category: null, explanation }`), the explanation being the upstream's refusal text when it sent one. No other stop reason has the field.
 * @param {{ hasToolCalls: boolean, matchedStop?: unknown, argumentsComplete?: boolean, refusal?: unknown }} info - Whether tool calls were produced, vLLM's `stop_reason` (a string for a matched stop string), whether the last tool call's arguments are complete, and the upstream's refusal text. A `length` stop with incomplete arguments is `max_tokens`, not `tool_use`.
 * @returns {{ stop_reason: string, stop_sequence: string|null, stop_details?: { type: string, category: string|null, explanation: string|null } }} Anthropic stop fields.
 */
export function toAnthropicStop(finishReason: string | null | undefined, { hasToolCalls, matchedStop, argumentsComplete, refusal }: {
    hasToolCalls: boolean;
    matchedStop?: unknown;
    argumentsComplete?: boolean;
    refusal?: unknown;
}): {
    stop_reason: string;
    stop_sequence: string | null;
    stop_details?: {
        type: string;
        category: string | null;
        explanation: string | null;
    };
};
/**
 * OpenAI `finish_reason` for an Anthropic stop reason.
 * @param {string|null|undefined} stopReason - Anthropic `stop_reason`.
 * @returns {string} OpenAI finish reason.
 */
export function toOpenAIFinish(stopReason: string | null | undefined): string;
/**
 * Anthropic usage from an OpenAI usage object. Cached prompt tokens (reported by vLLM only with prompt-token
 * details enabled) are reported as `cache_read_input_tokens` and subtracted from `input_tokens`.
 * @param {{ prompt_tokens?: number, completion_tokens?: number, prompt_tokens_details?: { cached_tokens?: number }|null }|null|undefined} usage - OpenAI usage.
 * @returns {{ input_tokens: number, output_tokens: number, cache_creation_input_tokens: number, cache_read_input_tokens: number }} Anthropic usage.
 */
export function toAnthropicUsage(usage: {
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
export function toOpenAIUsage(usage: {
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

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
 * The Anthropic refusal category for the content filter annotations an OpenAI-style server put on a choice. Azure OpenAI (and Foundry) attach
 * `content_filter_results` to each choice (and to streamed chunks): `{ hate: { filtered, severity }, sexual, violence, self_harm, ... }`.
 * A harm category with `filtered: true` is a policy area outside Anthropic's four named ones (`cyber`, `bio`, `frontier_llm`,
 * `reasoning_extraction`), which is what `general_harms` stands for. Everything else (jailbreak, protected material, blocklists, no
 * annotations) gives no category and stays null. No other server the translator knows reports one (see D-50).
 * @param {any} results - A choice's `content_filter_results`, if any.
 * @returns {"general_harms"|null} The category, or null.
 */
export function filterCategory(results: any): "general_harms" | null;
/**
 * Anthropic stop reason (and stop sequence) for an OpenAI choice.
 * `model_length` is `max_tokens`; `eos`, `eos_token` and any other unknown value are `end_turn`. Fatal values are handled by {@link finishError} before this.
 * @param {string|null|undefined} finishReason - OpenAI `finish_reason`.
 * A `content_filter` stop also carries `stop_details` (`{ type: "refusal", category, explanation }`), the explanation being the upstream's refusal text when it sent one and the category what {@link filterCategory} found (else null). No other stop reason has the field.
 * @param {{ hasToolCalls: boolean, matchedStop?: unknown, argumentsComplete?: boolean, refusal?: unknown, category?: string|null }} info - Whether tool calls were produced, vLLM's `stop_reason` (a string for a matched stop string), whether the last tool call's arguments are complete, the upstream's refusal text and the refusal category from {@link filterCategory}. A `length` stop with incomplete arguments is `max_tokens`, not `tool_use`.
 * @returns {{ stop_reason: string, stop_sequence: string|null, stop_details?: { type: string, category: string|null, explanation: string|null } }} Anthropic stop fields.
 */
export function toAnthropicStop(finishReason: string | null | undefined, { hasToolCalls, matchedStop, argumentsComplete, refusal, category }: {
    hasToolCalls: boolean;
    matchedStop?: unknown;
    argumentsComplete?: boolean;
    refusal?: unknown;
    category?: string | null;
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

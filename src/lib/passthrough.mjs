/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/passthrough.mjs
 *	@Date: 2026-10-25T12:49:46-07:00 (1792957786)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:02-07:00 (1792958342)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Allow-list for OpenAI-protocol request bodies that are forwarded without conversion.
 * @module @cldmv/llm-translator/lib/passthrough
 */

/** Standard Chat Completions request fields. */
const STANDARD = [
	"model",
	"messages",
	"stream",
	"stream_options",
	"max_tokens",
	"max_completion_tokens",
	"temperature",
	"top_p",
	"n",
	"stop",
	"presence_penalty",
	"frequency_penalty",
	"logit_bias",
	"logprobs",
	"top_logprobs",
	"seed",
	"response_format",
	"tools",
	"tool_choice",
	"parallel_tool_calls",
	"reasoning_effort",
	"user",
	"metadata",
	"store",
	"service_tier"
];

/** Documented vLLM sampling, template and reasoning extensions. */
const VLLM = [
	"top_k",
	"min_p",
	"repetition_penalty",
	"length_penalty",
	"min_tokens",
	"stop_token_ids",
	"include_stop_str_in_output",
	"ignore_eos",
	"skip_special_tokens",
	"spaces_between_special_tokens",
	"allowed_token_ids",
	"bad_words",
	"prompt_logprobs",
	"truncate_prompt_tokens",
	"add_generation_prompt",
	"continue_final_message",
	"add_special_tokens",
	"chat_template_kwargs",
	"thinking_token_budget",
	"include_reasoning",
	"structured_outputs"
];

const ALLOWED = new Set([...STANDARD, ...VLLM]);
const STREAM_OPTIONS = new Set(["include_usage", "continuous_usage_stats"]);

/**
 * Keep only known Chat Completions and documented vLLM extension fields, so an untrusted client cannot inject server-side
 * controls such as `kv_transfer_params`, `vllm_xargs`, `chat_template`, `cache_salt` or `priority`. `stream_options` is
 * reduced to the usage flags.
 * @param {any} body - Client request body.
 * @returns {any} Filtered copy.
 */
export function filterChatBody(body) {
	const out = {};
	for (const [key, value] of Object.entries(body)) {
		if (!ALLOWED.has(key)) continue;
		if (key === "stream_options") {
			const kept = Object.fromEntries(Object.entries(value ?? {}).filter(([name]) => STREAM_OPTIONS.has(name)));
			if (Object.keys(kept).length > 0) out.stream_options = kept;
		} else out[key] = value;
	}
	return out;
}

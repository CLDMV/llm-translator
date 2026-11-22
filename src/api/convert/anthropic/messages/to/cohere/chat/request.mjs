/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/anthropic/messages/to/cohere/chat/request.mjs
 *	@Date: 2026-11-21T10:00:00-08:00 (1795284000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-21T10:00:00-08:00 (1795284000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Anthropic Messages request to a Cohere `/v2/chat` request.
 * @module @cldmv/llm-translator/convert
 */
import { resolve } from "../../../../../../../lib/settings.mjs";
import { chatBody } from "../../../../../../../lib/cohere.mjs";
import { request as toChat } from "../../openai/chat/request.mjs";

/**
 * Settings the native API does not choose: the output cap is always `max_tokens`, `top_k` is `k`, thinking is Cohere's own `thinking` setting
 * (taken from the request, not a template switch), and a trailing assistant message is an ordinary turn. These override the upstream's own values.
 */
/** @type {Partial<import("../../../../../../../lib/settings.mjs").Settings>} */
const NATIVE = {
	maxTokensField: "max_tokens",
	thinking: "none",
	thinkingBudget: false,
	effort: true,
	topK: true,
	prefill: "none",
	streamUsage: false,
	continuousUsage: false,
	parallelToolCalls: true,
	reasoningRoundTrip: false,
	responseFormat: true
};

/**
 * Convert an Anthropic Messages request to a Cohere `/v2/chat` body. The Anthropic conversion to Chat Completions does the work (system, tool
 * blocks, images, tool names, dropped fields); `chatBody` then puts the result in Cohere's shape (see there). `thinking` becomes Cohere's
 * `thinking` (`enabled` with `budget_tokens` as `token_budget`, or `disabled`), an `output_config.effort` turns it on, and `output_config.format`
 * becomes `response_format`. The upstream's `sampling` setting and `metadata.sampling` become further Cohere fields.
 * @param {any} body - Anthropic request body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @param {any} [context] - `{ producer, budget, listed, toolCallIds }`, as for the Chat Completions conversion.
 * @returns {Promise<{body: any, state: any}>} The Cohere body and the conversion state the response converters read.
 */
export async function request(body, settings, context) {
	const s = resolve(settings);
	const { body: chat, state } = await toChat(body, { ...s, ...NATIVE }, { ...context, sources: true });
	const asked = body.metadata?.sampling;
	const sampling = { ...s.sampling, ...(asked !== null && typeof asked === "object" && !Array.isArray(asked) ? asked : {}) };
	const clamped = [];
	const out = chatBody(chat, {
		dropped: state.dropped,
		clamped,
		sampling,
		thinking: state.thinking,
		thinkingBudget: state.thinkingBudget,
		marker: s.toolErrors ? s.toolErrorMarker : undefined,
		state
	});
	if (clamped.length > 0) state.clamped = clamped;
	return {
		body: out,
		state
	};
}

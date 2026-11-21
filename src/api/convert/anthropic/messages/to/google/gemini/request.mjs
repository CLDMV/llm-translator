/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/anthropic/messages/to/google/gemini/request.mjs
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
 * @fileoverview Anthropic Messages request to a Google Gemini `generateContent` request.
 * @module @cldmv/llm-translator/convert
 */
import { resolve } from "../../../../../../../lib/settings.mjs";
import { chatBody } from "../../../../../../../lib/gemini.mjs";
import { request as toChat } from "../../openai/chat/request.mjs";

/**
 * Settings the Gemini API does not choose: the output cap is always `generationConfig.maxOutputTokens`, `top_k` is a generation field, thinking
 * is sent as a budget (from `thinking.budget_tokens`, or from the effort, `none` meaning off) and a trailing assistant message is an ordinary
 * turn. Thought signatures always travel with the conversation (`reasoningRoundTrip`), because Gemini 3 models refuse a tool turn that lacks its
 * signature. These override the upstream's own values.
 */
/** @type {Partial<import("../../../../../../../lib/settings.mjs").Settings>} */
const NATIVE = {
	maxTokensField: "max_tokens",
	thinking: "reasoning_effort",
	thinkingBudget: false,
	effort: true,
	topK: true,
	prefill: "none",
	streamUsage: false,
	continuousUsage: false,
	reasoningRoundTrip: true
};

/**
 * Convert an Anthropic Messages request to a `generateContent` body. The Anthropic conversion to Chat Completions does the work (system, tool
 * blocks, images, tool names, dropped fields, the thought signatures a client sent back); `chatBody` then puts the result in Gemini's shape (see
 * there). `thinking: { type: "enabled", budget_tokens }` is sent as `thinkingConfig.thinkingBudget`; an effort or `thinking: { type:
 * "disabled" }` becomes a budget too. The upstream's `sampling` setting and `metadata.sampling` become further `generationConfig` fields.
 * @param {any} body - Anthropic request body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @param {any} [context] - `{ producer, budget, listed, toolCallIds }`, as for the Chat Completions conversion.
 * @returns {Promise<{body: any, state: any}>} The Gemini body and the conversion state the response converters read.
 */
export async function request(body, settings, context) {
	const s = resolve(settings);
	const { body: chat, state } = await toChat(body, { ...s, ...NATIVE }, context);
	const asked = body.metadata?.sampling;
	const sampling = { ...s.sampling, ...(asked !== null && typeof asked === "object" && !Array.isArray(asked) ? asked : {}) };
	return {
		body: chatBody(chat, {
			dropped: state.dropped,
			sampling,
			thinkingBudget: state.thinkingBudget,
			marker: s.toolErrors ? s.toolErrorMarker : undefined
		}),
		state
	};
}

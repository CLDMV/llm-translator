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
import { expand } from "../../../../../../../lib/documents.mjs";
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
 * Document handling for Gemini, which reads PDFs itself: a base64 PDF goes through as an `application/pdf` image-typed block (the Chat
 * Completions conversion turns it into a data URL part and `chatBody` into `inlineData`), and any other document is expanded as it would be
 * without this.
 * @param {any} block - Anthropic `document` block.
 * @param {any} ctx - Document conversion context.
 * @returns {Promise<any[]>} Content blocks.
 */
async function document(block, ctx) {
	if (block.source?.type === "base64" && block.source.media_type === "application/pdf") return [{ type: "image", source: block.source }];
	return expand(block, { ...ctx, settings: { ...ctx.settings, documentConverter: null } });
}

/**
 * Convert an Anthropic Messages request to a `generateContent` body. The Anthropic conversion to Chat Completions does the work (system, tool
 * blocks, images, tool names, dropped fields, the thought signatures a client sent back); `chatBody` then puts the result in Gemini's shape (see
 * there). `thinking: { type: "enabled", budget_tokens }` is sent as `thinkingConfig.thinkingBudget`; an effort or `thinking: { type:
 * "disabled" }` becomes a budget too (a level on a Gemini 3 model, chosen by the model sent). Base64 PDFs are sent as they are, for Gemini to read. The upstream's `sampling` setting and `metadata.sampling` become further `generationConfig` fields.
 * @param {any} body - Anthropic request body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @param {any} [context] - `{ producer, budget, listed, toolCallIds, model }`, as for the Chat Completions conversion; `model` is the model the request goes to, which decides between a thinking budget and a level.
 * @returns {Promise<{body: any, state: any}>} The Gemini body and the conversion state the response converters read.
 */
export async function request(body, settings, context) {
	const s = resolve(settings);
	// With `documents: "extract"` and images on, and no converter of the upstream's own, PDFs go through whole.
	const raw = s.documents === "extract" && s.images && !s.documentConverter;
	const { body: chat, state } = await toChat(body, { ...s, ...NATIVE, ...(raw ? { documentConverter: document } : {}) }, context);
	const asked = body.metadata?.sampling;
	const sampling = { ...s.sampling, ...(asked !== null && typeof asked === "object" && !Array.isArray(asked) ? asked : {}) };
	return {
		body: chatBody(chat, {
			dropped: state.dropped,
			sampling,
			thinkingBudget: state.thinkingBudget,
			model: context?.model,
			marker: s.toolErrors ? s.toolErrorMarker : undefined
		}),
		state
	};
}

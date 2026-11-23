/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/anthropic/messages/to/bedrock/converse/request.mjs
 *	@Date: 2026-11-19T09:00:00-08:00 (1795107600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-19T09:00:00-08:00 (1795107600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Anthropic Messages request to an Amazon Bedrock Converse request.
 * @module @cldmv/llm-translator/convert
 */
import { resolve } from "../../../../../../../lib/settings.mjs";
import { chatBody } from "../../../../../../../lib/converse.mjs";
import { request as toChat } from "../../openai/chat/request.mjs";

/**
 * Settings the Converse API does not choose: the output cap is always `inferenceConfig.maxTokens`, `top_k` is a model field, thinking is sent
 * from its budget (not as a template switch or an effort), and a trailing assistant message is an ordinary turn. Signed reasoning always travels with the
 * conversation (`reasoningRoundTrip`): the thinking blocks of a reply carry it in their signature, and a Claude model that thinks refuses a turn with tool calls
 * whose signed reasoning is missing. These override the upstream's own values.
 */
/** @type {Partial<import("../../../../../../../lib/settings.mjs").Settings>} */
const NATIVE = {
	maxTokensField: "max_tokens",
	thinking: "none",
	thinkingBudget: false,
	effort: false,
	topK: true,
	prefill: "none",
	streamUsage: false,
	continuousUsage: false,
	reasoningRoundTrip: true
};

/**
 * Convert an Anthropic Messages request to a Converse body. The Anthropic conversion to Chat Completions does the work (system, tool blocks,
 * images, tool names, dropped fields); `chatBody` then puts the result in Converse's shape (see there). `thinking: { type: "enabled",
 * budget_tokens }` is sent as `additionalModelRequestFields.thinking` (the Claude form); other thinking modes and an effort are left out and
 * named in `dropped`. The upstream's `sampling` setting and `metadata.sampling` become further `additionalModelRequestFields`. A `cache_control` marker on a
 * tool, a system block, a content block or the request itself becomes a `cachePoint` after that part (unless the upstream's `bedrock.cache` setting is false).
 * @param {any} body - Anthropic request body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @param {any} [context] - `{ producer, budget, listed, toolCallIds }`, as for the Chat Completions conversion.
 * @returns {Promise<{body: any, state: any}>} The Converse body and the conversion state the response converters read.
 */
export async function request(body, settings, context) {
	const s = resolve(settings);
	const cache = s.bedrock.cache !== false;
	const { body: chat, state } = await toChat(body, { ...s, ...NATIVE }, { ...context, cachePoints: cache });
	const asked = body.metadata?.sampling;
	const sampling = { ...s.sampling, ...(asked !== null && typeof asked === "object" && !Array.isArray(asked) ? asked : {}) };
	if (state.thinking !== null && state.thinking !== "disabled" && state.thinkingBudget === undefined) state.dropped.push("thinking");
	return {
		body: chatBody(chat, {
			dropped: state.dropped,
			sampling,
			thinkingBudget: state.thinkingBudget,
			marker: s.toolErrors ? s.toolErrorMarker : undefined,
			cache,
			state
		}),
		state
	};
}

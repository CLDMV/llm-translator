/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/anthropic/messages/to/ollama/chat/request.mjs
 *	@Date: 2026-11-13T11:00:00-08:00 (1794596400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-13T11:00:00-08:00 (1794596400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Anthropic Messages request to an Ollama native `/api/chat` request.
 * @module @cldmv/llm-translator/convert
 */
import { resolve } from "../../../../../../../lib/settings.mjs";
import { chatBody } from "../../../../../../../lib/ollama.mjs";
import { request as toChat } from "../../openai/chat/request.mjs";

/**
 * Settings the native API does not choose: the output cap is always `options.num_predict`, `top_k` is an option, thinking is `think` (the
 * switch plus an effort when the request names one), and a trailing assistant message is an ordinary turn. These override the upstream's own values.
 */
/** @type {Partial<import("../../../../../../../lib/settings.mjs").Settings>} */
const NATIVE = {
	maxTokensField: "max_tokens",
	thinking: "chat_template_kwargs",
	thinkingBudget: false,
	effort: true,
	topK: true,
	prefill: "none",
	streamUsage: false,
	continuousUsage: false,
	parallelToolCalls: false,
	reasoningRoundTrip: false,
	reasoningField: "reasoning_content",
	responseFormat: true
};

/**
 * Convert an Anthropic Messages request to an Ollama `/api/chat` body. The Anthropic conversion to Chat Completions does the work (system, tool
 * blocks, images, tool names, dropped fields); `chatBody` then puts the result in Ollama's shape: tool arguments as objects, tool results by tool
 * name, `images` as base64, the sampling fields and `max_tokens` in `options`, `thinking` and `output_config.effort` as `think`, and
 * `output_config.format` as `format`. The upstream's `sampling` setting and `metadata.sampling` become further `options`.
 * @param {any} body - Anthropic request body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @param {any} [context] - `{ producer, budget, listed, toolCallIds }`, as for the Chat Completions conversion.
 * @returns {Promise<{body: any, state: any}>} The Ollama body and the conversion state the response converters read.
 */
export async function request(body, settings, context) {
	const s = resolve(settings);
	const { body: chat, state } = await toChat(body, { ...s, ...NATIVE }, context);
	const asked = body.metadata?.sampling;
	const sampling = { ...s.sampling, ...(asked !== null && typeof asked === "object" && !Array.isArray(asked) ? asked : {}) };
	return { body: chatBody(chat, { dropped: state.dropped, sampling }), state };
}

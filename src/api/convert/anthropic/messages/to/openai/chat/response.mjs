/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/anthropic/messages/to/openai/chat/response.mjs
 *	@Date: 2026-10-25T12:28:19-07:00 (1792956499)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:58:59-07:00 (1792958339)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Anthropic Messages response to OpenAI Chat Completions response.
 */

import { resolve } from "../../../../../../../lib/settings.mjs";
import { restoreName } from "../../../../../../../lib/ids.mjs";
import { toOpenAIFinish, toOpenAIUsage } from "../../../../../../../lib/finish.mjs";

/**
 * Convert an Anthropic message into an OpenAI `chat.completion`. Text blocks are concatenated, `thinking` blocks
 * become the reasoning field named by `reasoningField`, `tool_use` blocks become `tool_calls` (tool names restored
 * through `state.toolNames`), and other block types (server tool results, redacted thinking) are skipped.
 * @param {any} message - Anthropic message.
 * @param {any} [state] - State from the request converter (original model, tool-name map).
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {any} OpenAI chat completion.
 */
export function response(message, state, settings) {
	const s = resolve(settings);
	const toolNames = state?.toolNames ?? {};
	const text = [];
	const reasoning = [];
	const toolCalls = [];
	for (const block of message.content ?? []) {
		if (block.type === "text") text.push(block.text);
		else if (block.type === "thinking") reasoning.push(block.thinking);
		else if (block.type === "tool_use") {
			toolCalls.push({
				id: block.id,
				type: "function",
				function: { name: restoreName(toolNames, block.name), arguments: JSON.stringify(block.input ?? {}) }
			});
		}
	}
	const out = { role: "assistant", content: text.length === 0 && toolCalls.length > 0 ? null : text.join("") };
	if (reasoning.length > 0) out[s.reasoningField] = reasoning.join("");
	if (toolCalls.length > 0) out.tool_calls = toolCalls;
	const choice = { index: 0, message: out, finish_reason: toOpenAIFinish(message.stop_reason) };
	if (typeof message.stop_sequence === "string") choice.stop_reason = message.stop_sequence;
	return {
		id: `chatcmpl-${String(message.id).replace(/^msg_/, "")}`,
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model: state?.model ?? message.model,
		choices: [choice],
		usage: toOpenAIUsage(message.usage)
	};
}

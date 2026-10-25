/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/openai/chat/to/anthropic/messages/response.mjs
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
 * @fileoverview OpenAI Chat Completions response to Anthropic Messages response.
 */

import { resolve } from "../../../../../../../lib/settings.mjs";
import { TranslatorError } from "../../../../../../../lib/errors.mjs";
import { messageId, anthropicToolId, restoreName } from "../../../../../../../lib/ids.mjs";
import { sign, reasoningOf, splitThink } from "../../../../../../../lib/thinking.mjs";
import { isComplete, parseArguments } from "../../../../../../../lib/arguments.mjs";
import { toAnthropicStop, toAnthropicUsage } from "../../../../../../../lib/finish.mjs";

/**
 * Convert a (non-streaming) OpenAI chat completion into an Anthropic message.
 *
 * Reasoning (`reasoning`, `reasoning_content`, or a leading `<think>` block when `thinkTags` is on) becomes a
 * `thinking` block with a translator-marked signature. Tool calls become `tool_use` blocks; arguments that are not
 * a JSON object are passed through under `_raw_arguments` so the client reports a tool error the model can recover
 * from.
 * @param {any} completion - OpenAI `chat.completion` object.
 * @param {any} [state] - State from the request converter (original model, tool-name map).
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {any} Anthropic message.
 * @throws {TranslatorError} When the completion has no choices.
 */
export function response(completion, state, settings) {
	const s = resolve(settings);
	const choice = completion?.choices?.[0];
	if (!choice) {
		throw new TranslatorError("Upstream response contained no choices", { code: "invalid_upstream_response", status: 502 });
	}
	const message = choice.message ?? {};
	const content = [];

	let reasoning = reasoningOf(message);
	let text = typeof message.content === "string" ? message.content : "";
	if (reasoning === "" && s.thinkTags) ({ reasoning, text } = splitThink(text));
	if (reasoning !== "") content.push({ type: "thinking", thinking: reasoning, signature: sign() });
	if (text === "" && typeof message.refusal === "string") text = message.refusal;
	if (text !== "") content.push({ type: "text", text });

	const toolNames = state?.toolNames ?? {};
	const calls = message.tool_calls ?? [];
	for (const call of calls) {
		content.push({
			type: "tool_use",
			id: anthropicToolId(call.id),
			name: restoreName(toolNames, call.function.name),
			input: parseArguments(call.function.arguments)
		});
	}

	if (content.length === 0) content.push({ type: "text", text: "" });
	const stop = toAnthropicStop(choice.finish_reason, {
		hasToolCalls: calls.length > 0,
		matchedStop: choice.stop_reason,
		argumentsComplete: calls.length === 0 || isComplete(calls.at(-1).function.arguments)
	});
	return {
		id: messageId(),
		type: "message",
		role: "assistant",
		model: state?.model ?? completion.model,
		content,
		...stop,
		usage: toAnthropicUsage(completion.usage)
	};
}

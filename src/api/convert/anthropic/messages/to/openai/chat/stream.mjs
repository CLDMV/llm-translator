/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/anthropic/messages/to/openai/chat/stream.mjs
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
 * @fileoverview Anthropic Messages stream events to OpenAI Chat Completions chunks.
 */

import { resolve } from "../../../../../../../lib/settings.mjs";
import { anthropicToOpenAIType, anthropicTypeToStatus } from "../../../../../../../lib/errors.mjs";
import { completionId, restoreName } from "../../../../../../../lib/ids.mjs";
import { toOpenAIFinish, toOpenAIUsage } from "../../../../../../../lib/finish.mjs";
import { messages } from "../../../../../../../lib/sse.mjs";

/**
 * Convert an Anthropic Messages event stream into OpenAI `chat.completion.chunk` messages followed by `[DONE]`.
 *
 * `source` is SSE text/bytes, an iterable of `{ event, data }` pairs, or an iterable of bare event payloads. The
 * result yields `{ data }` messages (chunk objects, then the string `"[DONE]"`); encode them with `lib/sse.mjs`.
 * Usage is emitted as a final `choices: []` chunk when `state.includeUsage` is not false. An Anthropic `error`
 * event, or a stream that ends before `message_stop`, becomes a `{ error }` chunk followed by `[DONE]`.
 * @param {ReadableStream|AsyncIterable<unknown>|Iterable<unknown>|string|Uint8Array} source - Anthropic stream.
 * @param {any} [state] - State from the request converter (model, `includeUsage`, tool-name map).
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {AsyncGenerator<{ data: any|string }, void, undefined>} OpenAI chunks.
 */
export async function* stream(source, state, settings) {
	const s = resolve(settings);
	const toolNames = state?.toolNames ?? {};
	const includeUsage = state?.includeUsage ?? true;
	const created = Math.floor(Date.now() / 1000);
	const tools = new Map();
	let id = completionId();
	let model = state?.model;
	let usage = {};
	let finished = false;

	const chunk = (delta, finishReason = null, extra = {}) => ({
		data: {
			id,
			object: "chat.completion.chunk",
			created,
			model,
			choices: [{ index: 0, delta, finish_reason: finishReason, ...extra }]
		}
	});
	const failure = (type, message) => ({
		data: { error: { message, type: anthropicToOpenAIType(type), param: null, code: anthropicTypeToStatus(type) } }
	});

	try {
		for await (const { data } of messages(source)) {
			if (data.type === "message_start") {
				id = `chatcmpl-${String(data.message.id).replace(/^msg_/, "")}`;
				model = state?.model ?? data.message.model;
				usage = { ...data.message.usage };
				yield chunk({ role: "assistant", content: "" });
			} else if (data.type === "content_block_start") {
				const block = data.content_block;
				if (block.type === "tool_use") {
					tools.set(data.index, tools.size);
					const name = restoreName(toolNames, block.name);
					yield chunk({
						tool_calls: [{ index: tools.get(data.index), id: block.id, type: "function", function: { name, arguments: "" } }]
					});
				}
			} else if (data.type === "content_block_delta") {
				const delta = data.delta;
				if (delta.type === "text_delta") yield chunk({ content: delta.text });
				else if (delta.type === "thinking_delta") yield chunk({ [s.reasoningField]: delta.thinking });
				else if (delta.type === "input_json_delta" && tools.has(data.index)) {
					yield chunk({ tool_calls: [{ index: tools.get(data.index), function: { arguments: delta.partial_json } }] });
				}
			} else if (data.type === "message_delta") {
				for (const [key, value] of Object.entries(data.usage ?? {})) if (value !== null && value !== undefined) usage[key] = value;
				const extra = typeof data.delta?.stop_sequence === "string" ? { stop_reason: data.delta.stop_sequence } : {};
				yield chunk({}, toOpenAIFinish(data.delta?.stop_reason), extra);
			} else if (data.type === "message_stop") {
				finished = true;
				break;
			} else if (data.type === "error") {
				yield failure(data.error.type, data.error.message);
				yield { data: "[DONE]" };
				return;
			}
		}
	} catch (error) {
		yield failure(error.type ?? "api_error", error.message);
		yield { data: "[DONE]" };
		return;
	}

	if (!finished) {
		yield failure("api_error", "Upstream stream ended before completion");
		yield { data: "[DONE]" };
		return;
	}
	if (includeUsage) {
		yield { data: { id, object: "chat.completion.chunk", created, model, choices: [], usage: toOpenAIUsage(usage) } };
	}
	yield { data: "[DONE]" };
}

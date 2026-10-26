/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/openai/chat/to/anthropic/messages/request.mjs
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
 * @fileoverview OpenAI Chat Completions request to Anthropic Messages request.
 */

import { resolve } from "../../../../../../../lib/settings.mjs";
import { TranslatorError } from "../../../../../../../lib/errors.mjs";
import { anthropicToolId, createNameFitter } from "../../../../../../../lib/ids.mjs";
import { parseArguments } from "../../../../../../../lib/arguments.mjs";
import { sanitize } from "../../../../../../../lib/schema.mjs";

const HANDLED = new Set([
	"model",
	"messages",
	"max_tokens",
	"max_completion_tokens",
	"temperature",
	"top_p",
	"top_k",
	"stop",
	"stream",
	"stream_options",
	"tools",
	"tool_choice",
	"parallel_tool_calls",
	"reasoning_effort",
	"response_format",
	"user",
	"n"
]);
const SILENT = new Set(["metadata", "store", "service_tier"]);
const DATA_URL = /^data:([^;,]+);base64,(.*)$/s;

/**
 * Convert an OpenAI Chat Completions request body into an Anthropic Messages request body (for an OpenAI-protocol
 * client talking to an Anthropic-protocol upstream).
 *
 * `system` and `developer` messages are hoisted into the top-level `system`; assistant reasoning is not forwarded
 * (real Anthropic rejects thinking blocks without its own signatures); consecutive same-role turns are merged and
 * tool results are grouped into one user turn with the results first, as Anthropic requires.
 * @param {any} chatBody - OpenAI `POST /v1/chat/completions` body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {Promise<{ body: any, state: any }>} Anthropic request body and conversion state.
 * @throws {TranslatorError} For malformed requests, `n` above 1, unknown roles, or unknown fields when configured to error.
 */
export async function request(chatBody, settings) {
	const s = resolve(settings);
	if (chatBody === null || typeof chatBody !== "object" || !Array.isArray(chatBody.messages)) {
		throw new TranslatorError("messages is a required property", { code: "invalid_request", param: "messages" });
	}
	if (chatBody.n !== undefined && chatBody.n !== 1) {
		throw new TranslatorError("n: only a single choice (n = 1) is supported", { code: "unsupported_field", param: "n" });
	}
	const state = {
		front: "openai",
		model: chatBody.model,
		stream: chatBody.stream === true,
		includeUsage: chatBody.stream_options?.include_usage === true,
		reasoningField: s.reasoningField,
		toolNames: {},
		dropped: []
	};
	const fit = createNameFitter({ max: 128, map: state.toolNames });

	for (const key of Object.keys(chatBody)) {
		if (HANDLED.has(key) || SILENT.has(key)) continue;
		if (s.unknownFields === "error")
			throw new TranslatorError(`${key}: Unrecognized request argument`, { code: "unsupported_field", param: key });
		drop(state, key);
	}

	const system = [];
	const turns = [];
	const push = (role, blocks) => {
		const last = turns.at(-1);
		if (last?.role === role) last.blocks.push(...blocks);
		else turns.push({ role, blocks: [...blocks] });
	};

	for (const message of chatBody.messages) {
		switch (message.role) {
			case "system":
			case "developer": {
				const text = plainText(message.content);
				if (text !== "") system.push(text);
				break;
			}
			case "user":
				push("user", userBlocks(message.content, state));
				break;
			case "assistant": {
				const blocks = [];
				const text = plainText(message.content);
				if (text !== "") blocks.push({ type: "text", text });
				else if (typeof message.refusal === "string" && message.refusal !== "") blocks.push({ type: "text", text: message.refusal });
				if (reasoningPresent(message)) drop(state, "reasoning");
				for (const call of message.tool_calls ?? []) {
					blocks.push({
						type: "tool_use",
						id: anthropicToolId(call.id),
						name: fit(call.function.name),
						input: parseArguments(call.function.arguments)
					});
				}
				if (blocks.length > 0) push("assistant", blocks);
				break;
			}
			case "tool": {
				const result = { type: "tool_result", tool_use_id: anthropicToolId(message.tool_call_id), content: plainText(message.content) };
				const last = turns.at(-1);
				if (last?.role === "user") {
					const firstOther = last.blocks.findIndex((b) => b.type !== "tool_result");
					last.blocks.splice(firstOther === -1 ? last.blocks.length : firstOther, 0, result);
				} else turns.push({ role: "user", blocks: [result] });
				break;
			}
			default:
				throw new TranslatorError(`messages: unsupported role "${message.role}"`, { code: "invalid_request", param: "messages" });
		}
	}

	const out = { model: chatBody.model, max_tokens: chatBody.max_completion_tokens ?? chatBody.max_tokens ?? s.defaultMaxTokens };
	if (system.length > 0) out.system = system.join("\n\n");
	out.messages = turns.map((t) => ({ role: t.role, content: t.blocks }));
	if (chatBody.temperature !== undefined) out.temperature = Math.min(1, chatBody.temperature);
	if (chatBody.top_p !== undefined) out.top_p = chatBody.top_p;
	if (chatBody.top_k !== undefined) out.top_k = chatBody.top_k;
	if (chatBody.stop !== undefined && chatBody.stop !== null) out.stop_sequences = [].concat(chatBody.stop);
	if (state.stream) out.stream = true;
	if (typeof chatBody.user === "string") out.metadata = { user_id: chatBody.user };

	const tools = [];
	for (const tool of chatBody.tools ?? []) {
		if (tool.type !== "function") {
			drop(state, `tool:${tool.type}`);
			continue;
		}
		const fn = tool.function;
		const schema = fn.parameters ?? { type: "object", properties: {} };
		const converted = { name: fit(fn.name), input_schema: s.toolSchema === "sanitize" ? sanitize(schema) : schema };
		if (fn.description !== undefined) converted.description = fn.description;
		tools.push(converted);
	}
	if (tools.length > 0) {
		out.tools = tools;
		let choice = toolChoice(chatBody.tool_choice, fit);
		if (chatBody.parallel_tool_calls === false && choice.type !== "none") choice = { ...choice, disable_parallel_tool_use: true };
		if (chatBody.tool_choice !== undefined || chatBody.parallel_tool_calls === false) out.tool_choice = choice;
	}

	const effort = chatBody.reasoning_effort;
	if (effort === "none") out.thinking = { type: "disabled" };
	else if (effort !== undefined && effort !== null) {
		out.thinking = { type: "adaptive" };
		out.output_config = { effort: effort === "minimal" ? "low" : effort };
	}
	const format = chatBody.response_format;
	if (format?.type === "json_schema") {
		out.output_config = { ...out.output_config, format: { type: "json_schema", schema: format.json_schema.schema } };
	} else if (format?.type === "json_object") drop(state, "response_format");

	return { body: out, state };
}

/**
 * Record a dropped field once.
 * @param {{ dropped: string[] }} state - Conversion state.
 * @param {string} name - Field or feature name.
 */
function drop(state, name) {
	if (!state.dropped.includes(name)) state.dropped.push(name);
}

/**
 * Whether an assistant message carries reasoning in either field.
 * @param {{ reasoning?: unknown, reasoning_content?: unknown }} message - Assistant message.
 * @returns {boolean} True when non-empty reasoning is present.
 */
function reasoningPresent(message) {
	return Boolean(message.reasoning || message.reasoning_content);
}

/**
 * Text of OpenAI content (string or text parts).
 * @param {string|any[]|null|undefined} content - Message content.
 * @returns {string} Joined text ("" when none).
 */
function plainText(content) {
	if (typeof content === "string") return content;
	return (content ?? [])
		.filter((p) => p.type === "text")
		.map((p) => p.text)
		.join("\n\n");
}

/**
 * Anthropic blocks for a user message.
 * @param {string|any[]} content - OpenAI user content.
 * @param {{ dropped: string[] }} state - Conversion state.
 * @returns {any[]} Blocks.
 */
function userBlocks(content, state) {
	if (typeof content === "string") return content === "" ? [] : [{ type: "text", text: content }];
	const blocks = [];
	for (const part of content ?? []) {
		if (part.type === "text") blocks.push({ type: "text", text: part.text });
		else if (part.type === "image_url") {
			const match = DATA_URL.exec(part.image_url.url);
			blocks.push({
				type: "image",
				source: match ? { type: "base64", media_type: match[1], data: match[2] } : { type: "url", url: part.image_url.url }
			});
		} else if (part.type === "file" && typeof part.file?.file_data === "string" && DATA_URL.test(part.file.file_data)) {
			const match = DATA_URL.exec(part.file.file_data);
			blocks.push({ type: "document", source: { type: "base64", media_type: match[1], data: match[2] } });
		} else {
			drop(state, `content:${part.type}`);
		}
	}
	return blocks;
}

/**
 * Convert `tool_choice`.
 * @param {string|any|undefined} choice - OpenAI tool_choice.
 * @param {(name: string) => string} fit - Tool name fitter.
 * @returns {{ type: string, name?: string, disable_parallel_tool_use?: boolean }} Anthropic tool_choice.
 */
function toolChoice(choice, fit) {
	if (choice === "none") return { type: "none" };
	if (choice === "required") return { type: "any" };
	if (typeof choice === "object" && choice !== null) return { type: "tool", name: fit(choice.function.name) };
	return { type: "auto" };
}

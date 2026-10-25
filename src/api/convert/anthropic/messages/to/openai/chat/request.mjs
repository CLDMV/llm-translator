/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/anthropic/messages/to/openai/chat/request.mjs
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
 * @fileoverview Anthropic Messages request to OpenAI Chat Completions request.
 */

import { resolve } from "../../../../../../../lib/settings.mjs";
import { TranslatorError } from "../../../../../../../lib/errors.mjs";
import { createNameFitter } from "../../../../../../../lib/ids.mjs";
import { sanitize } from "../../../../../../../lib/schema.mjs";
import { expand } from "../../../../../../../lib/documents.mjs";

const HANDLED = new Set([
	"model",
	"messages",
	"system",
	"max_tokens",
	"stream",
	"temperature",
	"top_p",
	"top_k",
	"stop_sequences",
	"tools",
	"tool_choice",
	"thinking",
	"output_config",
	"output_format",
	"context_management"
]);
const SILENT = new Set(["metadata", "cache_control", "service_tier"]);
const NOTED = new Set(["mcp_servers", "container", "inference_geo"]);
const BILLING = "x-anthropic-billing-header:";

/**
 * Convert an Anthropic Messages request body into an OpenAI Chat Completions request body.
 *
 * Returns the converted body plus a JSON-serializable `state` the response/stream converters need (original model,
 * tool-name map, thinking mode, fields that were dropped).
 * @param {any} body - Anthropic `POST /v1/messages` body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {Promise<{ body: any, state: any }>} OpenAI request body and conversion state.
 * @throws {TranslatorError} For malformed requests, unsupported content when configured to error, or PDF limit violations.
 */
export async function request(body, settings) {
	const s = resolve(settings);
	if (body === null || typeof body !== "object" || !Array.isArray(body.messages)) {
		throw new TranslatorError("messages: Field required", { code: "invalid_request", param: "messages" });
	}
	const state = {
		front: "anthropic",
		model: body.model,
		stream: body.stream === true,
		thinking: body.thinking?.type ?? null,
		reasoningField: s.reasoningField,
		toolNames: {},
		dropped: []
	};
	const fit = createNameFitter({ max: 64, map: state.toolNames });

	for (const key of Object.keys(body)) {
		if (HANDLED.has(key) || SILENT.has(key)) continue;
		if (NOTED.has(key)) drop(state, key);
		else if (s.unknownFields === "error") {
			throw new TranslatorError(`${key}: Extra inputs are not permitted`, { code: "unsupported_field", param: key });
		} else drop(state, key);
	}

	const out = { model: body.model };
	const system = textOf(body.system, s);
	const conversation = await convertMessages(body.messages, s, state, fit, system, thinkingTurnsToKeep(body.context_management, state));
	out.messages = conversation.messages;
	if (conversation.prefill) {
		out.continue_final_message = true;
		out.add_generation_prompt = false;
	}

	if (body.max_tokens !== undefined) out[s.maxTokensField] = body.max_tokens;
	if (body.temperature !== undefined) out.temperature = body.temperature;
	if (body.top_p !== undefined) out.top_p = body.top_p;
	if (body.top_k !== undefined) {
		if (s.topK) out.top_k = body.top_k;
		else drop(state, "top_k");
	}
	if (body.stop_sequences?.length > 0) out.stop = body.stop_sequences;
	if (state.stream) {
		out.stream = true;
		if (s.streamUsage) {
			out.stream_options = { include_usage: true };
			if (s.continuousUsage) out.stream_options.continuous_usage_stats = true;
		}
	}

	const tools = convertTools(body.tools ?? [], s, state, fit);
	if (tools.length > 0) {
		out.tools = tools;
		const choice = convertToolChoice(body.tool_choice, s, state, fit);
		if (choice !== undefined) out.tool_choice = choice;
		if (body.tool_choice?.disable_parallel_tool_use === true && s.parallelToolCalls) out.parallel_tool_calls = false;
	}

	applyThinking(body, s, out);
	applyOutputConfig(body, s, state, out);
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
 * Handle a content block or field that has no mapping.
 * @param {{ dropped: string[] }} state - Conversion state.
 * @param {import("../../../../../../../lib/settings.mjs").Settings} s - Settings.
 * @param {string} name - Feature name.
 * @throws {TranslatorError} When `unknownFields` is `"error"`.
 */
function unsupported(state, s, name) {
	if (s.unknownFields === "error") {
		throw new TranslatorError(`${name}: is not supported by this translator`, { code: "unsupported_content", param: name });
	}
	drop(state, name);
}

/**
 * Plain text of a system value or content (string, or text blocks), minus the billing-header block.
 * @param {string|any[]|undefined} value - String or text blocks.
 * @param {import("../../../../../../../lib/settings.mjs").Settings} s - Settings.
 * @returns {string} Joined text ("" when empty).
 */
function textOf(value, s) {
	if (value === undefined || value === null) return "";
	const blocks = typeof value === "string" ? [{ type: "text", text: value }] : value;
	return blocks
		.filter((b) => b.type === "text" && !(s.stripBillingHeader && b.text.trimStart().startsWith(BILLING)))
		.map((b) => b.text)
		.join("\n\n");
}

/**
 * Content as a block array.
 * @param {string|any[]|undefined} content - Message content.
 * @returns {any[]} Blocks.
 */
function asBlocks(content) {
	if (typeof content === "string") return [{ type: "text", text: content }];
	return content ?? [];
}

/**
 * Convert a list of Anthropic messages.
 * @param {any[]} messages - Anthropic messages.
 * @param {import("../../../../../../../lib/settings.mjs").Settings} s - Settings.
 * @param {any} state - Conversion state.
 * @param {(name: string) => string} fit - Tool name fitter.
 * @param {string} system - Leading system text.
 * @param {number} keepThinking - Reasoning-bearing assistant turns to keep.
 * @returns {Promise<{ messages: any[], prefill: boolean }>} OpenAI messages and whether the last message is a prefill.
 */
async function convertMessages(messages, s, state, fit, system, keepThinking) {
	const out = [];
	const hoisted = [];
	const toolInputs = new Map();
	const mode = s.inlineSystem === "auto" ? "user" : s.inlineSystem;

	const pushUser = (parts) => {
		const last = out.at(-1);
		if (last?.role === "user") last.parts.push(...parts);
		else out.push({ role: "user", parts });
	};

	/**
	 * Convert one content block into OpenAI content parts.
	 * @param {any} block - Anthropic block.
	 * @param {string|null} toolUseId - Owning tool call id for blocks inside a tool result.
	 * @returns {Promise<any[]>} Parts.
	 */
	const toParts = async (block, toolUseId) => {
		switch (block.type) {
			case "text":
				return block.text === "" ? [] : [{ type: "text", text: block.text }];
			case "image":
				return imageParts(block, s, state);
			case "document": {
				const parts = [];
				for (const inner of await expand(block, { settings: s, toolInputs, toolUseId })) parts.push(...(await toParts(inner, toolUseId)));
				return parts;
			}
			case "search_result": {
				const body = (block.content ?? []).map((c) => c.text).join("\n");
				return [{ type: "text", text: `[Search result: ${block.title ?? ""} (${block.source ?? ""})]\n${body}` }];
			}
			case "tool_reference":
				return [{ type: "text", text: `[Tool reference: ${block.tool_name}]` }];
			default:
				unsupported(state, s, `block:${block.type}`);
				return [];
		}
	};

	for (const message of messages) {
		if (message.role === "system") {
			const text = textOf(message.content, s);
			if (text === "" || mode === "drop") continue;
			if (mode === "keep") out.push({ role: "system", content: text });
			else if (mode === "hoist") hoisted.push(text);
			else {
				const wrapped = text.trimStart().startsWith("<system-reminder>") ? text : `<system-reminder>\n${text}\n</system-reminder>`;
				pushUser([{ type: "text", text: wrapped }]);
			}
		} else if (message.role === "user") {
			const parts = [];
			const toolParts = [];
			for (const block of asBlocks(message.content)) {
				if (block.type !== "tool_result") {
					parts.push(...(await toParts(block, null)));
					continue;
				}
				const inner = [];
				for (const c of asBlocks(block.content)) inner.push(...(await toParts(c, block.tool_use_id)));
				const texts = inner.filter((p) => p.type === "text").map((p) => p.text);
				const images = inner.filter((p) => p.type === "image_url");
				let content = texts.join("\n");
				if (images.length > 0) {
					toolParts.push({ type: "text", text: `Image output of tool call ${block.tool_use_id}:` }, ...images);
					if (content === "") content = "(image output attached in the next message)";
				}
				if (block.is_error === true && s.toolErrors) content = `[error] ${content}`;
				out.push({ role: "tool", tool_call_id: block.tool_use_id, content });
			}
			const all = [...toolParts, ...parts];
			if (all.length > 0) pushUser(all);
		} else if (message.role === "assistant") {
			const turn = { role: "assistant", texts: [], reasoning: [], tool_calls: [] };
			for (const block of asBlocks(message.content)) {
				if (block.type === "text") {
					if (block.text !== "") turn.texts.push(block.text);
				} else if (block.type === "thinking") {
					if (block.thinking) turn.reasoning.push(block.thinking);
				} else if (block.type === "redacted_thinking") {
					drop(state, "redacted_thinking");
				} else if (block.type === "tool_use") {
					toolInputs.set(block.id, block.input);
					turn.tool_calls.push({
						id: block.id,
						type: "function",
						function: { name: fit(block.name), arguments: JSON.stringify(block.input ?? {}) }
					});
				} else {
					unsupported(state, s, `block:${block.type}`);
				}
			}
			const last = out.at(-1);
			if (last?.role === "assistant") {
				last.texts.push(...turn.texts);
				last.reasoning.push(...turn.reasoning);
				last.tool_calls.push(...turn.tool_calls);
			} else out.push(turn);
		} else {
			throw new TranslatorError(`messages: unsupported role "${message.role}"`, { code: "invalid_request", param: "messages" });
		}
	}

	return finalize(out, s, system, hoisted, keepThinking);
}

/**
 * How many assistant turns keep their reasoning, from `context_management` `clear_thinking` edits (Infinity = all).
 * @param {any|undefined} contextManagement - Anthropic `context_management`.
 * @param {any} state - Conversion state.
 * @returns {number} Number of most recent reasoning-bearing turns to keep.
 */
function thinkingTurnsToKeep(contextManagement, state) {
	let keep = Infinity;
	for (const edit of contextManagement?.edits ?? []) {
		if (typeof edit.type === "string" && edit.type.startsWith("clear_thinking")) {
			if (edit.keep === "all") keep = Infinity;
			else keep = edit.keep?.value ?? 1;
		} else drop(state, `context_management.${edit.type}`);
	}
	return keep;
}

/**
 * Turn the internal message list into OpenAI messages: join text, place reasoning, apply the thinking-turn limit
 * and detect a trailing prefill.
 * @param {any[]} out - Internal messages.
 * @param {import("../../../../../../../lib/settings.mjs").Settings} s - Settings.
 * @param {string} system - Leading system text.
 * @param {string[]} hoisted - Inline system texts to append to the leading system message.
 * @param {number} keepThinking - Number of reasoning-bearing assistant turns to keep.
 * @returns {{ messages: any[], prefill: boolean }} Final messages.
 */
function finalize(out, s, system, hoisted, keepThinking) {
	let remaining = keepThinking;
	for (let i = out.length - 1; i >= 0; i--) {
		if (out[i].role !== "assistant" || out[i].reasoning.length === 0) continue;
		if (remaining > 0) remaining--;
		else out[i].reasoning = [];
	}
	const messages = [];
	const lead = [system, ...hoisted].filter((t) => t !== "").join("\n\n");
	if (lead !== "") messages.push({ role: "system", content: lead });
	for (const m of out) {
		if (m.role === "user") {
			const plain = m.parts.every((p) => p.type === "text");
			messages.push({ role: "user", content: plain ? m.parts.map((p) => p.text).join("\n\n") : m.parts });
		} else if (m.role === "assistant") {
			const message = { role: "assistant", content: m.texts.join("\n\n") };
			if (m.reasoning.length > 0) message[s.reasoningField] = m.reasoning.join("\n\n");
			if (m.tool_calls.length > 0) message.tool_calls = m.tool_calls;
			messages.push(message);
		} else messages.push(m);
	}
	const last = messages.at(-1);
	const prefill = s.prefill === "continue_final_message" && last?.role === "assistant" && !last.tool_calls && last.content !== "";
	return { messages, prefill };
}

/**
 * OpenAI content parts for an image block.
 * @param {any} block - Anthropic image block.
 * @param {import("../../../../../../../lib/settings.mjs").Settings} s - Settings.
 * @param {any} state - Conversion state.
 * @returns {any[]} Parts.
 */
function imageParts(block, s, state) {
	if (!s.images) {
		drop(state, "image");
		return [{ type: "text", text: "[An image was omitted because this model does not accept images.]" }];
	}
	const source = block.source;
	if (source.type === "base64") return [{ type: "image_url", image_url: { url: `data:${source.media_type};base64,${source.data}` } }];
	if (source.type === "url") return [{ type: "image_url", image_url: { url: source.url } }];
	drop(state, "image.file");
	return [{ type: "text", text: "[An image supplied as an uploaded file could not be forwarded.]" }];
}

/**
 * Convert Anthropic tools to OpenAI function tools.
 * @param {any[]} tools - Anthropic tools.
 * @param {import("../../../../../../../lib/settings.mjs").Settings} s - Settings.
 * @param {any} state - Conversion state.
 * @param {(name: string) => string} fit - Tool name fitter.
 * @returns {any[]} OpenAI tools.
 */
function convertTools(tools, s, state, fit) {
	const out = [];
	for (const tool of tools) {
		if (tool.type !== undefined && tool.type !== "custom") {
			drop(state, `tool:${tool.name}`);
			continue;
		}
		if (tool.defer_loading === true && s.deferredTools === "drop") {
			drop(state, "deferred_tools");
			continue;
		}
		const schema = tool.input_schema ?? { type: "object", properties: {} };
		const fn = { name: fit(tool.name), parameters: s.toolSchema === "sanitize" ? sanitize(schema) : schema };
		if (tool.description !== undefined) fn.description = tool.description;
		if (tool.strict !== undefined) fn.strict = tool.strict;
		out.push({ type: "function", function: fn });
	}
	return out;
}

/**
 * Convert `tool_choice`.
 * @param {any|undefined} choice - Anthropic tool_choice.
 * @param {import("../../../../../../../lib/settings.mjs").Settings} s - Settings.
 * @param {any} state - Conversion state.
 * @param {(name: string) => string} fit - Tool name fitter.
 * @returns {string|any|undefined} OpenAI tool_choice (undefined to leave it to the server default).
 */
function convertToolChoice(choice, s, state, fit) {
	switch (choice?.type) {
		case undefined:
			return undefined;
		case "auto":
			return "auto";
		case "any":
			return "required";
		case "none":
			return "none";
		case "tool":
			return { type: "function", function: { name: fit(choice.name) } };
		default:
			unsupported(state, s, `tool_choice:${choice.type}`);
			return undefined;
	}
}

/**
 * Map `thinking` and `output_config.effort` onto the server's reasoning controls.
 * @param {any} body - Anthropic body.
 * @param {import("../../../../../../../lib/settings.mjs").Settings} s - Settings.
 * @param {any} out - OpenAI body under construction.
 */
function applyThinking(body, s, out) {
	const thinking = body.thinking;
	const type = thinking?.type;
	let effort;
	if (type === "disabled") {
		if (s.thinking === "reasoning_effort") effort = "none";
		if (s.thinking === "chat_template_kwargs") out.chat_template_kwargs = { enable_thinking: false };
	} else {
		if (s.effort && body.output_config?.effort !== undefined) effort = body.output_config.effort;
		if (type === "enabled") {
			if (s.thinking === "chat_template_kwargs") {
				out.chat_template_kwargs = { enable_thinking: true };
				if (s.thinkingBudget && thinking.budget_tokens !== undefined && body.max_tokens !== undefined) {
					out.thinking_token_budget = Math.max(0, Math.min(thinking.budget_tokens, body.max_tokens - 1));
				}
			}
			if (s.thinking === "reasoning_effort" && effort === undefined) effort = "medium";
		}
	}
	if (effort !== undefined) out.reasoning_effort = effort;
}

/**
 * Map `output_config.format` (and the legacy `output_format`) to `response_format`; note other keys as dropped.
 * @param {any} body - Anthropic body.
 * @param {import("../../../../../../../lib/settings.mjs").Settings} s - Settings.
 * @param {any} state - Conversion state.
 * @param {any} out - OpenAI body under construction.
 */
function applyOutputConfig(body, s, state, out) {
	const format = body.output_config?.format ?? body.output_format;
	if (format !== undefined) {
		if (s.responseFormat && format.type === "json_schema") {
			out.response_format = { type: "json_schema", json_schema: { name: "output", schema: format.schema } };
		} else drop(state, "output_config.format");
	}
	for (const key of Object.keys(body.output_config ?? {})) {
		if (key !== "effort" && key !== "format") drop(state, `output_config.${key}`);
	}
}

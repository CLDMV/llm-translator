/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/responses-upstream.mjs
 *	@Date: 2026-11-17T12:00:00-08:00 (1794945600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-17T12:00:00-08:00 (1794945600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The Responses API as an upstream protocol (`openai.responses`): Chat Completions request to Responses request, and the
 * Responses reply (JSON or SSE) back to Chat Completions shape. The Anthropic front goes through the Chat Completions converters on both
 * sides of these, so everything here is expressed in Chat Completions terms.
 * @module @cldmv/llm-translator/lib/responses-upstream
 */
import { resolve } from "./settings.mjs";
import { TranslatorError } from "./errors.mjs";
import { completionId } from "./ids.mjs";
import { messages } from "./sse.mjs";
import { fromResponses, readAll, toAnnotation } from "./citations.mjs";

/** Protocol name of an upstream that speaks the Responses API. */
export const PROTOCOL = "openai.responses";

/** Statuses that mean the server has no Responses API: the route is missing (404, 405) or not implemented (501). */
export const MISSING = [404, 405, 501];

/** `format` of the `reasoning_details` items that carry a Responses reasoning item (the encrypted content and its summary). */
export const FORMAT = "openai-responses-v1";

const HANDLED = new Set([
	"model",
	"messages",
	"stream",
	"stream_options",
	"max_tokens",
	"max_completion_tokens",
	"temperature",
	"top_p",
	"tools",
	"tool_choice",
	"parallel_tool_calls",
	"reasoning_effort",
	"response_format",
	"user",
	"n",
	"metadata",
	"store",
	"service_tier",
	"prompt_cache_key",
	"safety_identifier",
	"verbosity",
	"llmt_native_choice",
	"llmt_native_include",
	"llmt_mcp_choice"
]);

/**
 * Record a dropped field once.
 * @param {{ dropped: string[] }} state - Conversion state.
 * @param {string} name - Field or feature name.
 */
function drop(state, name) {
	if (!state.dropped.includes(name)) state.dropped.push(name);
}

/**
 * Plain text of message content (a string, or the text parts of a list).
 * @param {string | any[] | null | undefined} content - Message content.
 * @returns {string} The text.
 */
function plainText(content) {
	if (typeof content === "string") return content;
	return (Array.isArray(content) ? content : [])
		.filter((part) => part?.type === "text")
		.map((part) => part.text)
		.join("\n\n");
}

/**
 * The Responses `input_image` / `input_file` / `input_text` parts for Chat Completions user content parts.
 * @param {any[]} parts - Chat content parts.
 * @param {{ dropped: string[] }} state - Conversion state.
 * @returns {any[]} Responses input parts.
 */
function inputParts(parts, state) {
	const out = [];
	for (const part of parts) {
		if (part?.type === "text") out.push({ type: "input_text", text: part.text });
		else if (part?.type === "image_url") {
			const image = typeof part.image_url === "string" ? { url: part.image_url } : part.image_url;
			out.push({ type: "input_image", image_url: image.url, ...(image.detail === undefined ? {} : { detail: image.detail }) });
		} else if (part?.type === "file" && part.file !== null && typeof part.file === "object") {
			const { file_id: fileId, file_data: data, filename } = part.file;
			out.push({
				type: "input_file",
				...(fileId === undefined ? {} : { file_id: fileId }),
				...(data === undefined ? {} : { file_data: data }),
				...(filename === undefined ? {} : { filename })
			});
		} else drop(state, `content:${part?.type}`);
	}
	return out;
}

/**
 * The `output` of a `function_call_output` item for a Chat Completions tool message: a string when it is all text, else a list of input parts.
 * @param {string | any[] | null | undefined} content - Tool message content.
 * @param {{ dropped: string[] }} state - Conversion state.
 * @returns {string | any[]} Output.
 */
function toolOutput(content, state) {
	if (typeof content === "string") return content;
	const parts = Array.isArray(content) ? content : [];
	if (parts.every((part) => part?.type === "text")) return parts.map((part) => part.text).join("\n");
	return inputParts(parts, state);
}

/**
 * The reasoning input items an assistant message carries: the `reasoning_details` items this translator made for a Responses reply
 * (`format` `openai-responses-v1`), in the form the API takes them back.
 * @param {any} message - Chat assistant message.
 * @returns {{ at: number, item: any }[]} Items with the position they had among what the message shows.
 */
function reasoningItems(message) {
	if (!Array.isArray(message.reasoning_details)) return [];
	const out = [];
	for (const detail of message.reasoning_details) {
		if (detail?.format !== FORMAT || typeof detail.data !== "string" || detail.data === "") continue;
		const item = { type: "reasoning", summary: [], encrypted_content: detail.data };
		if (typeof detail.id === "string" && detail.id !== "") item.id = detail.id;
		if (typeof detail.summary === "string" && detail.summary !== "") item.summary = [{ type: "summary_text", text: detail.summary }];
		out.push({ at: Number.isInteger(detail.index) && detail.index >= 0 ? detail.index : 0, item });
	}
	return out;
}

/**
 * Responses input items for one Chat Completions assistant message: its reasoning items, its text and its tool calls, with each
 * reasoning item before the part it preceded.
 * @param {any} message - Chat assistant message.
 * @param {{ dropped: string[] }} state - Conversion state.
 * @param {boolean} round - Whether reasoning items travel (`reasoningRoundTrip`).
 * @param {Set<string>} custom - Receives the ids of the custom tool calls, so their results become `custom_tool_call_output` items.
 * @returns {any[]} Input items.
 */
function assistantItems(message, state, round, custom) {
	const parts = [];
	let text = plainText(message.content);
	if (text === "" && typeof message.refusal === "string") text = message.refusal;
	if (text !== "") parts.push({ role: "assistant", content: text });
	for (const call of message.tool_calls ?? []) {
		if (call?.llmt_item !== undefined) {
			state.nativeHosted = true;
			parts.push(call.llmt_item);
			continue;
		}
		if (call?.type === "custom") {
			custom.add(call.id);
			parts.push({
				type: "custom_tool_call",
				call_id: call.id,
				name: call.custom?.name,
				input: typeof call.custom?.input === "string" ? call.custom.input : ""
			});
			continue;
		}
		if (call?.type !== undefined && call.type !== "function") {
			drop(state, `tool_call:${call.type}`);
			continue;
		}
		const args = call.function?.arguments;
		parts.push({ type: "function_call", call_id: call.id, name: call.function?.name, arguments: typeof args === "string" ? args : "{}" });
	}
	if (!round) return parts;
	const out = [];
	const pending = reasoningItems(message).sort((left, right) => left.at - right.at);
	parts.forEach((part, index) => {
		while (pending.length > 0 && pending[0].at <= index) out.push(pending.shift().item);
		out.push(part);
	});
	for (const { item } of pending) out.push(item);
	return out;
}

/**
 * The Responses `input` and `instructions` for Chat Completions messages.
 * @param {any[]} list - Chat messages.
 * @param {{ dropped: string[] }} state - Conversion state.
 * @param {boolean} round - Whether reasoning items travel.
 * @returns {{ input: any[], instructions: string }} Conversation items and the leading system text.
 */
function convertMessages(list, state, round) {
	const input = [];
	const lead = [];
	const custom = new Set();
	for (const message of list) {
		switch (message?.role) {
			case "system":
			case "developer": {
				const text = plainText(message.content);
				if (text === "") break;
				if (input.length === 0) lead.push(text);
				else input.push({ role: "system", content: text });
				break;
			}
			case "user":
				input.push({
					role: "user",
					content: typeof message.content === "string" ? message.content : inputParts(message.content ?? [], state)
				});
				break;
			case "assistant":
				if (message.llmt_native !== undefined) {
					state.nativeHosted = true;
					input.push(message.llmt_native.item);
					break;
				}
				input.push(...assistantItems(message, state, round, custom));
				break;
			case "tool":
				// A hosted call replayed from the client: its item went out with the call, or is this message's item.
				if (message.llmt_hosted !== undefined) {
					state.nativeHosted = true;
					if (message.llmt_hosted.paired !== true) input.push(message.llmt_hosted.item);
					break;
				}
				input.push({
					type: custom.has(message.tool_call_id) ? "custom_tool_call_output" : "function_call_output",
					call_id: message.tool_call_id,
					output: toolOutput(message.content, state)
				});
				break;
			default:
				throw new TranslatorError(`messages: unsupported role "${message?.role}"`, { code: "invalid_request", param: "messages" });
		}
	}
	return { input, instructions: lead.join("\n\n") };
}

/**
 * Responses tools for Chat Completions tools. Chat's `strict` defaults to off and Responses' to on, so it is always written.
 * @param {any[]} tools - Chat tools.
 * @param {{ dropped: string[] }} state - Conversion state.
 * @returns {any[]} Responses tools.
 */
function convertTools(tools, state) {
	const out = [];
	for (const tool of tools) {
		if (tool?.llmt_hosted !== undefined) {
			// A hosted tool the client sent, as it sent it (`hostedTools: "native"`).
			state.nativeHosted = true;
			out.push(tool.llmt_hosted.tool);
		} else if (tool?.type === "function" && tool.function) {
			const fn = tool.function;
			out.push({
				type: "function",
				name: fn.name,
				...(fn.description === undefined ? {} : { description: fn.description }),
				parameters: fn.parameters ?? { type: "object", properties: {} },
				strict: fn.strict === true
			});
		} else if (tool?.type === "custom" && tool.custom) {
			const { name, description, format } = tool.custom;
			out.push({
				type: "custom",
				name,
				...(description === undefined ? {} : { description }),
				...(format === undefined ? {} : { format })
			});
		} else drop(state, `tool:${tool?.type}`);
	}
	return out;
}

/**
 * The Responses `tool_choice` for a Chat Completions one.
 * @param {any} choice - Chat `tool_choice`.
 * @param {{ dropped: string[] }} state - Conversion state.
 * @returns {any} Responses `tool_choice`, or undefined when it has no mapping.
 */
function convertChoice(choice, state) {
	if (typeof choice === "string") return choice;
	if (choice?.type === "function" && choice.function) return { type: "function", name: choice.function.name };
	if (choice?.type === "custom" && choice.custom) return { type: "custom", name: choice.custom.name };
	if (choice?.type === "allowed_tools" && choice.allowed_tools) {
		const tools = convertTools(choice.allowed_tools.tools ?? [], state).map((tool) => ({ type: tool.type, name: tool.name }));
		return { type: "allowed_tools", mode: choice.allowed_tools.mode, tools };
	}
	drop(state, "tool_choice");
	return undefined;
}

/**
 * The Responses `text` object for `response_format` and `verbosity`.
 * @param {any} chat - Chat body.
 * @param {import("./settings.mjs").Settings} s - Settings.
 * @param {{ dropped: string[] }} state - Conversion state.
 * @returns {any} The `text` object, or undefined when neither is set.
 */
function textOf(chat, s, state) {
	const text = {};
	const format = chat.response_format;
	if (format !== undefined) {
		if (!s.responseFormat) drop(state, "response_format");
		else if (format.type === "json_schema" && format.json_schema) {
			const { name, schema, strict, description } = format.json_schema;
			text.format = {
				type: "json_schema",
				name: name ?? "output",
				schema,
				...(strict === undefined ? {} : { strict }),
				...(description === undefined ? {} : { description })
			};
		} else if (format.type === "json_object") text.format = { type: "json_object" };
		else if (format.type === "text") text.format = { type: "text" };
		else drop(state, "response_format");
	}
	if (chat.verbosity !== undefined) text.verbosity = chat.verbosity;
	return Object.keys(text).length > 0 ? text : undefined;
}

/**
 * Convert a Chat Completions request body into a Responses request body.
 *
 * System messages before the first turn become `instructions`; assistant turns become message and `function_call` items and their
 * tool results `function_call_output` items. The request is always stateless (`store: false`); with `reasoningRoundTrip` the encrypted
 * reasoning of earlier turns is asked for (`include`) and sent back as `reasoning` items. Fields the Responses API has no counterpart
 * for (`stop`, `seed`, the penalties, `logit_bias`, `logprobs`) are dropped and recorded in `state.dropped`.
 * @param {any} chat - Chat Completions body.
 * @param {Partial<import("./settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {{ body: any, state: any }} Responses body and conversion state (`front`, `model`, `stream`, `includeUsage`, `dropped`).
 * @throws {TranslatorError} For a body without `messages`, `n` above 1 (`send` fans that out instead), an unknown role, or an unknown field when configured to error.
 */
export function request(chat, settings) {
	const s = resolve(settings);
	if (chat === null || typeof chat !== "object" || !Array.isArray(chat.messages)) {
		throw new TranslatorError("messages is a required property", { code: "invalid_request", param: "messages" });
	}
	if (chat.n !== undefined && chat.n !== 1) {
		throw new TranslatorError("n: only a single choice (n = 1) is supported", { code: "unsupported_field", param: "n" });
	}
	const state = {
		front: "openai",
		model: chat.model,
		stream: chat.stream === true,
		includeUsage: chat.stream_options?.include_usage === true,
		reasoningField: s.reasoningField,
		toolNames: {},
		toolIds: {},
		dropped: []
	};
	for (const key of Object.keys(chat)) {
		if (HANDLED.has(key)) continue;
		if (s.unknownFields === "error") {
			throw new TranslatorError(`${key}: Unrecognized request argument`, { code: "unsupported_field", param: key });
		}
		drop(state, key);
	}
	const { input, instructions } = convertMessages(chat.messages, state, s.reasoningRoundTrip);
	const out = { model: chat.model, input };
	if (instructions !== "") out.instructions = instructions;
	if (state.stream) out.stream = true;
	out.store = false;
	if (s.reasoningRoundTrip) out.include = ["reasoning.encrypted_content"];
	if (Array.isArray(chat.llmt_native_include)) out.include = [...new Set([...(out.include ?? []), ...chat.llmt_native_include])];
	const limit = chat.max_completion_tokens ?? chat.max_tokens;
	if (limit !== undefined) out.max_output_tokens = limit;
	for (const key of ["temperature", "top_p", "user", "metadata", "service_tier", "prompt_cache_key", "safety_identifier"]) {
		if (chat[key] !== undefined) out[key] = chat[key];
	}
	// A request with no tools sends none of the three (the servers refuse them without tools, as for Chat Completions).
	const tools = convertTools(chat.tools ?? [], state);
	if (tools.length > 0) {
		out.tools = tools;
		const choice =
			chat.llmt_native_choice !== undefined
				? chat.llmt_native_choice
				: chat.tool_choice === undefined
					? undefined
					: convertChoice(chat.tool_choice, state);
		if (choice !== undefined) out.tool_choice = choice;
		if (chat.parallel_tool_calls !== undefined && s.parallelToolCalls) out.parallel_tool_calls = chat.parallel_tool_calls;
	}
	if (typeof chat.reasoning_effort === "string") {
		out.reasoning = { effort: chat.reasoning_effort };
		if (chat.reasoning_effort !== "none" && s.reasoningSummary !== "none") out.reasoning.summary = s.reasoningSummary;
	}
	const text = textOf(chat, s, state);
	if (text) out.text = text;
	return { body: out, state };
}

/**
 * The text of the summary parts of a reasoning item (or, without a summary, its raw reasoning text), blank-line separated.
 * @param {any} item - Responses `reasoning` item.
 * @returns {string} Text.
 */
function reasoningText(item) {
	const pick = (list, type) =>
		(Array.isArray(list) ? list : [])
			.filter((part) => part?.type === type && typeof part.text === "string")
			.map((part) => part.text)
			.join("\n\n");
	return pick(item.summary, "summary_text") || pick(item.content, "reasoning_text");
}

/**
 * The `reasoning_details` item for a Responses reasoning item, or null when it carries no encrypted content (nothing to send back).
 * @param {any} item - Responses `reasoning` item.
 * @param {number} index - Position among what the message shows: 0 before the text (or before the first tool call when there is no text), 1 after the text and before the first tool call, then one more per tool call.
 * @returns {object | null} The item.
 */
function detailOf(item, index) {
	if (typeof item.encrypted_content !== "string" || item.encrypted_content === "") return null;
	const out = { type: "reasoning.encrypted", data: item.encrypted_content, format: FORMAT, index };
	if (typeof item.id === "string" && item.id !== "") out.id = item.id;
	const text = reasoningText(item);
	if (text !== "") out.summary = text;
	return out;
}

/**
 * Chat Completions usage for a Responses usage object.
 * @param {any} usage - Responses `usage`.
 * @returns {object | undefined} Chat usage, or undefined when the reply carried none.
 */
export function usageOf(usage) {
	if (usage === null || typeof usage !== "object") return undefined;
	const prompt = usage.input_tokens ?? 0;
	const completion = usage.output_tokens ?? 0;
	const out = { prompt_tokens: prompt, completion_tokens: completion, total_tokens: usage.total_tokens ?? prompt + completion };
	const cached = usage.input_tokens_details?.cached_tokens;
	if (typeof cached === "number") out.prompt_tokens_details = { cached_tokens: cached };
	const reasoning = usage.output_tokens_details?.reasoning_tokens;
	if (typeof reasoning === "number") out.completion_tokens_details = { reasoning_tokens: reasoning };
	return out;
}

/**
 * Chat `finish_reason` for a finished Responses reply.
 * @param {any} response - Responses object (or the part of it with `incomplete_details`).
 * @param {boolean} calls - Whether the reply made tool calls.
 * @returns {string} Finish reason.
 */
function finishOf(response, calls) {
	if (response.status === "incomplete") {
		const reason = response.incomplete_details?.reason;
		if (reason === "max_output_tokens") return "length";
		if (reason === "content_filter") return "content_filter";
	}
	return calls ? "tool_calls" : "stop";
}

/**
 * The error for a Responses reply that did not finish (`failed`, `cancelled`, or still running).
 * @param {any} response - Responses object.
 * @returns {TranslatorError | null} The error, or null for a reply that finished (`completed` or `incomplete`).
 */
function failureOf(response) {
	if (response.status === "completed" || response.status === "incomplete") return null;
	const message = response.error?.message ?? `Upstream response ended with status "${response.status}"`;
	return new TranslatorError(message, { code: "upstream_" + (response.error?.code ?? "failed"), status: 502, type: "api_error" });
}

/**
 * Move the spans of citations that count from the start of an output text part to count from the start of the joined text.
 * @param {import("./citations.mjs").Citation[]} list - Citations with spans in a part.
 * @param {number} start - Where the part starts in the joined text.
 * @returns {import("./citations.mjs").Citation[]} The citations with moved spans (one without a span is the whole part).
 */
function moved(list, start) {
	return list.map((citation) => ({
		...citation,
		span: citation.span ? { start: citation.span.start + start, end: citation.span.end + start } : undefined
	}));
}

/**
 * Convert a (non-streaming) Responses reply into a Chat Completions reply.
 *
 * Message text becomes `content` (a refusal `refusal`) with the annotations of its parts (`url_citation`, `file_citation`) as `annotations`, `function_call` items `tool_calls`, and the summary of reasoning items the
 * reasoning field named by `reasoningField`. With `reasoningRoundTrip` every reasoning item that carries `encrypted_content` is also
 * returned as a `reasoning_details` item (format `openai-responses-v1`), which the Anthropic converter signs into the thinking block and the
 * request converter turns back into a `reasoning` item.
 * @param {any} reply - Responses object.
 * @param {any} [state] - State from the request converter (`model`; `upstreamUsage` is written to it).
 * @param {Partial<import("./settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {any} Chat completion.
 * @throws {TranslatorError} When the reply is not an object with an `output` list, or did not finish.
 */
export function response(reply, state, settings) {
	const s = resolve(settings);
	if (reply === null || typeof reply !== "object" || !Array.isArray(reply.output)) {
		const failure = reply?.error ? failureOf({ status: "failed", error: reply.error }) : null;
		throw failure ?? new TranslatorError("Upstream response contained no output", { code: "invalid_upstream_response", status: 502 });
	}
	const failure = failureOf(reply);
	if (failure) throw failure;
	const text = [];
	const refusal = [];
	const reasoning = [];
	const calls = [];
	const details = [];
	// The citations of the output text parts, with their spans moved from their part to the joined text.
	const cited = [];
	let length = 0;
	// A reasoning item records where it sat among what the message shows: the text (all of it is one part), then each tool call.
	let textSeen = false;
	for (const item of reply.output) {
		if (item?.type === "reasoning") {
			const summary = reasoningText(item);
			if (summary !== "") reasoning.push(summary);
			const detail = s.reasoningRoundTrip ? detailOf(item, calls.length + (textSeen ? 1 : 0)) : null;
			if (detail) details.push(detail);
		} else if (item?.type === "message") {
			for (const part of item.content ?? []) {
				if (part?.type === "output_text" && typeof part.text === "string") {
					text.push(part.text);
					if (part.text !== "") textSeen = true;
					if (s.citations !== "none") cited.push(...moved(readAll(part.annotations, fromResponses), length));
					length += part.text.length;
				} else if (part?.type === "refusal" && typeof part.refusal === "string") refusal.push(part.refusal);
			}
		} else if (item?.type === "function_call") {
			calls.push({
				id: item.call_id ?? item.id,
				type: "function",
				function: { name: item.name, arguments: typeof item.arguments === "string" ? item.arguments : "{}" }
			});
		} else if (item?.type === "custom_tool_call") {
			calls.push({
				id: item.call_id ?? item.id,
				type: "custom",
				custom: { name: item.name, input: typeof item.input === "string" ? item.input : "" }
			});
		}
	}
	const message = { role: "assistant", content: text.length === 0 && calls.length > 0 ? null : text.join("") };
	if (refusal.length > 0) message.refusal = refusal.join("");
	if (cited.length > 0) message.annotations = cited.map((citation) => toAnnotation(citation));
	if (reasoning.length > 0) message[s.reasoningField] = reasoning.join("\n\n");
	if (details.length > 0) message.reasoning_details = details;
	if (calls.length > 0) message.tool_calls = calls;
	const usage = usageOf(reply.usage);
	// Kept for `send`, whose usage report wants the upstream's own counts.
	if (state && usage) state.upstreamUsage = usage;
	// A request that sent hosted tools as they were gets the upstream's own output items back, whole.
	const native = state?.nativeHosted === true ? { llmt_output: reply.output } : {};
	return {
		...native,
		id: `chatcmpl-${String(reply.id ?? "").replace(/^resp_/, "") || completionId().slice(9)}`,
		object: "chat.completion",
		created: reply.created_at ?? Math.floor(Date.now() / 1000),
		model: state?.model ?? reply.model,
		choices: [{ index: 0, message, finish_reason: finishOf(reply, calls.length > 0) }],
		...(usage ? { usage } : {})
	};
}

/**
 * The error chunk for a failure.
 * @param {string} message - Message.
 * @param {string} [type] - OpenAI error type.
 * @param {string | number | null} [code] - Error code.
 * @returns {{ data: any }} Chunk.
 */
const failureChunk = (message, type = "server_error", code = null) => ({ data: { error: { message, type, param: null, code } } });

/**
 * Convert a Responses event stream into Chat Completions chunks followed by `[DONE]`.
 *
 * `source` is SSE text or bytes, parsed events, or bare event payloads (they carry their own `type`). Text, refusal, reasoning summary and
 * argument deltas become the matching `delta` fields; a tool call starts with its `id` and name when its item is added. With
 * `reasoningRoundTrip` the encrypted reasoning arrives as one `reasoning_details` chunk when its item is done. The final usage goes out as a
 * `choices: []` chunk when `state.includeUsage` is not false. Annotations (`response.output_text.annotation.added`, or the finished item's when none were streamed) become `annotations` chunks whose spans count from the start of the content. A `response.failed` or `error` event, or a stream that ends before a final
 * event, becomes an `{ error }` chunk followed by `[DONE]`.
 * @param {ReadableStream | AsyncIterable<unknown> | Iterable<unknown> | string | Uint8Array} source - Responses stream.
 * @param {any} [state] - State from the request converter (`model`, `includeUsage`; `upstreamUsage` is written to it).
 * @param {Partial<import("./settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {AsyncGenerator<{ data: any }, void, undefined>} Chat chunks.
 */
export async function* stream(source, state, settings) {
	const s = resolve(settings);
	const includeUsage = state?.includeUsage ?? true;
	const created = Math.floor(Date.now() / 1000);
	let id = completionId();
	let model = state?.model;
	// Per output index: the tool call index it became (function calls), whether text or arguments were streamed, and the summary parts seen.
	const items = new Map();
	let tools = 0;
	let textSeen = false;
	let final = null;
	// Characters of content sent, and where each output text part started in them: annotation indexes count from the start of their part.
	let length = 0;
	const starts = new Map();

	const chunk = (delta, finishReason = null) => ({
		data: { id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finishReason }] }
	});
	const entry = (index) => {
		if (!items.has(index)) items.set(index, { tool: null, streamed: false, annotated: false, parts: 0 });
		return items.get(index);
	};
	function* start(index, item) {
		const known = entry(index);
		if (known.tool !== null) return;
		known.tool = tools++;
		const call =
			item.type === "custom_tool_call"
				? { type: "custom", custom: { name: item.name, input: "" } }
				: { type: "function", function: { name: item.name, arguments: "" } };
		yield chunk({ tool_calls: [{ index: known.tool, id: item.call_id ?? item.id, ...call }] });
	}
	function* text(value) {
		if (value === "") return;
		textSeen = true;
		length += value.length;
		yield chunk({ content: value });
	}
	function* cite(list, start) {
		if (s.citations === "none") return;
		const found = moved(readAll(list, fromResponses), start);
		if (found.length > 0) yield chunk({ annotations: found.map((citation) => toAnnotation(citation)) });
	}

	try {
		for await (const { data } of messages(source)) {
			if (data === "[DONE]") break;
			// Hosted tools sent as they were: the upstream's events go back to the client unchanged (the chunks below still carry the usage).
			if (state?.nativeHosted === true) yield { data: { llmt_event: data } };
			const type = data?.type;
			const index = data?.output_index ?? 0;
			if (type === "response.created") {
				id = `chatcmpl-${String(data.response?.id ?? "").replace(/^resp_/, "") || id.slice(9)}`;
				model = state?.model ?? data.response?.model;
				yield chunk({ role: "assistant", content: "" });
			} else if (type === "response.output_item.added" && (data.item?.type === "function_call" || data.item?.type === "custom_tool_call")) {
				yield* start(index, data.item);
			} else if (type === "response.output_text.delta") {
				entry(index).streamed = true;
				const part = `${index}:${data.content_index ?? 0}`;
				if (!starts.has(part)) starts.set(part, length);
				yield* text(data.delta ?? "");
			} else if (type === "response.output_text.annotation.added") {
				entry(index).annotated = true;
				yield* cite([data.annotation], starts.get(`${index}:${data.content_index ?? 0}`) ?? length);
			} else if (type === "response.refusal.delta") {
				entry(index).streamed = true;
				yield chunk({ refusal: data.delta ?? "" });
			} else if (type === "response.reasoning_summary_part.added") {
				const known = entry(index);
				// Parts of one summary are separated by a blank line, as in the JSON conversion.
				if (known.parts++ > 0) yield chunk({ [s.reasoningField]: "\n\n" });
			} else if (type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") {
				entry(index).streamed = true;
				yield chunk({ [s.reasoningField]: data.delta ?? "" });
			} else if (type === "response.custom_tool_call_input.delta") {
				const known = entry(index);
				known.streamed = true;
				if (known.tool !== null) yield chunk({ tool_calls: [{ index: known.tool, custom: { input: data.delta ?? "" } }] });
			} else if (type === "response.function_call_arguments.delta") {
				const known = entry(index);
				known.streamed = true;
				if (known.tool !== null) yield chunk({ tool_calls: [{ index: known.tool, function: { arguments: data.delta ?? "" } }] });
			} else if (type === "response.output_item.done") {
				const item = data.item ?? {};
				const known = entry(index);
				if (item.type === "reasoning") {
					// A server that sends the summary only in the finished item still shows it.
					if (!known.streamed && reasoningText(item) !== "") yield chunk({ [s.reasoningField]: reasoningText(item) });
					const detail = s.reasoningRoundTrip ? detailOf(item, tools + (textSeen ? 1 : 0)) : null;
					if (detail) yield chunk({ reasoning_details: [detail] });
				} else if (item.type === "message") {
					const parts = item.content ?? [];
					for (const [at, part] of parts.entries()) {
						if (part?.type === "output_text") {
							const start = known.streamed ? (starts.get(`${index}:${at}`) ?? length) : length;
							if (!known.streamed) yield* text(part.text ?? "");
							if (!known.annotated) yield* cite(part.annotations, start);
						} else if (part?.type === "refusal" && !known.streamed) yield chunk({ refusal: part.refusal ?? "" });
					}
				} else if (item.type === "custom_tool_call") {
					yield* start(index, item);
					if (!known.streamed && typeof item.input === "string" && item.input !== "") {
						yield chunk({ tool_calls: [{ index: known.tool, custom: { input: item.input } }] });
					}
				} else if (item.type === "function_call") {
					yield* start(index, item);
					if (!known.streamed && typeof item.arguments === "string" && item.arguments !== "") {
						yield chunk({ tool_calls: [{ index: known.tool, function: { arguments: item.arguments } }] });
					}
				}
			} else if (type === "response.completed" || type === "response.incomplete") {
				final = data.response ?? {};
				break;
			} else if (type === "response.failed") {
				const failure = failureOf({ ...data.response, status: "failed" });
				yield failureChunk(failure.message, "server_error", failure.code);
				yield { data: "[DONE]" };
				return;
			} else if (type === "error") {
				yield failureChunk(data.message ?? "Upstream error", "server_error", data.code ?? null);
				yield { data: "[DONE]" };
				return;
			}
		}
	} catch (error) {
		yield failureChunk(error.message);
		yield { data: "[DONE]" };
		return;
	}
	if (final === null) {
		yield failureChunk("Upstream stream ended before completion");
		yield { data: "[DONE]" };
		return;
	}
	const usage = usageOf(final.usage);
	if (state && usage) state.upstreamUsage = usage;
	yield chunk({}, finishOf(final, tools > 0));
	if (includeUsage) {
		yield { data: { id, object: "chat.completion.chunk", created, model, choices: [], ...(usage ? { usage } : {}) } };
	}
	yield { data: "[DONE]" };
}

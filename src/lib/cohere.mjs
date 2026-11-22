/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/cohere.mjs
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
 * @fileoverview Cohere's v2 chat API as Chat Completions: the request body, the reply and the streamed events are translated to and from the Chat Completions shapes the converters already know, plus the host and URL facts the driver needs.
 * @module @cldmv/llm-translator/lib/cohere
 */
import { TranslatorError } from "./errors.mjs";
import { completionId } from "./ids.mjs";
import { reasoningOf } from "./thinking.mjs";

/** Host names Cohere's API answers on. */
export const HOSTS = ["api.cohere.com", "api.cohere.ai"];

/** Path root of the OpenAI Compatibility API. */
export const COMPATIBILITY = "/compatibility";

/** Chat Completions fields the body conversion reads. */
const HANDLED = new Set([
	"model",
	"messages",
	"stream",
	"tools",
	"tool_choice",
	"max_tokens",
	"max_completion_tokens",
	"stop",
	"temperature",
	"top_p",
	"top_k",
	"seed",
	"frequency_penalty",
	"presence_penalty",
	"response_format",
	"reasoning_effort"
]);

/** Chat Completions fields that mean nothing to Cohere and are not worth a mention when they are left out. */
const SILENT = new Set(["stream_options", "user", "metadata", "store", "service_tier"]);

/** Text of a tool result that has none: Cohere rejects an empty result. */
const NO_OUTPUT = "(no output)";

/** Chat Completions `finish_reason` for each Cohere `finish_reason`; one that is not here is `stop`. */
const FINISH = { MAX_TOKENS: "length", TOOL_CALL: "tool_calls" };

/**
 * The base URL without the Compatibility API's path root, which is where the native API (`/v2/chat`) and the model list (`/v1/models`) live.
 * @param {string} base - The upstream's base URL.
 * @returns {string} The URL without a trailing `/compatibility`.
 */
export function rootOf(base) {
	return base.endsWith(COMPATIBILITY) ? base.slice(0, -COMPATIBILITY.length) : base;
}

/**
 * Record a field that has no Cohere equivalent, once.
 * @param {string[]} dropped - Names collected so far.
 * @param {string} name - Field name.
 */
function drop(dropped, name) {
	if (!dropped.includes(name)) dropped.push(name);
}

/**
 * The text of a message's content, parts joined with a newline. Parts that are not text are named in `dropped`.
 * @param {any} content - String, or an array of content parts.
 * @param {string[]} dropped - Collects what was left out.
 * @returns {string} The text.
 */
function textOf(content, dropped) {
	if (typeof content === "string") return content;
	const texts = [];
	for (const part of Array.isArray(content) ? content : []) {
		if (part?.type === "text" && typeof part.text === "string") texts.push(part.text);
		else drop(dropped, `content.${part?.type ?? "part"}`);
	}
	return texts.join("\n");
}

/**
 * The content blocks of a user message: text blocks (an empty one is left out) and images (`image_url`, a data URL or a web URL).
 * @param {any} content - String, or an array of content parts.
 * @param {string[]} dropped - Collects what was left out.
 * @returns {any[]} Cohere content blocks.
 */
function blocksOf(content, dropped) {
	if (typeof content === "string") return content === "" ? [] : [{ type: "text", text: content }];
	const out = [];
	for (const part of Array.isArray(content) ? content : []) {
		if (part?.type === "text") {
			if (typeof part.text === "string" && part.text !== "") out.push({ type: "text", text: part.text });
		} else if (part?.type === "image_url") {
			const image = typeof part.image_url === "string" ? { url: part.image_url } : part.image_url;
			out.push({ type: "image_url", image_url: image });
		} else drop(dropped, `content.${part?.type ?? "part"}`);
	}
	return out;
}

/**
 * The Cohere message of an assistant turn: its text, its reasoning as a `thinking` block and its tool calls (`arguments` as JSON text).
 * @param {any} message - Chat Completions assistant message.
 * @param {string[]} dropped - Collects what was left out.
 * @returns {any[]} The message as a one-item list, or an empty list when there is nothing to send (Cohere rejects empty content).
 */
function assistantOf(message, dropped) {
	const text = textOf(message.content, dropped);
	const thinking = reasoningOf(message);
	const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
	const entry = /** @type {any} */ ({ role: "assistant" });
	if (thinking !== "") {
		entry.content = [{ type: "thinking", thinking }, ...(text === "" ? [] : [{ type: "text", text }])];
	} else if (text !== "") entry.content = text;
	if (calls.length > 0) {
		entry.tool_calls = calls.map((call) => {
			const args = call.function?.arguments;
			return {
				id: call.id,
				type: "function",
				function: { name: call.function?.name, arguments: typeof args === "string" ? args || "{}" : JSON.stringify(args ?? {}) }
			};
		});
	}
	return [entry].filter((item) => Object.keys(item).length > 1);
}

/**
 * The Cohere messages of a conversation. System and developer messages are system messages; a tool message carries its `tool_call_id`; an
 * assistant message has its text, its reasoning as a `thinking` block and its tool calls (`arguments` as JSON text). A message with nothing to
 * send is left out, because Cohere rejects empty content.
 * @param {any[]} list - Chat Completions messages.
 * @param {string[]} dropped - Collects what was left out.
 * @returns {any[]} Cohere messages.
 */
function messagesOf(list, dropped) {
	const out = [];
	for (const message of list) {
		const role = message?.role;
		if (role === "system" || role === "developer") {
			const text = textOf(message.content, dropped);
			if (text !== "") out.push({ role: "system", content: text });
		} else if (role === "user") {
			const content = blocksOf(message.content, dropped);
			if (content.length > 0) out.push({ role: "user", content });
		} else if (role === "tool") {
			out.push({ role: "tool", tool_call_id: message.tool_call_id, content: textOf(message.content, dropped) || NO_OUTPUT });
		} else if (role === "assistant") {
			out.push(...assistantOf(message, dropped));
		} else {
			drop(dropped, `messages.${role}`);
		}
	}
	return out;
}

/**
 * Cohere's `thinking` setting for a request: the Anthropic request's own (`enabled` with its budget, or `disabled`), else the reasoning effort
 * (`none` switches thinking off, any other level on). `adaptive` and a request that says nothing leave it to the model.
 * @param {any} body - Chat Completions body.
 * @param {{ thinking?: string | null, thinkingBudget?: number }} context - The Anthropic request's thinking mode and budget.
 * @returns {{ type: string, token_budget?: number } | undefined} The setting, or undefined.
 */
function thinkingOf(body, context) {
	if (context.thinking === "disabled") return { type: "disabled" };
	if (context.thinking === "enabled") {
		return { type: "enabled", ...(context.thinkingBudget === undefined ? {} : { token_budget: context.thinkingBudget }) };
	}
	if (typeof body.reasoning_effort === "string") return { type: body.reasoning_effort === "none" ? "disabled" : "enabled" };
	return undefined;
}

/**
 * Convert a Chat Completions request body to a Cohere `/v2/chat` body. `max_tokens` is the same field, `top_p` is `p`, `top_k` is `k`, `stop`
 * is `stop_sequences`, tools keep their JSON schema, `tool_choice` `required` and `none` are `REQUIRED` and `NONE`, `response_format`
 * `json_object` and `json_schema` are a `json_object` format with the schema, and thinking comes from `context` or `reasoning_effort`. The
 * extension sampling fields (`sampling`) are Cohere's own field names and go in as given; anything the request names wins. What Cohere has
 * no field for (forcing one named tool, `n`, `parallel_tool_calls`, `logit_bias`, `response_format` together with tools, reasoning from an
 * unsigned history, ...) is left out and named in `dropped`.
 * @param {any} body - Chat Completions request body.
 * @param {{ dropped?: string[], sampling?: Record<string, any>, thinking?: string | null, thinkingBudget?: number }} [context] - `dropped` collects the names of what was left out; `sampling` are extension fields; `thinking` and `thinkingBudget` are an Anthropic request's thinking mode and token budget.
 * @returns {any} Cohere request body.
 */
export function chatBody(body, context = {}) {
	const dropped = context.dropped ?? [];
	const out = /** @type {any} */ ({
		...context.sampling,
		model: body.model,
		stream: body.stream === true,
		messages: messagesOf(body.messages ?? [], dropped)
	});
	const offered = Array.isArray(body.tools) && body.tools.length > 0;
	if (offered) {
		out.tools = body.tools.map((tool) => ({
			type: "function",
			function: {
				name: tool.function?.name,
				...(tool.function?.description === undefined ? {} : { description: tool.function.description }),
				parameters: tool.function?.parameters ?? { type: "object", properties: {} }
			}
		}));
		if (body.tools.some((tool) => tool.function?.strict === true)) out.strict_tools = true;
		const choice = body.tool_choice;
		if (choice === "required") out.tool_choice = "REQUIRED";
		else if (choice === "none") out.tool_choice = "NONE";
		// Cohere cannot force one named tool; with a single tool, requiring a call is the same thing.
		else if (choice?.type === "function" && body.tools.length === 1) out.tool_choice = "REQUIRED";
		else if (choice !== undefined && choice !== "auto") drop(dropped, "tool_choice");
	}
	const cap = body.max_completion_tokens ?? body.max_tokens;
	if (cap !== undefined && cap !== null) out.max_tokens = cap;
	if (body.temperature !== undefined && body.temperature !== null) out.temperature = body.temperature;
	if (body.top_p !== undefined && body.top_p !== null) out.p = body.top_p;
	if (body.top_k !== undefined && body.top_k !== null) out.k = body.top_k;
	if (body.seed !== undefined && body.seed !== null) out.seed = body.seed;
	if (body.frequency_penalty !== undefined && body.frequency_penalty !== null) out.frequency_penalty = body.frequency_penalty;
	if (body.presence_penalty !== undefined && body.presence_penalty !== null) out.presence_penalty = body.presence_penalty;
	if (body.stop !== undefined && body.stop !== null) out.stop_sequences = Array.isArray(body.stop) ? body.stop : [body.stop];
	const format = body.response_format;
	if (format?.type === "json_object" || (format?.type === "json_schema" && format.json_schema?.schema !== undefined)) {
		// Cohere does not take a response format together with tools.
		if (offered) drop(dropped, "response_format");
		else {
			out.response_format = { type: "json_object" };
			if (format.type === "json_schema") out.response_format.json_schema = format.json_schema.schema;
		}
	}
	const thinking = thinkingOf(body, context);
	if (thinking !== undefined) out.thinking = thinking;
	for (const key of Object.keys(body)) {
		if (HANDLED.has(key) || SILENT.has(key)) continue;
		if (key === "n" && !(body.n > 1)) continue;
		drop(dropped, key);
	}
	return out;
}

/**
 * Chat Completions `finish_reason` for a Cohere `finish_reason`: `COMPLETE` and `STOP_SEQUENCE` are `stop`, `MAX_TOKENS` is `length` and
 * `TOOL_CALL` is `tool_calls`. A reply that called tools is `tool_calls`.
 * @param {string | undefined} reason - Cohere `finish_reason`.
 * @param {boolean} calls - Whether the reply carried tool calls.
 * @returns {string} `finish_reason`.
 */
export function finishOf(reason, calls) {
	const finish = Object.hasOwn(FINISH, reason ?? "") ? FINISH[/** @type {string} */ (reason)] : "stop";
	return calls && finish === "stop" ? "tool_calls" : finish;
}

/**
 * The failure a finished Cohere reply reports: `ERROR` (502) and `TIMEOUT` (504) as finish reasons, or an `error` in the stream's final event.
 * @param {string | undefined} reason - Cohere `finish_reason`.
 * @param {any} [error] - The `error` the final event carries, when it has one.
 * @returns {TranslatorError | null} The error, or null for a reply that finished.
 */
export function failureOf(reason, error) {
	if (reason === "TIMEOUT") return new TranslatorError("Upstream generation timed out", { code: "upstream_timeout", status: 504 });
	if (reason === "ERROR" || (error !== undefined && error !== null)) {
		return new TranslatorError(typeof error === "string" && error !== "" ? error : "Upstream generation failed", {
			code: "upstream_error",
			status: 502
		});
	}
	return null;
}

/**
 * Chat Completions usage from a Cohere `usage` object: the model's own token counts (`tokens`), else the billed ones (`billed_units`).
 * @param {any} usage - Cohere `usage`.
 * @returns {{prompt_tokens: number, completion_tokens: number, total_tokens: number} | undefined} Usage, or undefined when there are no counts.
 */
export function usageOf(usage) {
	const source =
		Number.isFinite(usage?.tokens?.input_tokens) || Number.isFinite(usage?.tokens?.output_tokens) ? usage.tokens : usage?.billed_units;
	if (!Number.isFinite(source?.input_tokens) && !Number.isFinite(source?.output_tokens)) return undefined;
	const prompt = Number.isFinite(source.input_tokens) ? source.input_tokens : 0;
	const completion = Number.isFinite(source.output_tokens) ? source.output_tokens : 0;
	return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
}

/**
 * The same counts as Anthropic usage, which is what the OpenAI front's usage report reads from a converted reply.
 * @param {any} usage - Cohere `usage`.
 * @returns {{input_tokens: number, output_tokens: number} | undefined} Anthropic usage, or undefined when there are no counts.
 */
export function folded(usage) {
	const counted = usageOf(usage);
	return counted === undefined ? undefined : { input_tokens: counted.prompt_tokens, output_tokens: counted.completion_tokens };
}

/**
 * Convert a (non-streaming) Cohere reply to a Chat Completions `chat.completion`: text blocks are joined into the content, `thinking` blocks go
 * in the settings' reasoning field, `tool_calls` become tool calls, `finish_reason` becomes `finish_reason` and `usage` becomes `usage`. The
 * `tool_plan` (the sentence the model writes before a tool call) and `citations` are not carried over.
 * @param {any} reply - Parsed Cohere reply.
 * @param {{ reasoningField?: string, model?: string }} [options] - `reasoningField` is where the reasoning goes (default `reasoning`); `model` is the model name on the completion.
 * @returns {any} `chat.completion` object.
 * @throws {TranslatorError} `invalid_upstream_response` (502) when the reply has no message, `upstream_error` (502) or `upstream_timeout` (504) when it ended in a failure.
 */
export function completion(reply, options = {}) {
	const message = reply?.message;
	if (message === null || typeof message !== "object") {
		throw new TranslatorError("Upstream response contained no message", { code: "invalid_upstream_response", status: 502 });
	}
	const failure = failureOf(reply.finish_reason);
	if (failure !== null) throw failure;
	const blocks = Array.isArray(message.content) ? message.content : [];
	const calls = (Array.isArray(message.tool_calls) ? message.tool_calls : []).map((call) => ({
		id: call?.id,
		type: "function",
		function: { name: call?.function?.name, arguments: call?.function?.arguments ?? "{}" }
	}));
	const out = { role: "assistant", content: blocks.map((block) => (block?.type === "text" ? block.text : "")).join("") };
	const reasoning = blocks.map((block) => (block?.type === "thinking" ? block.thinking : "")).join("");
	if (reasoning !== "") out[options.reasoningField ?? "reasoning"] = reasoning;
	if (calls.length > 0) out.tool_calls = calls;
	const usage = usageOf(reply.usage);
	return {
		id: completionId(),
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model: options.model,
		choices: [{ index: 0, message: out, finish_reason: finishOf(reply.finish_reason, calls.length > 0) }],
		...(usage === undefined ? {} : { usage })
	};
}

/**
 * Create the converter of a Cohere stream's events into Chat Completions chunks. One chunker is for one reply: it keeps the completion id (so
 * every chunk carries the same one) and whether any tool was called. The `tool-plan-delta`, citation and `debug` events are not carried over.
 * @param {{ model?: string, reasoningField?: string, includeUsage?: boolean }} [options] - `model` is the model name on the chunks; `reasoningField` is where the reasoning goes (default `reasoning`); `includeUsage` (default true) adds the final usage chunk.
 * @returns {{ event: (name: string | undefined, data: any) => any[], finished: () => boolean, usage: () => any }} `event` gives the chunks one event produces (a failure gives one `{ error }` chunk), `finished` says whether the reply ended (`message-end`, or a failure) and `usage` is the Cohere `usage` of the `message-end` event.
 */
export function createChunker(options = {}) {
	const id = completionId();
	const created = Math.floor(Date.now() / 1000);
	const field = options.reasoningField ?? "reasoning";
	let started = false;
	let calls = 0;
	let finished = false;
	let usage;
	const make = (delta, finish = null) => ({
		id,
		object: "chat.completion.chunk",
		created,
		model: options.model,
		choices: [{ index: 0, delta, finish_reason: finish }]
	});
	// The first chunk of every reply names the role.
	const first = () => {
		if (started) return [];
		started = true;
		return [make({ role: "assistant", content: "" })];
	};
	const fail = (error) => {
		finished = true;
		return [{ error: { message: error.message, type: "api_error", param: null, code: null } }];
	};
	return {
		event(name, data) {
			const type = data?.type ?? name;
			if (type === "content-delta") {
				const content = data?.delta?.message?.content;
				if (typeof content?.text === "string" && content.text !== "") return [...first(), make({ content: content.text })];
				if (typeof content?.thinking === "string" && content.thinking !== "") return [...first(), make({ [field]: content.thinking })];
				return [];
			}
			if (type === "tool-call-start") {
				const call = data?.delta?.message?.tool_calls;
				calls += 1;
				const entry = { index: data.index, id: call?.id, type: "function", function: { name: call?.function?.name, arguments: "" } };
				return [...first(), make({ tool_calls: [entry] })];
			}
			if (type === "tool-call-delta") {
				const args = data?.delta?.message?.tool_calls?.function?.arguments;
				if (typeof args !== "string" || args === "") return [];
				return [...first(), make({ tool_calls: [{ index: data.index, function: { arguments: args } }] })];
			}
			if (type === "message-end") {
				const failure = failureOf(data?.delta?.finish_reason, data?.delta?.error);
				if (failure !== null) return fail(failure);
				finished = true;
				usage = data?.delta?.usage;
				const counted = usageOf(usage);
				const out = [...first(), make({}, finishOf(data?.delta?.finish_reason, calls > 0))];
				if (options.includeUsage !== false && counted !== undefined) {
					out.push({ id, object: "chat.completion.chunk", created, model: options.model, choices: [], usage: counted });
				}
				return out;
			}
			return type === "message-start" ? first() : [];
		},
		finished: () => finished,
		usage: () => usage
	};
}

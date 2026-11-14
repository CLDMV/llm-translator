/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/ollama.mjs
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
 * @fileoverview Ollama's native `/api/chat` protocol as Chat Completions: the request body, the reply and the streamed lines are translated to and from the Chat Completions shapes the converters already know.
 * @module @cldmv/llm-translator/lib/ollama
 */
import { TranslatorError } from "./errors.mjs";
import { callId, completionId } from "./ids.mjs";
import { parseArguments } from "./arguments.mjs";
import { reasoningOf } from "./thinking.mjs";

/** Protocol name of an endpoint that talks to Ollama's native chat API. */
export const PROTOCOL = "ollama.chat";

/** Chat Completions sampling fields that are Ollama `options` of the same name. */
const SAME = ["temperature", "top_p", "top_k", "min_p", "seed", "frequency_penalty", "presence_penalty"];

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
	"response_format",
	"reasoning_effort",
	"chat_template_kwargs",
	"think",
	"options",
	"format",
	"keep_alive",
	...SAME,
	"repetition_penalty"
]);

/** Chat Completions fields that mean nothing to Ollama and are not worth a mention when they are left out. */
const SILENT = new Set(["stream_options", "user", "metadata", "store", "service_tier"]);

/** Note shown to the model in place of an image that is referenced by URL: the native API takes base64 data only and the translator does not fetch URLs. */
const URL_NOTE = "[An image was omitted because Ollama accepts base64 images only and the translator does not fetch URLs.]";

/** Ollama's `think` value for each reasoning effort (`none` switches thinking off; levels a model does not take fall back to its default). */
const THINK = { none: false, minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "high", max: "max" };

/**
 * Record a field that has no Ollama equivalent, once.
 * @param {string[]} dropped - Names collected so far.
 * @param {string} name - Field name.
 */
function drop(dropped, name) {
	if (!dropped.includes(name)) dropped.push(name);
}

/**
 * Is a value a plain object?
 * @param {any} value - Candidate.
 * @returns {boolean} True for a non-null, non-array object.
 */
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * The text of a message's content and the base64 images in it.
 * @param {any} content - String, or an array of content parts.
 * @param {string[]} dropped - Collects what was left out.
 * @returns {{text: string, images: string[]}} The joined text and the image data.
 */
function contentOf(content, dropped) {
	if (typeof content === "string") return { text: content, images: [] };
	const texts = [];
	const images = [];
	for (const part of Array.isArray(content) ? content : []) {
		if (part?.type === "text" && typeof part.text === "string") texts.push(part.text);
		else if (part?.type === "image_url") {
			const url = String(part.image_url?.url ?? part.image_url ?? "");
			const match = /^data:[^;,]*;base64,(.*)$/s.exec(url);
			if (match) images.push(match[1]);
			else {
				texts.push(URL_NOTE);
				drop(dropped, "image_url");
			}
		} else drop(dropped, `content.${part?.type ?? "part"}`);
	}
	return { text: texts.join("\n"), images };
}

/**
 * The tool calls of an assistant message in Ollama's shape: `arguments` is an object, and there is no id.
 * @param {any[]} calls - Chat Completions `tool_calls`.
 * @param {Map<string, string>} names - Collects the tool name of each call id, for the tool results that follow.
 * @returns {any[]} Ollama tool calls.
 */
function callsOf(calls, names) {
	return calls.map((call) => {
		if (typeof call.id === "string") names.set(call.id, call.function?.name);
		return { type: "function", function: { name: call.function?.name, arguments: parseArguments(call.function?.arguments) } };
	});
}

/**
 * One Chat Completions message as an Ollama message.
 * @param {any} message - Chat Completions message.
 * @param {Map<string, string>} names - Tool name of each call id seen so far.
 * @param {string[]} dropped - Collects what was left out.
 * @returns {any} Ollama message.
 */
function messageOf(message, names, dropped) {
	const { text, images } = contentOf(message?.content, dropped);
	if (message?.role === "tool") {
		const name = names.get(message.tool_call_id) ?? message.name;
		return { role: "tool", ...(typeof name === "string" ? { tool_name: name } : {}), content: text };
	}
	const out = { role: message?.role === "developer" ? "system" : message?.role, content: text };
	if (images.length > 0) out.images = images;
	if (message?.role === "assistant") {
		const thinking = reasoningOf(message);
		if (thinking !== "") out.thinking = thinking;
		if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) out.tool_calls = callsOf(message.tool_calls, names);
	}
	return out;
}

/**
 * Ollama's `think` value for a request: the effort when there is one, else a `think` the client sent, else the thinking switch a converter
 * left in `chat_template_kwargs`.
 * @param {any} body - Chat Completions body.
 * @returns {boolean | string | undefined} The value, or undefined to leave it to the model.
 */
function thinkOf(body) {
	if (typeof body.reasoning_effort === "string")
		return Object.hasOwn(THINK, body.reasoning_effort) ? THINK[body.reasoning_effort] : body.reasoning_effort;
	if (body.think !== undefined) return body.think;
	const enabled = body.chat_template_kwargs?.enable_thinking;
	return typeof enabled === "boolean" ? enabled : undefined;
}

/**
 * The `options` of an Ollama request. Extension fields (the upstream's `sampling` setting, an Anthropic request's `metadata.sampling`) come first
 * and any field the request names wins; an `options` object the client sent has the last word.
 * @param {any} body - Chat Completions body.
 * @param {Record<string, any>} extra - Extension fields.
 * @returns {Record<string, any>} Options (possibly empty).
 */
function optionsOf(body, extra) {
	const options = {};
	for (const [key, value] of Object.entries(extra)) options[key === "repetition_penalty" ? "repeat_penalty" : key] = value;
	for (const key of SAME) if (body[key] !== undefined && body[key] !== null) options[key] = body[key];
	if (body.repetition_penalty !== undefined) options.repeat_penalty = body.repetition_penalty;
	const cap = body.max_completion_tokens ?? body.max_tokens;
	if (cap !== undefined && cap !== null) options.num_predict = cap;
	if (body.stop !== undefined && body.stop !== null) options.stop = Array.isArray(body.stop) ? body.stop : [body.stop];
	return isObject(body.options) ? { ...options, ...body.options } : options;
}

/**
 * The `format` of an Ollama request: `"json"` or a JSON schema, from `response_format` (or a `format` the client sent).
 * @param {any} body - Chat Completions body.
 * @returns {string | object | undefined} The value, or undefined for plain text.
 */
function formatOf(body) {
	if (body.format !== undefined) return body.format;
	const format = body.response_format;
	if (format?.type === "json_object") return "json";
	if (format?.type === "json_schema" && isObject(format.json_schema?.schema)) return format.json_schema.schema;
	return undefined;
}

/**
 * Convert a Chat Completions request body to an Ollama `/api/chat` body. Ollama streams unless told not to, so `stream` is always set. Tool
 * arguments become objects, tool results name their tool, images go in `images` as base64, `max_tokens` becomes `options.num_predict`, the
 * sampling fields go in `options`, `response_format` becomes `format` and the effort or thinking switch becomes `think`. What Ollama has no
 * field for (`tool_choice` other than `auto`, `n`, `logit_bias`, `logprobs`, images given by URL, ...) is left out and named in `dropped`;
 * `tool_choice: "none"` also removes the tools, so a call the client forbade cannot happen.
 * @param {any} body - Chat Completions request body.
 * @param {{ dropped?: string[], sampling?: Record<string, any> }} [context] - `dropped` collects the names of what was left out; `sampling` are extension sampling fields for `options`.
 * @returns {any} Ollama request body.
 */
export function chatBody(body, context = {}) {
	const dropped = context.dropped ?? [];
	const names = new Map();
	const out = {
		model: body.model,
		messages: (Array.isArray(body.messages) ? body.messages : []).map((m) => messageOf(m, names, dropped)),
		stream: body.stream === true
	};
	if (Array.isArray(body.tools) && body.tools.length > 0 && body.tool_choice !== "none") {
		out.tools = body.tools.map((tool) => ({
			type: "function",
			function: {
				name: tool.function?.name,
				description: tool.function?.description,
				parameters: tool.function?.parameters ?? { type: "object", properties: {} }
			}
		}));
		if (body.tool_choice !== undefined && body.tool_choice !== "auto") drop(dropped, "tool_choice");
	} else if (body.tool_choice === "none" && Array.isArray(body.tools)) drop(dropped, "tools");
	const options = optionsOf(body, context.sampling ?? {});
	if (Object.keys(options).length > 0) out.options = options;
	const format = formatOf(body);
	if (format !== undefined) out.format = format;
	const think = thinkOf(body);
	if (think !== undefined) out.think = think;
	if (body.keep_alive !== undefined) out.keep_alive = body.keep_alive;
	for (const key of Object.keys(body)) {
		if (HANDLED.has(key) || SILENT.has(key)) continue;
		if (key === "n" && !(body.n > 1)) continue;
		drop(dropped, key);
	}
	return out;
}

/**
 * The tool calls of an Ollama reply as Chat Completions calls. Ollama sends no id (and an object for `arguments`), so each call gets one
 * here, unless the server sent its own.
 * @param {any[] | undefined} calls - `message.tool_calls`.
 * @param {number} [first] - Index of the first call (a stream numbers calls across chunks).
 * @returns {any[]} Calls with `index`, `id`, `type` and `function` (`arguments` as JSON text).
 */
export function callsOfReply(calls, first = 0) {
	return (Array.isArray(calls) ? calls : []).map((call, at) => {
		const args = call?.function?.arguments;
		return {
			index: first + at,
			id: typeof call?.id === "string" && call.id !== "" ? call.id : callId(),
			type: "function",
			function: { name: call?.function?.name, arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}) }
		};
	});
}

/**
 * Chat Completions `finish_reason` for a finished Ollama reply: `tool_calls` when the model called tools, `length` when it ran out of tokens, else `stop`
 * (also for the `load` and `unload` reasons of a request that generated nothing).
 * @param {any} reply - Ollama reply or final stream line.
 * @param {boolean} calls - Whether the reply carried tool calls.
 * @returns {string} `finish_reason`.
 */
export function finishOf(reply, calls) {
	if (calls) return "tool_calls";
	return reply?.done_reason === "length" ? "length" : "stop";
}

/**
 * Chat Completions usage from the counters of a finished Ollama reply.
 * @param {any} reply - Ollama reply or final stream line.
 * @returns {{prompt_tokens: number, completion_tokens: number, total_tokens: number} | undefined} Usage, or undefined when the reply has no counters.
 */
export function usageOf(reply) {
	const prompt = reply?.prompt_eval_count;
	const completion = reply?.eval_count;
	if (!Number.isFinite(prompt) && !Number.isFinite(completion)) return undefined;
	const input = Number.isFinite(prompt) ? prompt : 0;
	const output = Number.isFinite(completion) ? completion : 0;
	return { prompt_tokens: input, completion_tokens: output, total_tokens: input + output };
}

/**
 * The same counts as Anthropic usage, which is what the OpenAI front's usage report reads from a converted reply.
 * @param {{prompt_tokens: number, completion_tokens: number} | undefined} usage - Chat Completions usage.
 * @returns {{input_tokens: number, output_tokens: number} | undefined} Anthropic usage.
 */
export function folded(usage) {
	return usage === undefined ? undefined : { input_tokens: usage.prompt_tokens, output_tokens: usage.completion_tokens };
}

/**
 * The error an Ollama reply carries in `error` (also sent with HTTP 200 in a stream).
 * @param {any} reply - Ollama reply or stream line.
 * @returns {string | null} The message, or null when the reply has none.
 */
export function errorOf(reply) {
	return typeof reply?.error === "string" ? reply.error : null;
}

/**
 * Convert a (non-streaming) Ollama `/api/chat` reply to a Chat Completions `chat.completion`: the thinking goes in the settings' reasoning
 * field, the tool calls get ids, `done_reason` becomes `finish_reason` and the evaluation counts become `usage`.
 * @param {any} reply - Parsed Ollama reply.
 * @param {{ reasoningField?: string }} [options] - `reasoningField` is where the thinking goes (default `reasoning`).
 * @returns {any} `chat.completion` object.
 * @throws {TranslatorError} `upstream_error` (502) when the reply is an error.
 */
export function completion(reply, options = {}) {
	const failure = errorOf(reply);
	if (failure !== null) throw new TranslatorError(failure, { code: "upstream_error", status: 502 });
	const message = reply?.message ?? {};
	const calls = callsOfReply(message.tool_calls);
	const out = { role: "assistant", content: typeof message.content === "string" ? message.content : "" };
	if (typeof message.thinking === "string" && message.thinking !== "") out[options.reasoningField ?? "reasoning"] = message.thinking;
	if (calls.length > 0) out.tool_calls = calls.map((call) => ({ id: call.id, type: call.type, function: call.function }));
	const usage = usageOf(reply);
	const created = Date.parse(reply?.created_at);
	return {
		id: completionId(),
		object: "chat.completion",
		created: Number.isNaN(created) ? Math.floor(Date.now() / 1000) : Math.floor(created / 1000),
		model: reply?.model,
		choices: [{ index: 0, message: out, finish_reason: finishOf(reply, calls.length > 0) }],
		...(usage === undefined ? {} : { usage })
	};
}

/**
 * Create the converter of an Ollama stream's lines into Chat Completions chunks. One chunker is for one reply: it keeps the completion id (so every
 * chunk carries the same one), the tool-call numbering across lines and whether any tool was called.
 * @param {{ model?: string, reasoningField?: string, includeUsage?: boolean }} [options] - `model` overrides the model name on the chunks; `reasoningField` is where the thinking goes (default `reasoning`); `includeUsage` (default true) adds the final usage chunk.
 * @returns {{ line: (line: any) => any[], finished: () => boolean, usage: () => any }} `line` gives the chunks one line produces (an error line gives one `{ error }` chunk), `finished` says whether the final line was seen and `usage` is the Chat Completions usage of it.
 */
export function createChunker(options = {}) {
	const id = completionId();
	const created = Math.floor(Date.now() / 1000);
	const field = options.reasoningField ?? "reasoning";
	let model = options.model;
	let started = false;
	let calls = 0;
	let finished = false;
	let usage;
	const make = (delta, finish = null) => ({
		id,
		object: "chat.completion.chunk",
		created,
		model,
		choices: [{ index: 0, delta, finish_reason: finish }]
	});
	return {
		line(line) {
			const failure = errorOf(line);
			if (failure !== null) {
				finished = true;
				return [{ error: { message: failure, type: "api_error", param: null, code: null } }];
			}
			model = options.model ?? line?.model ?? model;
			const out = [];
			if (!started) {
				started = true;
				out.push(make({ role: "assistant", content: "" }));
			}
			const message = line?.message ?? {};
			const delta = {};
			if (typeof message.thinking === "string" && message.thinking !== "") delta[field] = message.thinking;
			if (typeof message.content === "string" && message.content !== "") delta.content = message.content;
			const fresh = callsOfReply(message.tool_calls, calls);
			if (fresh.length > 0) {
				calls += fresh.length;
				delta.tool_calls = fresh;
			}
			if (Object.keys(delta).length > 0) out.push(make(delta));
			if (line?.done === true) {
				finished = true;
				usage = usageOf(line);
				out.push(make({}, finishOf(line, calls > 0)));
				if (options.includeUsage !== false && usage !== undefined) {
					out.push({ id, object: "chat.completion.chunk", created, model, choices: [], usage });
				}
			}
			return out;
		},
		finished: () => finished,
		usage: () => usage
	};
}

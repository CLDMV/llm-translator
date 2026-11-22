/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/gemini.mjs
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
 * @fileoverview Google Gemini's native `generateContent` API as Chat Completions: the request body, the reply and the streamed chunks are translated to and from the Chat Completions shapes the converters already know. Written to be shared by every upstream that speaks this API (the Gemini API today, Vertex AI's Gemini models later).
 * @module @cldmv/llm-translator/lib/gemini
 */
import { TranslatorError } from "./errors.mjs";
import { callId, completionId } from "./ids.mjs";
import { parseArguments } from "./arguments.mjs";
import { reasoningOf } from "./thinking.mjs";

/** `format` of the `reasoning_details` items that carry a Gemini `thoughtSignature` (`data`) and the part it belongs to (`for`: `text` or `call`, with the tool call `id` for a call). */
export const FORMAT = "google-gemini-v1";

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
	"n",
	"presence_penalty",
	"frequency_penalty",
	"response_format",
	"reasoning_effort"
]);

/** Chat Completions fields that mean nothing to Gemini and are not worth a mention when they are left out. */
const SILENT = new Set(["stream_options", "user", "metadata", "store", "service_tier"]);

/** Image types Gemini takes, as the MIME types a data URL names. */
const IMAGES = new Set(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);

/** Text that stands in for an image Gemini cannot be given: it takes base64 PNG, JPEG, WebP, HEIC and HEIF images, and the translator does not fetch URLs. */
const IMAGE_NOTE =
	"[An image was omitted because Gemini accepts base64 PNG, JPEG, WebP, HEIC and HEIF images only and the translator does not fetch URLs.]";

/** Text of a tool result that has none: Gemini wants a response object with something in it. */
const NO_OUTPUT = "(no output)";

/** The thinking budget (tokens) sent for each reasoning effort. Gemini 2.5 models take a budget; Gemini 3 models still accept one. */
const BUDGETS = { minimal: 512, low: 1024, medium: 8192, high: 24576, xhigh: 24576, max: 24576 };

/** The thinking levels of Gemini 3 and later models, lowest first, and the effort each effort name asks for. */
const LEVELS = ["MINIMAL", "LOW", "MEDIUM", "HIGH", "XHIGH"];
const EFFORT_LEVEL = { minimal: 0, low: 1, medium: 2, high: 3, xhigh: 4, max: 4 };

/** The `thoughtSignature` Google documents for a function call part that has no real signature (history written by another model, or a client that dropped them). */
export const SKIP_SIGNATURE = "skip_thought_signature_validator";

/** Chat Completions `finish_reason` for each Gemini `finishReason`. A reason that is not here (and is not a normal end) is `error`. */
const FINISH = {
	STOP: "stop",
	FINISH_REASON_UNSPECIFIED: "stop",
	MAX_TOKENS: "length",
	SAFETY: "content_filter",
	RECITATION: "content_filter",
	LANGUAGE: "content_filter",
	BLOCKLIST: "content_filter",
	PROHIBITED_CONTENT: "content_filter",
	SPII: "content_filter",
	IMAGE_SAFETY: "content_filter",
	IMAGE_PROHIBITED_CONTENT: "content_filter",
	IMAGE_RECITATION: "content_filter"
};

/**
 * Record a field that has no Gemini equivalent, once.
 * @param {string[]} dropped - Names collected so far.
 * @param {string} name - Field name.
 */
function drop(dropped, name) {
	if (!dropped.includes(name)) dropped.push(name);
}

/**
 * The model's resource name as it goes in a URL: `models/<id>`, with the id percent-encoded. A `models/` prefix the caller already put on is not doubled.
 * @param {string} model - Model id, for example `gemini-2.5-flash` or `models/gemini-2.5-flash`.
 * @returns {string} `models/gemini-2.5-flash`.
 */
export function modelPath(model) {
	return `models/${encodeURIComponent(String(model).replace(/^models\//, ""))}`;
}

/**
 * The path of a call: under `/v1beta`, unless the upstream URL already ends in it.
 * @param {any} endpoint - Runtime endpoint.
 * @param {string} rest - Path after the version, without the leading slash (`models/gemini-2.5-flash:generateContent`).
 * @returns {string} Path starting with `/`.
 */
export function route(endpoint, rest) {
	return `${endpoint.url.endsWith("/v1beta") ? "" : "/v1beta"}/${rest}`;
}

/**
 * The path of the `countTokens` call that goes with the path of a `generateContent` or `streamGenerateContent` call. A model id has its colons
 * encoded, so the first colon is the method's.
 * @param {string} path - Path of a native call, `.../models/<model>:<method>`.
 * @returns {string} The same path with the `countTokens` method.
 */
export function countPath(path) {
	return `${path.slice(0, path.indexOf(":"))}:countTokens`;
}

/**
 * The body of a `countTokens` call for a `generateContent` body: the same prompt, as a `generateContentRequest` (which names the model).
 * @param {any} request - `generateContent` body.
 * @param {string} model - Model id.
 * @returns {any} `countTokens` body.
 */
export function countBody(request, model) {
	const out = { model: modelPath(model), contents: request.contents };
	for (const field of ["systemInstruction", "tools", "toolConfig"]) if (request[field] !== undefined) out[field] = request[field];
	return { generateContentRequest: out };
}

/**
 * The Gemini parts of a Chat Completions message content: text parts (an empty one is left out), images and PDFs from base64 data URLs
 * (an `image_url` part may carry a PDF: that is how the Anthropic converter hands one over) and files from base64 data URLs.
 * @param {any} content - String, or an array of content parts.
 * @param {string[]} dropped - Collects what was left out.
 * @returns {any[]} Parts.
 */
function partsOf(content, dropped) {
	if (typeof content === "string") return content === "" ? [] : [{ text: content }];
	const out = [];
	for (const part of Array.isArray(content) ? content : []) {
		if (part?.type === "text") {
			if (typeof part.text === "string" && part.text !== "") out.push({ text: part.text });
		} else if (part?.type === "image_url") {
			const match = /^data:([^;,]+);base64,(.*)$/s.exec(String(part.image_url?.url ?? part.image_url ?? ""));
			if (match && (IMAGES.has(match[1]) || match[1] === "application/pdf"))
				out.push({ inlineData: { mimeType: match[1], data: match[2] } });
			else {
				out.push({ text: IMAGE_NOTE });
				drop(dropped, "image_url");
			}
		} else if (part?.type === "file") {
			const match = /^data:([^;,]+);base64,(.*)$/s.exec(String(part.file?.file_data ?? ""));
			if (match) out.push({ inlineData: { mimeType: match[1], data: match[2] } });
			else drop(dropped, "content.file");
		} else drop(dropped, `content.${part?.type ?? "part"}`);
	}
	return out;
}

/**
 * The thought signatures an assistant message carries: the `reasoning_details` items in this protocol's format (anything else is ignored).
 * @param {any} details - `reasoning_details` of the message.
 * @returns {{ text: string | undefined, calls: Map<string, string> }} The signature of the text and the signature of each tool call by its id.
 */
function signaturesOf(details) {
	const out = { text: undefined, calls: new Map() };
	for (const item of Array.isArray(details) ? details : []) {
		if (item?.format !== FORMAT || typeof item.data !== "string" || item.data === "") continue;
		if (item.for === "call" && typeof item.id === "string") out.calls.set(item.id, item.data);
		else if (item.for === "text") out.text = item.data;
	}
	return out;
}

/**
 * A tool result as the text that stands in for it when the request has no tools.
 * @param {{ name?: string, response: any }} result - The `functionResponse`.
 * @returns {string} For example `[Result of tool Read: file a]`, or `[Tool Read failed: file missing]`.
 */
function textOfResult(result) {
	const failed = result.response.error !== undefined;
	const body = failed ? result.response.error : result.response.output;
	return failed ? `[Tool ${result.name} failed: ${body}]` : `[Result of tool ${result.name}: ${body}]`;
}

/**
 * The Gemini contents of a conversation and its system parts. System and developer messages become the system parts. A tool message is a
 * user turn with a `functionResponse` part; consecutive messages of one role are merged, so the calls of one turn and their results each sit
 * in one content. Gemini rejects `functionCall` and `functionResponse` parts in a request that declares no tools, so with `plain` past tool
 * calls and results are written as text instead.
 * @param {any[]} list - Chat Completions messages.
 * @param {string[]} dropped - Collects what was left out.
 * @param {string | undefined} marker - Text that marks a failed tool result.
 * @param {boolean} plain - Write tool calls and results as text.
 * @returns {{contents: any[], system: any[]}} Gemini contents and system parts.
 */
function conversationOf(list, dropped, marker, plain) {
	const contents = [];
	const system = [];
	const names = new Map();
	for (const message of list) {
		let role = "user";
		let parts;
		if (message?.role === "system" || message?.role === "developer") {
			system.push(...partsOf(message.content, dropped));
			continue;
		} else if (message?.role === "tool") {
			const found = partsOf(message.content, dropped);
			const text = found
				.filter((part) => part.text !== undefined)
				.map((part) => part.text)
				.join("\n");
			const failed = marker !== undefined && text.startsWith(marker);
			const output = (failed ? text.slice(marker.length) : text) || NO_OUTPUT;
			const result = {
				id: message.tool_call_id,
				name: names.get(message.tool_call_id) ?? message.name ?? "tool",
				response: failed ? { error: output } : { output }
			};
			parts = [plain ? { text: textOfResult(result) } : { functionResponse: result }, ...found.filter((part) => part.inlineData)];
		} else if (message?.role === "user") parts = partsOf(message.content, dropped);
		else if (message?.role === "assistant") {
			role = "model";
			parts = partsOf(message.content, dropped);
			const signatures = signaturesOf(message.reasoning_details);
			if (signatures.text !== undefined) {
				const last = [...parts].reverse().find((part) => part.text !== undefined);
				if (last) last.thoughtSignature = signatures.text;
			}
			if (signatures.text === undefined && signatures.calls.size === 0 && reasoningOf(message) !== "") drop(dropped, "reasoning");
			for (const call of message.tool_calls ?? []) {
				const args = parseArguments(call.function?.arguments);
				names.set(call.id, call.function?.name);
				if (plain) parts.push({ text: `[Called tool ${call.function?.name} with input ${JSON.stringify(args)}]` });
				else {
					const signature = signatures.calls.get(call.id);
					parts.push({
						functionCall: { id: call.id, name: call.function?.name, args },
						...(signature === undefined ? {} : { thoughtSignature: signature })
					});
				}
			}
		} else {
			drop(dropped, `messages.${message?.role}`);
			continue;
		}
		if (parts.length === 0) continue;
		if (contents.at(-1)?.role === role) contents.at(-1).parts.push(...parts);
		else contents.push({ role, parts });
	}
	// Gemini 3 models refuse a model turn whose first function call has no signature, so a call without a real one gets the documented placeholder.
	for (const content of contents) {
		const first = content.role === "model" ? content.parts.find((part) => part.functionCall) : undefined;
		if (first && first.thoughtSignature === undefined) first.thoughtSignature = SKIP_SIGNATURE;
	}
	return { contents, system };
}

/**
 * The thinking levels a model takes. Gemini 3 and later models take levels (`thinkingLevel`) and Gemini 2.5 and earlier take a token budget.
 * @param {unknown} model - Model id as sent upstream, with or without the `models/` prefix.
 * @returns {number[] | null} Indexes into `LEVELS`, or null for a model that takes a budget. Gemini 4 has no `MINIMAL` and adds `XHIGH`, `gemini-3-pro` has `LOW` and `HIGH` only, other Pro models no `MINIMAL`, and the Gemini 3 Flash models the four lower levels.
 */
function levelsOf(model) {
	const match = /^(?:models\/)?gemini-(\d+)(?:\.\d+)?-([a-z]+)/.exec(String(model));
	if (match === null || Number(match[1]) < 3) return null;
	if (Number(match[1]) >= 4) return [1, 2, 3, 4];
	if (match[2] === "pro") return /^(?:models\/)?gemini-3-pro/.test(String(model)) ? [1, 3] : [1, 2, 3];
	return [0, 1, 2, 3];
}

/**
 * The `thinkingConfig` for a request. A model that takes a budget gets the explicit one, or one per effort (`BUDGETS`; `none` is a zero
 * budget). A model that takes levels gets the level of the effort (a budget counts as the effort it is closest to), moved to the nearest level the
 * model has; `none` is the lowest level, because these models cannot switch thinking off, and sending a budget to them is refused or
 * deprecated. Thought summaries are asked for whenever thinking is on.
 * @param {any} effort - Chat Completions `reasoning_effort`.
 * @param {number | undefined} budget - Token budget of enabled thinking.
 * @param {string[]} dropped - Collects what was left out.
 * @param {unknown} model - Model id as sent upstream.
 * @returns {any} `thinkingConfig`, or undefined when the request does not ask for any.
 */
function thinkingOf(effort, budget, dropped, model) {
	const levels = levelsOf(model);
	if (levels === null) {
		if (budget !== undefined) return { includeThoughts: true, thinkingBudget: budget };
		if (effort === undefined || effort === null) return undefined;
		if (effort === "none") return { thinkingBudget: 0 };
		if (Object.hasOwn(BUDGETS, effort)) return { includeThoughts: true, thinkingBudget: BUDGETS[effort] };
	} else {
		let want;
		if (budget !== undefined) want = budget < 1024 ? 0 : budget < 4096 ? 1 : budget < 16384 ? 2 : 3;
		else if (effort === undefined || effort === null) return undefined;
		else if (effort === "none") want = -1;
		else if (Object.hasOwn(EFFORT_LEVEL, effort)) want = EFFORT_LEVEL[effort];
		if (want !== undefined) {
			// The nearest level the model has; a tie goes to the lower one, so `none` (below every level) lands on the lowest.
			const level = levels.reduce((best, entry) => (Math.abs(entry - want) < Math.abs(best - want) ? entry : best));
			return { ...(effort === "none" ? {} : { includeThoughts: true }), thinkingLevel: LEVELS[level] };
		}
	}
	drop(dropped, "reasoning_effort");
	return undefined;
}

/**
 * Convert a Chat Completions request body to a `generateContent` body (`contents`, `systemInstruction`, `generationConfig`, `tools` and
 * `toolConfig`; the model and the choice of streaming belong to the URL, so neither is in the body). `max_tokens`, `temperature`, `top_p`,
 * `top_k`, `stop`, `seed`, the penalties and `n` become `generationConfig` fields, `response_format` becomes `responseMimeType` with
 * `responseJsonSchema`, tools become function declarations with their JSON Schema as `parametersJsonSchema`, `tool_choice` becomes the calling
 * mode (`auto`, `required` and one named function map to `AUTO`, `ANY` and `ANY` with the name allowed; `none` to `NONE`), images and files
 * are sent as bytes, and `reasoning_effort` or a thinking budget becomes `thinkingConfig`. What Gemini has no field for (`logprobs`,
 * `parallel_tool_calls`, images given by URL, reasoning text in history, ...) is left out and named in `dropped`. A request without tools has
 * its past tool calls and results written as text.
 * @param {any} body - Chat Completions request body.
 * @param {{ dropped?: string[], sampling?: Record<string, any>, thinkingBudget?: number, marker?: string, model?: string }} [context] - `model` is the model the request goes to (default: the body's `model`), which decides between a thinking budget and a thinking level; `dropped` collects the names of what was left out; `sampling` are extension fields for `generationConfig`; `thinkingBudget` is the token budget of enabled thinking; `marker` is the text that marks a failed tool result.
 * @returns {any} `generateContent` request body.
 */
export function chatBody(body, context = {}) {
	const dropped = context.dropped ?? [];
	const offered = Array.isArray(body.tools) && body.tools.length > 0;
	const { contents, system } = conversationOf(Array.isArray(body.messages) ? body.messages : [], dropped, context.marker, !offered);
	const out = { contents };
	if (system.length > 0) out.systemInstruction = { parts: system };
	const config = { ...context.sampling };
	const cap = body.max_completion_tokens ?? body.max_tokens;
	if (cap !== undefined && cap !== null) config.maxOutputTokens = cap;
	for (const [from, to] of [
		["temperature", "temperature"],
		["top_p", "topP"],
		["top_k", "topK"],
		["seed", "seed"],
		["presence_penalty", "presencePenalty"],
		["frequency_penalty", "frequencyPenalty"]
	]) {
		if (body[from] !== undefined && body[from] !== null) config[to] = body[from];
	}
	if (body.stop !== undefined && body.stop !== null) config.stopSequences = Array.isArray(body.stop) ? body.stop : [body.stop];
	if (body.n > 1) config.candidateCount = body.n;
	const format = body.response_format;
	if (format?.type === "json_object") config.responseMimeType = "application/json";
	else if (format?.type === "json_schema") {
		config.responseMimeType = "application/json";
		if (format.json_schema?.schema !== undefined) config.responseJsonSchema = format.json_schema.schema;
	} else if (format !== undefined && format !== null && format.type !== "text") drop(dropped, "response_format");
	const thinking = thinkingOf(body.reasoning_effort, context.thinkingBudget, dropped, context.model ?? body.model);
	if (thinking !== undefined) config.thinkingConfig = thinking;
	if (Object.keys(config).length > 0) out.generationConfig = config;
	if (offered) {
		out.tools = [
			{
				functionDeclarations: body.tools.map((tool) => {
					const schema = tool.function?.parameters;
					const empty = schema?.type === "object" && Object.keys(schema.properties ?? {}).length === 0;
					const { $schema: ___omitted, ...clean } = schema ?? {};
					return {
						name: tool.function?.name,
						...(tool.function?.description === undefined ? {} : { description: tool.function.description }),
						...(schema === undefined || schema === null || empty ? {} : { parametersJsonSchema: clean })
					};
				})
			}
		];
		const choice = body.tool_choice;
		if (choice === "required") out.toolConfig = { functionCallingConfig: { mode: "ANY" } };
		else if (choice === "none") out.toolConfig = { functionCallingConfig: { mode: "NONE" } };
		else if (choice?.type === "function")
			out.toolConfig = { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [choice.function?.name] } };
		else if (choice !== undefined && choice !== "auto") drop(dropped, "tool_choice");
	}
	for (const key of Object.keys(body)) {
		if (HANDLED.has(key) || SILENT.has(key)) continue;
		drop(dropped, key);
	}
	return out;
}

/**
 * Chat Completions `finish_reason` for a Gemini `finishReason`: `STOP` is `stop`, `MAX_TOKENS` is `length`, the safety, recitation, blocklist,
 * prohibited content, SPII and image safety reasons are `content_filter`, and every other reason (a malformed function call, a missing thought
 * signature, `OTHER`, one this table does not know) is `error`, a failure and not an answer. A reply that called tools is `tool_calls`.
 * @param {string | undefined} reason - Gemini `finishReason`.
 * @param {boolean} calls - Whether the reply carried tool calls.
 * @returns {string} `finish_reason`.
 */
export function finishOf(reason, calls) {
	const finish = reason === undefined ? "stop" : Object.hasOwn(FINISH, reason) ? FINISH[reason] : "error";
	return calls && finish === "stop" ? "tool_calls" : finish;
}

/**
 * Chat Completions usage from a Gemini `usageMetadata`. Gemini counts cached tokens inside `promptTokenCount` and thinking tokens apart from
 * `candidatesTokenCount`; the completion is both, and tokens of tool use prompts count as prompt.
 * @param {any} meta - Gemini `usageMetadata`.
 * @returns {{prompt_tokens: number, completion_tokens: number, total_tokens: number, prompt_tokens_details?: {cached_tokens: number}, completion_tokens_details?: {reasoning_tokens: number}} | undefined} Usage, or undefined when there are no counts.
 */
export function usageOf(meta) {
	if (!Number.isFinite(meta?.promptTokenCount) && !Number.isFinite(meta?.candidatesTokenCount)) return undefined;
	const count = (value) => (Number.isFinite(value) ? value : 0);
	const prompt = count(meta.promptTokenCount) + count(meta.toolUsePromptTokenCount);
	const thoughts = count(meta.thoughtsTokenCount);
	const completion = count(meta.candidatesTokenCount) + thoughts;
	const cached = count(meta.cachedContentTokenCount);
	return {
		prompt_tokens: prompt,
		completion_tokens: completion,
		total_tokens: prompt + completion,
		...(cached > 0 ? { prompt_tokens_details: { cached_tokens: cached } } : {}),
		...(thoughts > 0 ? { completion_tokens_details: { reasoning_tokens: thoughts } } : {})
	};
}

/**
 * The same counts as Anthropic usage, which is what the OpenAI front's usage report reads from a converted reply (cached tokens are not in `input_tokens`).
 * @param {any} meta - Gemini `usageMetadata`.
 * @returns {{input_tokens: number, output_tokens: number, cache_read_input_tokens: number, cache_creation_input_tokens: number} | undefined} Anthropic usage, or undefined when there are no counts.
 */
export function folded(meta) {
	const usage = usageOf(meta);
	if (usage === undefined) return undefined;
	const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
	return {
		input_tokens: usage.prompt_tokens - cached,
		output_tokens: usage.completion_tokens,
		cache_read_input_tokens: cached,
		cache_creation_input_tokens: 0
	};
}

/**
 * The refusal text for a reply that was filtered.
 * @param {string} reason - `finishReason` or `blockReason`.
 * @param {string | undefined} message - The upstream's own explanation (`finishMessage`, `blockReasonMessage`), when it sent one.
 * @param {boolean} prompt - Whether the prompt was blocked (and not the reply).
 * @returns {string} Text.
 */
function refusalOf(reason, message, prompt) {
	return typeof message === "string" && message !== "" ? message : `Gemini blocked the ${prompt ? "prompt" : "reply"} (${reason}).`;
}

/**
 * The `reasoning_details` item for a thought signature.
 * @param {number} index - Position of the item in the reply.
 * @param {string} signature - `thoughtSignature`.
 * @param {string | undefined} id - Id of the tool call the signature belongs to; none for the text.
 * @returns {any} The item.
 */
function detailOf(index, signature, id) {
	return {
		type: "reasoning.encrypted",
		format: FORMAT,
		index,
		data: signature,
		...(id === undefined ? { for: "text" } : { for: "call", id })
	};
}

/**
 * One candidate as a Chat Completions choice.
 * @param {any} candidate - Gemini candidate.
 * @param {number} index - Choice index.
 * @param {string} field - Where the reasoning text goes.
 * @returns {any} Choice.
 */
function choiceOf(candidate, index, field) {
	let text = "";
	let thought = "";
	const calls = [];
	const details = [];
	for (const part of Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []) {
		let id;
		if (part?.functionCall) {
			id = typeof part.functionCall.id === "string" && part.functionCall.id !== "" ? part.functionCall.id : callId();
			calls.push({
				id,
				type: "function",
				function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args ?? {}) }
			});
		} else if (typeof part?.text === "string") {
			if (part.thought === true) thought += part.text;
			else text += part.text;
		}
		if (typeof part?.thoughtSignature === "string" && part.thoughtSignature !== "")
			details.push(detailOf(details.length, part.thoughtSignature, id));
	}
	const message = { role: "assistant", content: text };
	if (thought !== "") message[field] = thought;
	if (details.length > 0) message.reasoning_details = details;
	if (calls.length > 0) message.tool_calls = calls;
	const finish = finishOf(candidate?.finishReason, calls.length > 0);
	if (finish === "content_filter") message.refusal = refusalOf(candidate.finishReason, candidate.finishMessage, false);
	return { index, message, finish_reason: finish };
}

/**
 * Convert a (non-streaming) `generateContent` reply to a Chat Completions `chat.completion`: text parts are joined into the content, thought
 * parts go in the settings' reasoning field, `functionCall` parts become tool calls (with Gemini's call id when it sent one), thought signatures
 * become `reasoning_details` items (see `FORMAT`) that are sent back with the next request, `finishReason` becomes `finish_reason` and
 * `usageMetadata` becomes `usage`. A prompt Gemini blocked (`promptFeedback.blockReason`, no candidates) is an empty reply that was filtered.
 * @param {any} reply - Parsed `generateContent` reply.
 * @param {{ reasoningField?: string, model?: string }} [options] - `reasoningField` is where the reasoning goes (default `reasoning`); `model` is the model name on the completion.
 * @returns {any} `chat.completion` object.
 * @throws {TranslatorError} `invalid_upstream_response` (502) when the reply has no candidate and no block reason.
 */
export function completion(reply, options = {}) {
	const field = options.reasoningField ?? "reasoning";
	let choices;
	if (Array.isArray(reply?.candidates) && reply.candidates.length > 0) {
		choices = reply.candidates.map((candidate, at) => choiceOf(candidate, candidate.index ?? at, field));
	} else if (typeof reply?.promptFeedback?.blockReason === "string") {
		const reason = reply.promptFeedback.blockReason;
		choices = [
			{
				index: 0,
				message: { role: "assistant", content: "", refusal: refusalOf(reason, reply.promptFeedback.blockReasonMessage, true) },
				finish_reason: "content_filter"
			}
		];
	} else throw new TranslatorError("Upstream response contained no message", { code: "invalid_upstream_response", status: 502 });
	const usage = usageOf(reply.usageMetadata);
	return {
		id: completionId(),
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model: options.model,
		choices,
		...(usage === undefined ? {} : { usage })
	};
}

/**
 * Create the converter of a `streamGenerateContent` reply's chunks into Chat Completions chunks. Every chunk of the reply is a whole
 * `GenerateContentResponse`: its parts become deltas (a function call arrives whole, so it is one delta), and the chunk with a `finishReason`
 * ends the reply. One chunker is for one reply: it keeps the completion id (so every chunk carries the same one) and the numbering of tool calls.
 * Only the first candidate is streamed. An `error` object in the stream gives one `{ error }` chunk.
 * @param {{ model?: string, reasoningField?: string, includeUsage?: boolean }} [options] - `model` is the model name on the chunks; `reasoningField` is where the reasoning goes (default `reasoning`); `includeUsage` (default true) adds the final usage chunk.
 * @returns {{ event: (data: any) => any[], finished: () => boolean, usage: () => any }} `event` gives the chunks one stream chunk produces, `finished` says whether the reply ended (a `finishReason`, a blocked prompt, or a failure) and `usage` is the latest `usageMetadata`.
 */
export function createChunker(options = {}) {
	const id = completionId();
	const created = Math.floor(Date.now() / 1000);
	const field = options.reasoningField ?? "reasoning";
	let started = false;
	let finished = false;
	let counted = false;
	let calls = 0;
	let details = 0;
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
	return {
		event(data) {
			if (data?.error !== undefined && data?.error !== null) {
				finished = true;
				const status = Number.isInteger(data.error.code) ? data.error.code : 500;
				return [
					{
						error: {
							message: data.error.message,
							type: status >= 500 ? "server_error" : "invalid_request_error",
							param: null,
							code: status
						}
					}
				];
			}
			if (data?.usageMetadata !== undefined) usage = data.usageMetadata;
			const out = [];
			const candidate = Array.isArray(data?.candidates) ? data.candidates.find((entry) => (entry.index ?? 0) === 0) : undefined;
			if (candidate === undefined) {
				const reason = data?.promptFeedback?.blockReason;
				if (typeof reason === "string") {
					finished = true;
					out.push(
						...first(),
						make({ refusal: refusalOf(reason, data.promptFeedback.blockReasonMessage, true) }),
						make({}, "content_filter")
					);
				}
			} else {
				for (const part of Array.isArray(candidate.content?.parts) ? candidate.content.parts : []) {
					let call;
					if (part?.functionCall) {
						const given = part.functionCall.id;
						call = {
							index: calls++,
							id: typeof given === "string" && given !== "" ? given : callId(),
							type: "function",
							function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args ?? {}) }
						};
					}
					// The text of a part goes out before its signature (the signature closes the part); a call's signature goes before the call.
					if (call === undefined && typeof part?.text === "string" && part.text !== "") {
						out.push(...first(), make(part.thought === true ? { [field]: part.text } : { content: part.text }));
					}
					if (typeof part?.thoughtSignature === "string" && part.thoughtSignature !== "") {
						out.push(...first(), make({ reasoning_details: [detailOf(details++, part.thoughtSignature, call?.id)] }));
					}
					if (call) out.push(...first(), make({ tool_calls: [call] }));
				}
				if (typeof candidate.finishReason === "string") {
					finished = true;
					const finish = finishOf(candidate.finishReason, calls > 0);
					if (finish === "content_filter")
						out.push(...first(), make({ refusal: refusalOf(candidate.finishReason, candidate.finishMessage, false) }));
					out.push(...first(), make({}, finish));
				}
			}
			const total = usageOf(usage);
			if (finished && !counted && total !== undefined && options.includeUsage !== false) {
				counted = true;
				out.push({ id, object: "chat.completion.chunk", created, model: options.model, choices: [], usage: total });
			}
			return out;
		},
		finished: () => finished,
		usage: () => usage
	};
}

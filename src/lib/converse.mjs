/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/converse.mjs
 *	@Date: 2026-11-19T09:00:00-08:00 (1795107600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-19T09:00:00-08:00 (1795107600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Amazon Bedrock's Converse API as Chat Completions: the request body, the reply and the streamed events are translated to and from the Chat Completions shapes the converters already know.
 * @module @cldmv/llm-translator/lib/converse
 */
import { TranslatorError, anthropicToOpenAIType, anthropicTypeToStatus } from "./errors.mjs";
import { completionId } from "./ids.mjs";
import { parseArguments } from "./arguments.mjs";
import { reasoningOf } from "./thinking.mjs";

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
	"top_k"
]);

/** Chat Completions fields that mean nothing to Converse and are not worth a mention when they are left out. */
const SILENT = new Set(["stream_options", "user", "metadata", "store", "service_tier"]);

/** Image formats Converse takes, by MIME subtype. */
const FORMATS = { png: "png", jpeg: "jpeg", jpg: "jpeg", gif: "gif", webp: "webp" };

/** Text that stands in for an image Converse cannot be given: it takes image bytes of four formats, and the translator does not fetch URLs. */
const IMAGE_NOTE =
	"[An image was omitted because Converse accepts base64 PNG, JPEG, GIF and WebP images only and the translator does not fetch URLs.]";

/** System text for `tool_choice: "none"`: Converse has no way to forbid tool calls, so the model is told. */
const NO_TOOLS = "Do not call any tools in your next reply; answer with text only.";

/** Text of a tool result that has none: Converse rejects an empty result and a blank text block. */
const NO_OUTPUT = "(no output)";

/** Chat Completions `finish_reason` for each Converse `stopReason`; one that is not here is `stop`. */
const FINISH = {
	max_tokens: "length",
	model_context_window_exceeded: "length",
	tool_use: "tool_calls",
	content_filtered: "content_filter",
	guardrail_intervened: "content_filter",
	malformed_model_output: "error",
	malformed_tool_use: "error"
};

/**
 * Record a field that has no Converse equivalent, once.
 * @param {string[]} dropped - Names collected so far.
 * @param {string} name - Field name.
 */
function drop(dropped, name) {
	if (!dropped.includes(name)) dropped.push(name);
}

/**
 * The Converse content blocks of a Chat Completions message content: text blocks (an empty one is left out, Converse rejects blank text) and
 * images from base64 data URLs.
 * @param {any} content - String, or an array of content parts.
 * @param {string[]} dropped - Collects what was left out.
 * @returns {any[]} Content blocks.
 */
function blocksOf(content, dropped) {
	if (typeof content === "string") return content === "" ? [] : [{ text: content }];
	const out = [];
	for (const part of Array.isArray(content) ? content : []) {
		if (part?.type === "text") {
			if (typeof part.text === "string" && part.text !== "") out.push({ text: part.text });
		} else if (part?.type === "image_url") {
			const match = /^data:image\/([a-z]+);base64,(.*)$/s.exec(String(part.image_url?.url ?? part.image_url ?? ""));
			if (match && Object.hasOwn(FORMATS, match[1])) out.push({ image: { format: FORMATS[match[1]], source: { bytes: match[2] } } });
			else {
				out.push({ text: IMAGE_NOTE });
				drop(dropped, "image_url");
			}
		} else drop(dropped, `content.${part?.type ?? "part"}`);
	}
	return out;
}

/**
 * A tool message as a `toolResult` block. A result whose text starts with the tool error marker (how an Anthropic `is_error` result reaches
 * Chat Completions) is sent with `status: "error"` and the marker removed.
 * @param {any} message - Chat Completions `tool` message.
 * @param {string[]} dropped - Collects what was left out.
 * @param {string | undefined} marker - Text that marks a failed result.
 * @returns {any} A `toolResult` content block.
 */
function resultOf(message, dropped, marker) {
	const content = blocksOf(message.content, dropped);
	const failed = marker !== undefined && content[0]?.text?.startsWith(marker) === true;
	if (failed) content[0] = { text: content[0].text.slice(marker.length) || NO_OUTPUT };
	return {
		toolResult: {
			toolUseId: message.tool_call_id,
			content: content.length > 0 ? content : [{ text: NO_OUTPUT }],
			...(failed ? { status: "error" } : {})
		}
	};
}

/**
 * A tool result as the text that stands in for it when the request has no tools.
 * @param {{content: any[], status?: string}} result - The `toolResult` block's content.
 * @param {string | undefined} name - Name of the tool, when its call is in the history.
 * @returns {string} For example `[Result of tool Read: file a]`, or `[Tool Read failed: file missing]`.
 */
function textOfResult(result, name) {
	const body = result.content.map((block) => block.text ?? "[image]").join("\n");
	return result.status === "error" ? `[Tool ${name ?? "call"} failed: ${body}]` : `[Result of tool ${name ?? "call"}: ${body}]`;
}

/**
 * The Converse messages of a conversation and its system prompt. System and developer messages become the `system` blocks. A tool message is
 * a user message with a `toolResult` block; consecutive messages of one role are merged, because Converse needs the roles to alternate.
 * Reasoning in an assistant message is not sent back (Converse needs it signed) and is named in `dropped`. Converse rejects `toolUse` and
 * `toolResult` blocks in a request that has no `toolConfig`, so with `plain` the past tool calls and results are written as text instead.
 * @param {any[]} list - Chat Completions messages.
 * @param {string[]} dropped - Collects what was left out.
 * @param {string | undefined} marker - Text that marks a failed tool result.
 * @param {boolean} plain - Write tool calls and results as text.
 * @returns {{messages: any[], system: any[]}} Converse messages and system blocks.
 */
function conversationOf(list, dropped, marker, plain) {
	const messages = [];
	const system = [];
	const names = new Map();
	for (const message of list) {
		let role = "user";
		let content;
		if (message?.role === "system" || message?.role === "developer") {
			system.push(...blocksOf(message.content, dropped));
			continue;
		} else if (message?.role === "tool") {
			const block = resultOf(message, dropped, marker);
			content = plain ? [{ text: textOfResult(block.toolResult, names.get(message.tool_call_id)) }] : [block];
		} else if (message?.role === "user") content = blocksOf(message.content, dropped);
		else if (message?.role === "assistant") {
			role = "assistant";
			content = blocksOf(message.content, dropped);
			if (reasoningOf(message) !== "") drop(dropped, "reasoning");
			for (const call of message.tool_calls ?? []) {
				const input = parseArguments(call.function?.arguments);
				names.set(call.id, call.function?.name);
				content.push(
					plain
						? { text: `[Called tool ${call.function?.name} with input ${JSON.stringify(input)}]` }
						: { toolUse: { toolUseId: call.id, name: call.function?.name, input } }
				);
			}
		} else {
			drop(dropped, `messages.${message?.role}`);
			continue;
		}
		if (content.length === 0) continue;
		if (messages.at(-1)?.role === role) messages.at(-1).content.push(...content);
		else messages.push({ role, content });
	}
	return { messages, system };
}

/**
 * Convert a Chat Completions request body to a Converse body (`messages`, `system`, `inferenceConfig`, `toolConfig` and
 * `additionalModelRequestFields`; the model id and the choice of streaming belong to the URL, so neither is in the body). `max_tokens`,
 * `temperature`, `top_p` and `stop` become `inferenceConfig`, tools become `toolConfig` (`tool_choice` `auto`, `required` and one named function
 * map to `auto`, `any` and `tool`), images are sent as bytes, and `top_k`, the extension sampling fields and a thinking budget go in
 * `additionalModelRequestFields`, which carries a model's own parameters. What Converse has no field for (`response_format`, `n`,
 * `parallel_tool_calls`, `seed`, penalties, images given by URL, reasoning in history, ...) is left out and named in `dropped`.
 * Converse needs a `toolConfig` whenever the history has tool blocks and has no "none" choice, so: a request without tools has its past tool calls
 * and results written as text, and `tool_choice: "none"` with tools sends the `toolConfig` and adds a system instruction not to call tools.
 * @param {any} body - Chat Completions request body.
 * @param {{ dropped?: string[], sampling?: Record<string, any>, thinkingBudget?: number, marker?: string }} [context] - `dropped` collects the names of what was left out; `sampling` are extension fields for `additionalModelRequestFields`; `thinkingBudget` is the token budget of enabled thinking, sent as `thinking: { type: "enabled", budget_tokens }`; `marker` is the text that marks a failed tool result.
 * @returns {any} Converse request body.
 */
export function chatBody(body, context = {}) {
	const dropped = context.dropped ?? [];
	const offered = Array.isArray(body.tools) && body.tools.length > 0;
	const { messages, system } = conversationOf(Array.isArray(body.messages) ? body.messages : [], dropped, context.marker, !offered);
	const out = { messages };
	const inference = {};
	const cap = body.max_completion_tokens ?? body.max_tokens;
	if (cap !== undefined && cap !== null) inference.maxTokens = cap;
	if (body.temperature !== undefined && body.temperature !== null) inference.temperature = body.temperature;
	if (body.top_p !== undefined && body.top_p !== null) inference.topP = body.top_p;
	if (body.stop !== undefined && body.stop !== null) inference.stopSequences = Array.isArray(body.stop) ? body.stop : [body.stop];
	if (Object.keys(inference).length > 0) out.inferenceConfig = inference;
	if (offered) {
		const config = {
			tools: body.tools.map((tool) => ({
				toolSpec: {
					name: tool.function?.name,
					...(tool.function?.description === undefined ? {} : { description: tool.function.description }),
					inputSchema: { json: tool.function?.parameters ?? { type: "object", properties: {} } }
				}
			}))
		};
		const choice = body.tool_choice;
		if (choice === "required") config.toolChoice = { any: {} };
		else if (choice?.type === "function") config.toolChoice = { tool: { name: choice.function?.name } };
		else if (choice === "none") system.push({ text: NO_TOOLS });
		else if (choice !== undefined && choice !== "auto") drop(dropped, "tool_choice");
		out.toolConfig = config;
	}
	if (system.length > 0) out.system = system;
	const extra = { ...context.sampling };
	if (body.top_k !== undefined && body.top_k !== null) extra.top_k = body.top_k;
	if (context.thinkingBudget !== undefined) extra.thinking = { type: "enabled", budget_tokens: context.thinkingBudget };
	if (Object.keys(extra).length > 0) out.additionalModelRequestFields = extra;
	for (const key of Object.keys(body)) {
		if (HANDLED.has(key) || SILENT.has(key)) continue;
		if (key === "n" && !(body.n > 1)) continue;
		drop(dropped, key);
	}
	return out;
}

/**
 * Chat Completions `finish_reason` for a Converse `stopReason`: `end_turn` and `stop_sequence` are `stop`, `max_tokens` and
 * `model_context_window_exceeded` are `length`, `tool_use` is `tool_calls`, `content_filtered` and `guardrail_intervened` are `content_filter`,
 * and `malformed_model_output` and `malformed_tool_use` are `error` (a failure, not an answer). A reply that called tools is `tool_calls`.
 * @param {string | undefined} reason - Converse `stopReason`.
 * @param {boolean} calls - Whether the reply carried tool calls.
 * @returns {string} `finish_reason`.
 */
export function finishOf(reason, calls) {
	const finish = Object.hasOwn(FINISH, reason ?? "") ? FINISH[/** @type {string} */ (reason)] : "stop";
	return calls && finish === "stop" ? "tool_calls" : finish;
}

/**
 * Chat Completions usage from a Converse `usage` object. Converse counts cache reads and writes apart from `inputTokens`; the prompt is all three.
 * @param {any} usage - Converse `usage`.
 * @returns {{prompt_tokens: number, completion_tokens: number, total_tokens: number, prompt_tokens_details?: {cached_tokens: number}} | undefined} Usage, or undefined when there are no counts.
 */
export function usageOf(usage) {
	if (!Number.isFinite(usage?.inputTokens) && !Number.isFinite(usage?.outputTokens)) return undefined;
	const read = Number.isFinite(usage.cacheReadInputTokens) ? usage.cacheReadInputTokens : 0;
	const write = Number.isFinite(usage.cacheWriteInputTokens) ? usage.cacheWriteInputTokens : 0;
	const prompt = (Number.isFinite(usage.inputTokens) ? usage.inputTokens : 0) + read + write;
	const completion = Number.isFinite(usage.outputTokens) ? usage.outputTokens : 0;
	return {
		prompt_tokens: prompt,
		completion_tokens: completion,
		total_tokens: prompt + completion,
		...(read > 0 ? { prompt_tokens_details: { cached_tokens: read } } : {})
	};
}

/**
 * The same counts as Anthropic usage, which is what the OpenAI front's usage report reads from a converted reply (Converse reports them the
 * way Anthropic does: `inputTokens` leaves out the cache).
 * @param {any} usage - Converse `usage`.
 * @returns {{input_tokens: number, output_tokens: number, cache_read_input_tokens: number, cache_creation_input_tokens: number} | undefined} Anthropic usage, or undefined when there are no counts.
 */
export function folded(usage) {
	if (usageOf(usage) === undefined) return undefined;
	const count = (value) => (Number.isFinite(value) ? value : 0);
	return {
		input_tokens: count(usage.inputTokens),
		output_tokens: count(usage.outputTokens),
		cache_read_input_tokens: count(usage.cacheReadInputTokens),
		cache_creation_input_tokens: count(usage.cacheWriteInputTokens)
	};
}

/**
 * Convert a (non-streaming) Converse reply to a Chat Completions `chat.completion`: text blocks are joined into the content, reasoning blocks go
 * in the settings' reasoning field (redacted ones are left out), `toolUse` blocks become tool calls, `stopReason` becomes `finish_reason` and
 * `usage` becomes `usage`.
 * @param {any} reply - Parsed Converse reply.
 * @param {{ reasoningField?: string, model?: string }} [options] - `reasoningField` is where the reasoning goes (default `reasoning`); `model` is the model name on the completion.
 * @returns {any} `chat.completion` object.
 * @throws {TranslatorError} `invalid_upstream_response` (502) when the reply has no message.
 */
export function completion(reply, options = {}) {
	const blocks = reply?.output?.message?.content;
	if (!Array.isArray(blocks)) {
		throw new TranslatorError("Upstream response contained no message", { code: "invalid_upstream_response", status: 502 });
	}
	const calls = blocks
		.filter((block) => block?.toolUse)
		.map(({ toolUse }) => ({
			id: toolUse.toolUseId,
			type: "function",
			function: { name: toolUse.name, arguments: JSON.stringify(toolUse.input ?? {}) }
		}));
	const message = { role: "assistant", content: blocks.map((block) => block?.text ?? "").join("") };
	const reasoning = blocks.map((block) => block?.reasoningContent?.reasoningText?.text ?? "").join("");
	if (reasoning !== "") message[options.reasoningField ?? "reasoning"] = reasoning;
	if (calls.length > 0) message.tool_calls = calls;
	const usage = usageOf(reply.usage);
	return {
		id: completionId(),
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model: options.model,
		choices: [{ index: 0, message, finish_reason: finishOf(reply.stopReason, calls.length > 0) }],
		...(usage === undefined ? {} : { usage })
	};
}

/**
 * Create the converter of a ConverseStream's events into Chat Completions chunks. One chunker is for one reply: it keeps the completion id
 * (so every chunk carries the same one), the numbering of tool calls and which content block each belongs to.
 * @param {{ model?: string, reasoningField?: string, includeUsage?: boolean }} [options] - `model` is the model name on the chunks; `reasoningField` is where the reasoning goes (default `reasoning`); `includeUsage` (default true) adds the final usage chunk.
 * @returns {{ event: (name: string | undefined, data: any) => any[], finished: () => boolean, usage: () => any }} `event` gives the chunks one event produces (an Anthropic-shaped `error` message gives one `{ error }` chunk), `finished` says whether the reply ended (`messageStop`, or a failure) and `usage` is the Converse `usage` of the `metadata` event.
 */
export function createChunker(options = {}) {
	const id = completionId();
	const created = Math.floor(Date.now() / 1000);
	const field = options.reasoningField ?? "reasoning";
	const slots = new Map();
	let started = false;
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
	return {
		event(name, data) {
			if (name === "error") {
				finished = true;
				const type = data?.error?.type;
				return [
					{ error: { message: data?.error?.message, type: anthropicToOpenAIType(type), param: null, code: anthropicTypeToStatus(type) } }
				];
			}
			if (name === "contentBlockStart") {
				const tool = data?.start?.toolUse;
				if (tool === undefined) return [];
				slots.set(data.contentBlockIndex, slots.size);
				const call = { index: slots.size - 1, id: tool.toolUseId, type: "function", function: { name: tool.name, arguments: "" } };
				return [...first(), make({ tool_calls: [call] })];
			}
			if (name === "contentBlockDelta") {
				const delta = data?.delta;
				if (typeof delta?.text === "string" && delta.text !== "") return [...first(), make({ content: delta.text })];
				if (typeof delta?.toolUse?.input === "string") {
					const call = { index: slots.get(data.contentBlockIndex), function: { arguments: delta.toolUse.input } };
					return [...first(), make({ tool_calls: [call] })];
				}
				const thought = delta?.reasoningContent?.text;
				return typeof thought === "string" && thought !== "" ? [...first(), make({ [field]: thought })] : [];
			}
			if (name === "messageStop") {
				finished = true;
				return [...first(), make({}, finishOf(data?.stopReason, slots.size > 0))];
			}
			if (name === "metadata") {
				usage = data?.usage;
				const counted = usageOf(usage);
				if (options.includeUsage === false || counted === undefined) return [];
				return [{ id, object: "chat.completion.chunk", created, model: options.model, choices: [], usage: counted }];
			}
			return first();
		},
		finished: () => finished,
		usage: () => usage
	};
}

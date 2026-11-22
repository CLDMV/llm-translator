/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/cohere.mjs
 *	@Date: 2026-11-22T10:00:00-08:00 (1795370400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T10:00:00-08:00 (1795370400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Cohere's v2 chat API as Chat Completions: the request body, the reply and the streamed events are translated to and from the Chat Completions shapes the converters already know (documents and citations included, through the neutral citation of `lib/citations.mjs`), plus the host and URL facts the driver needs.
 * @module @cldmv/llm-translator/lib/cohere
 */
import { TranslatorError } from "./errors.mjs";
import { completionId } from "./ids.mjs";
import { reasoningOf } from "./thinking.mjs";
import { sourceOf, toAnnotation } from "./citations.mjs";

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
	"reasoning_effort",
	"logprobs",
	"parallel_tool_calls"
]);

/** Cohere's own request fields. A client of either front can send them on the Chat Completions body and they go through as given (a request that has one needs the native protocol, see `needsNative`). */
const NATIVE_FIELDS = ["documents", "citation_options", "safety_mode", "priority", "strict_tools", "logprobs"];

/** Chat Completions fields that mean nothing to Cohere and are not worth a mention when they are left out. */
const SILENT = new Set(["stream_options", "user", "metadata", "store", "service_tier"]);

/** Text of a tool result that has none: Cohere rejects an empty result. */
const NO_OUTPUT = "(no output)";

/** Chat Completions `finish_reason` for each Cohere `finish_reason`; one that is not here is `stop`. */
const FINISH = { MAX_TOKENS: "length", TOOL_CALL: "tool_calls" };

/** The range Cohere accepts for a sampling field (https://docs.cohere.com/reference/chat); a value outside it is moved to the nearest end. */
const LIMITS = { temperature: [0, Infinity], p: [0.01, 0.99], k: [0, 500], frequency_penalty: [0, 1], presence_penalty: [0, 1] };

/** The most stop sequences Cohere takes. */
const MAX_STOPS = 5;

/** Thinking token budget for each reasoning effort. Cohere has no effort levels, only a budget (https://docs.cohere.com/docs/reasoning recommends none, or up to about 31K). */
const BUDGETS = { minimal: 1024, low: 2048, medium: 8192, high: 16384, xhigh: 24576, max: 31000 };

/** Separator between the tool plan and the text that follows it. */
const PLAN_BREAK = "\n\n";

/**
 * The base URL without the Compatibility API's path root, which is where the native API (`/v2/chat`) and the model list (`/v1/models`) live.
 * @param {string} base - The upstream's base URL.
 * @returns {string} The URL without a trailing `/compatibility`.
 */
export function rootOf(base) {
	return base.endsWith(COMPATIBILITY) ? base.slice(0, -COMPATIBILITY.length) : base;
}

/**
 * Whether a client request uses something only Cohere's own protocol has, so an `auto` upstream sends it over `cohere.chat` instead of the
 * Compatibility API: a thinking budget, a reasoning effort other than `none` and `high` (the two the Compatibility API takes), one of Cohere's
 * own fields (`documents`, `citation_options`, `safety_mode`, `priority`, `strict_tools`, `logprobs`), a tool choice, a switch against parallel tool
 * calls, structured output next to tools, or a `document` or `search_result` block that asks for citations.
 * @param {any} body - Client request body (either front).
 * @returns {boolean} True when the request needs `cohere.chat`.
 */
export function needsNative(body) {
	if (body === null || typeof body !== "object") return false;
	if (body.thinking?.type === "enabled" && Number.isInteger(body.thinking.budget_tokens)) return true;
	const effort = body.reasoning_effort ?? body.output_config?.effort;
	if (typeof effort === "string" && effort !== "none" && effort !== "high") return true;
	if (NATIVE_FIELDS.some((key) => body[key] !== undefined && body[key] !== false)) return true;
	// The Compatibility API has no tool choice (other than leaving it to the model), no switch against parallel tool calls, and no structured output next to tools.
	const choice = body.tool_choice;
	if (typeof choice === "string" ? choice !== "auto" : choice?.type !== undefined && choice.type !== "auto") return true;
	if (body.parallel_tool_calls === false || choice?.disable_parallel_tool_use === true) return true;
	if (
		Array.isArray(body.tools) &&
		body.tools.length > 0 &&
		(body.response_format !== undefined || body.output_config?.format !== undefined)
	)
		return true;
	const asks = (content) =>
		Array.isArray(content) &&
		content.some(
			(block) =>
				((block?.type === "document" || block?.type === "search_result") && block.citations?.enabled === true) || asks(block?.content)
		);
	return Array.isArray(body.messages) && body.messages.some((message) => asks(message?.content));
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
 * What the messages of one request leave for the body and the conversion state: the Cohere documents made from request sources, and the
 * facts the reply converters need to name them again.
 * @typedef {object} Gathered
 * @property {Map<string, { doc: { id: string, data: Record<string, any> }, texts: string[], top: boolean }>} documents - Documents by id: the Cohere document, the texts it is made of and whether it goes in the request's `documents`.
 * @property {Record<string, { kind: string, index: number, title?: string, source?: string, length: number, blocks?: number }>} info - What each document was, by id (JSON-safe, kept in the state).
 * @property {Record<string, number>} tools - Position of each tool result, by tool call id.
 * @property {string | undefined} marker - Text that marks a failed tool result.
 */

/**
 * The document a content part belongs to, when the part came from a `document` or `search_result` block that asked for citations: the part's
 * text is added to the document, which Cohere then cites by its id. Any other part is not part of a document.
 * @param {any} part - Chat Completions content part.
 * @param {Gathered} gathered - Collects the documents.
 * @param {boolean} top - Whether the document goes in the request's `documents` (user turns) rather than in a tool result.
 * @returns {{ doc: { id: string, data: Record<string, any> }, texts: string[], top: boolean } | null} The document, or null for a part that is not one.
 */
function documentOf(part, gathered, top) {
	const source = sourceOf(part);
	if (source === undefined || !source.citations || part.type !== "text") return null;
	const id = `${source.kind === "document" ? "doc" : "result"}_${source.index}`;
	if (!gathered.documents.has(id)) {
		gathered.documents.set(id, {
			doc: {
				id,
				data: {
					...(source.title === undefined ? {} : { title: source.title }),
					...(source.source === undefined ? {} : { source: source.source })
				}
			},
			texts: [],
			top
		});
		gathered.info[id] = {
			kind: source.kind,
			index: source.index,
			...(source.title === undefined ? {} : { title: source.title }),
			...(source.source === undefined ? {} : { source: source.source }),
			length: 0,
			...(source.blocks === undefined ? {} : { blocks: source.blocks })
		};
	}
	const found = /** @type {any} */ (gathered.documents.get(id));
	// A search result's own text is its content; the part's text also has the `[Search result: ...]` heading.
	const text = source.kind === "search_result" && source.text !== undefined ? source.text : part.text;
	found.texts.push(text);
	return found;
}

/**
 * The content of a tool message: a string of text, or (when the result has sources that asked for citations) blocks, with each source as a Cohere
 * `document` block that the model can cite. A failed result (it starts with the tool error marker) is the JSON object `{ "error": ... }`, which is
 * how Cohere's tool use documentation reports a failed call: Cohere has no error flag on a tool message.
 * @param {any} content - Tool message content (string, or parts).
 * @param {string[]} dropped - Collects what was left out.
 * @param {Gathered} gathered - Collects the documents.
 * @returns {any} Cohere tool message content.
 */
function toolContentOf(content, dropped, gathered) {
	const marker = gathered.marker;
	const parts = Array.isArray(content) ? content : [];
	if (parts.some((part) => sourceOf(part) !== undefined && sourceOf(part)?.citations)) {
		const blocks = [];
		for (const part of parts) {
			const found = documentOf(part, gathered, false);
			if (found === null) {
				if (part?.type === "text" && part.text !== "") blocks.push({ type: "text", text: part.text });
				else if (part?.type !== "text") drop(dropped, `content.${part?.type ?? "part"}`);
			} else if (!blocks.some((block) => block.document === found.doc)) blocks.push({ type: "document", document: found.doc });
		}
		return blocks;
	}
	let text = textOf(content, dropped);
	// With the marker as a lone first part (the other part of a result that is not plain text), the rest follows the marker.
	if (marker !== undefined && Array.isArray(content) && content[0]?.text === marker.trimEnd())
		text = text.slice(content[0].text.length).replace(/^\n/, "");
	const failed = marker !== undefined && (text.startsWith(marker) || (Array.isArray(content) && content[0]?.text === marker.trimEnd()));
	if (failed) return JSON.stringify({ error: (text.startsWith(marker) ? text.slice(marker.length) : text) || "error" });
	return text || NO_OUTPUT;
}

/** Heading of the source list written after marked thinking. */
const SOURCES = "Sources:";

/**
 * What a Cohere citation source is called in a marker list: a document by its title (else its id) with its URL when it has one, a tool result by its call.
 * @param {any} source - Cohere citation source (`type`, `id`, `document`).
 * @param {any} [state] - Conversion state (`documents`, for the titles of request documents).
 * @returns {{ key: string, label: string }} The key that tells sources apart and the label for the list.
 */
function labelOf(source, state) {
	const tool = source?.type === "tool";
	const document = source?.document ?? {};
	const info = state?.documents?.[source?.id];
	const title = info?.title ?? (typeof document.title === "string" ? document.title : undefined);
	const link = [document.url, document.source, info?.source].find((value) => typeof value === "string" && /^https?:\/\//i.test(value));
	const call = String(source?.id).split(":")[0];
	const name = tool ? `tool result ${call}` : (title ?? String(source?.id ?? "document"));
	return {
		key: tool ? `tool:${call}` : `doc:${source?.id ?? name}`,
		label: (link === undefined ? name : `${name} (${link})`).replace(/\s+/g, " ")
	};
}

/**
 * The numbering of one reply's markers: a source gets the next number the first time it is cited, and the list names them in that order.
 * @returns {{ number: (label: { key: string, label: string }) => number, list: () => string }} The numbering.
 */
function newMarks() {
	const numbers = new Map();
	const labels = [];
	return {
		number(entry) {
			if (!numbers.has(entry.key)) {
				labels.push(entry.label);
				numbers.set(entry.key, labels.length);
			}
			return numbers.get(entry.key);
		},
		list: () => (labels.length === 0 ? "" : `\n\n${SOURCES}\n${labels.map((label, at) => `[${at + 1}] ${label}`).join("\n")}`)
	};
}

/**
 * Write `[n]` markers into one piece of thinking text, at the end of each cited span (a citation with no usable end is marked at the end of the text).
 * @param {string} text - The thinking text the citations' offsets count in.
 * @param {{ end?: number, sources: any[] }[]} cites - Citations of that text.
 * @param {ReturnType<typeof newMarks>} marks - The reply's numbering.
 * @param {any} [state] - Conversion state.
 * @returns {string} The text with markers.
 */
function markPiece(text, cites, marks, state) {
	const placed = cites
		.map((cite) => ({ at: Number.isInteger(cite.end) ? Math.min(Math.max(cite.end, 0), text.length) : text.length, sources: cite.sources }))
		.sort((left, right) => left.at - right.at);
	let out = "";
	let from = 0;
	for (const cite of placed) {
		out += text.slice(from, cite.at);
		from = cite.at;
		out += [...new Set(cite.sources.map((source) => marks.number(labelOf(source, state))))].map((n) => `[${n}]`).join("");
	}
	return out + text.slice(from);
}

/**
 * Take the markers and the source list out of thinking text that `completion` or the chunker wrote them into, so Cohere gets back the text it
 * wrote. Only text that ends with a source list in the form the translator writes is touched, and then only the markers `[1]` to `[n]` for the
 * `n` sources in that list.
 * @param {string} text - Thinking text.
 * @returns {string} The text without markers and list, or the text itself when it has no source list.
 */
export function unmark(text) {
	const found = /\n\nSources:\n((?:\[\d+\] [^\n]*\n?)+)$/.exec(text);
	if (found === null) return text;
	const count = found[1].split("\n").filter((line) => line !== "").length;
	return text.slice(0, found.index).replace(/\[(\d+)\]/g, (all, n) => (Number(n) >= 1 && Number(n) <= count ? "" : all));
}

/**
 * The Cohere message of an assistant turn: its reasoning as a `thinking` block, its tool calls (`arguments` as JSON text), and its text, which is
 * the `tool_plan` when the turn has tool calls (the sentence a model writes before a call is Cohere's `tool_plan`, and that is how it is
 * returned, see `completion`) and the content otherwise.
 * @param {any} message - Chat Completions assistant message.
 * @param {string[]} dropped - Collects what was left out.
 * @returns {any | null} The message, or null when there is nothing to send (Cohere rejects empty content).
 */
function assistantOf(message, dropped) {
	const text = textOf(message.content, dropped);
	const thinking = unmark(reasoningOf(message));
	const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
	const entry = /** @type {any} */ ({ role: "assistant" });
	if (thinking !== "")
		entry.content = [{ type: "thinking", thinking }, ...(text === "" || calls.length > 0 ? [] : [{ type: "text", text }])];
	else if (text !== "" && calls.length === 0) entry.content = text;
	if (calls.length > 0) {
		if (text !== "") entry.tool_plan = text;
		entry.tool_calls = calls.map((call) => {
			const args = call.function?.arguments;
			return {
				id: call.id,
				type: "function",
				function: { name: call.function?.name, arguments: typeof args === "string" ? args || "{}" : JSON.stringify(args ?? {}) }
			};
		});
	}
	return Object.keys(entry).length > 1 ? entry : null;
}

/**
 * The Cohere messages of a conversation. System and developer messages are system messages; a user message's text and images are content blocks,
 * and its sources that asked for citations leave it for the request's `documents`; a tool message carries its `tool_call_id`; an assistant message
 * has its reasoning, tool plan and tool calls. A message with nothing to send is left out, because Cohere rejects empty content.
 * @param {any[]} list - Chat Completions messages.
 * @param {string[]} dropped - Collects what was left out.
 * @param {Gathered} gathered - Collects the documents and tool result positions.
 * @returns {any[]} Cohere messages.
 */
function messagesOf(list, dropped, gathered) {
	const out = [];
	for (const message of list) {
		const role = message?.role;
		if (role === "system" || role === "developer") {
			const text = textOf(message.content, dropped);
			if (text !== "") out.push({ role: "system", content: text });
		} else if (role === "user") {
			const rest = Array.isArray(message.content)
				? message.content.filter((part) => documentOf(part, gathered, true) === null)
				: message.content;
			const content = blocksOf(rest, dropped);
			if (content.length > 0) out.push({ role: "user", content });
		} else if (role === "tool") {
			gathered.tools[message.tool_call_id] = Object.keys(gathered.tools).length;
			out.push({ role: "tool", tool_call_id: message.tool_call_id, content: toolContentOf(message.content, dropped, gathered) });
		} else if (role === "assistant") {
			const entry = assistantOf(message, dropped);
			if (entry !== null) out.push(entry);
		} else {
			drop(dropped, `messages.${role}`);
		}
	}
	return out;
}

/**
 * Cohere's `thinking` setting for a request. `disabled` (an Anthropic request that turns thinking off) and a reasoning effort of `none` switch it
 * off. Any other effort is an enabled setting with the token budget for that level (Cohere has a budget, not levels), and an Anthropic request that
 * enables thinking with a budget sends that budget. `adaptive` and a request that says nothing leave it to the model.
 * @param {any} body - Chat Completions body.
 * @param {{ thinking?: string | null, thinkingBudget?: number }} context - The Anthropic request's thinking mode and budget.
 * @returns {{ type: string, token_budget?: number } | undefined} The setting, or undefined.
 */
function thinkingOf(body, context) {
	if (context.thinking === "disabled" || body.reasoning_effort === "none") return { type: "disabled" };
	if (typeof body.reasoning_effort === "string") {
		return { type: "enabled", ...(Object.hasOwn(BUDGETS, body.reasoning_effort) ? { token_budget: BUDGETS[body.reasoning_effort] } : {}) };
	}
	if (context.thinking === "enabled") {
		return { type: "enabled", ...(context.thinkingBudget === undefined ? {} : { token_budget: context.thinkingBudget }) };
	}
	return undefined;
}

/**
 * Move the sampling fields of a body into the range Cohere accepts, and keep at most five stop sequences. The names of the fields that moved are
 * added to `clamped`.
 * @param {any} out - Cohere body under construction.
 * @param {string[]} clamped - Collects the names.
 */
function clamp(out, clamped) {
	for (const [key, [low, high]] of Object.entries(LIMITS)) {
		const value = out[key];
		if (typeof value !== "number" || !Number.isFinite(value)) continue;
		const moved = key === "k" ? Math.round(Math.min(Math.max(value, low), high)) : Math.min(Math.max(value, low), high);
		if (moved !== value) {
			out[key] = moved;
			clamped.push(key);
		}
	}
	if (Array.isArray(out.stop_sequences) && out.stop_sequences.length > MAX_STOPS) {
		out.stop_sequences = out.stop_sequences.slice(0, MAX_STOPS);
		clamped.push("stop_sequences");
	}
}

/**
 * The instruction that stands in for `response_format` when a request has tools or documents, which Cohere does not take together with it.
 * @param {any} format - The `response_format` (`json_object` or `json_schema`).
 * @returns {string} The system instruction.
 */
function formatInstruction(format) {
	const schema = format.type === "json_schema" ? format.json_schema.schema : undefined;
	return schema === undefined
		? "When you answer without calling a tool, reply with only a valid JSON object and no other text."
		: `When you answer without calling a tool, reply with only a JSON object that matches this JSON Schema and no other text: ${JSON.stringify(schema)}`;
}

/**
 * Convert a Chat Completions request body to a Cohere `/v2/chat` body. `max_tokens` is the same field, `top_p` is `p`, `top_k` is `k`, `stop`
 * is `stop_sequences`, tools keep their JSON schema, `tool_choice` `required` and `none` are `REQUIRED` and `NONE`, and a named tool is `REQUIRED`
 * with only that tool offered (Cohere cannot force one of several any other way). `response_format` `json_object` and `json_schema` are a
 * `json_object` format with the schema; Cohere does not take it with tools or documents, so there it is a system instruction to answer in that
 * JSON. `logprobs` is `logprobs`, and `parallel_tool_calls: false` is kept on the state for the reply converters (Cohere has no such field, so they
 * keep the first tool call only). Thinking comes from `context` or `reasoning_effort` (see `thinkingOf`), sampling values are moved into Cohere's
 * ranges (named in `context.clamped`), and `documents`, `citation_options`, `safety_mode`, `priority` and `strict_tools` on the body are Cohere's own
 * fields and go through. Content parts tagged as request sources (`lib/citations.mjs`) that asked for citations are `documents` of their own, or
 * `document` blocks in a tool result, and a tool result that failed (the tool error marker) is `{ "error": ... }`. The extension sampling fields
 * (`sampling`) are Cohere's own field names and go in as given; anything the request names wins. What Cohere has no field for (`n` above 1, which the
 * translator answers by fan-out, `logit_bias`, `top_logprobs`, ...) is left out and named in `dropped`.
 * @param {any} body - Chat Completions request body.
 * @param {{ dropped?: string[], clamped?: string[], sampling?: Record<string, any>, thinking?: string | null, thinkingBudget?: number, marker?: string, state?: any }} [context] - `dropped` collects the names of what was left out and `clamped` the names of the values that were moved into Cohere's ranges; `sampling` are extension fields; `thinking` and `thinkingBudget` are an Anthropic request's thinking mode and token budget; `marker` is the text that marks a failed tool result; `state` is the conversion state, which gets `documents` (what each document id was), `tools` (the position of each tool result) and `singleCall`.
 * @returns {any} Cohere request body.
 */
export function chatBody(body, context = {}) {
	const dropped = context.dropped ?? [];
	const clamped = context.clamped ?? [];
	/** @type {Gathered} */
	const gathered = { documents: new Map(), info: {}, tools: {}, marker: context.marker };
	const out = /** @type {any} */ ({
		...context.sampling,
		model: body.model,
		stream: body.stream === true,
		messages: messagesOf(body.messages ?? [], dropped, gathered)
	});
	const documents = [
		...(Array.isArray(body.documents) ? body.documents : []),
		...[...gathered.documents.values()].filter((found) => found.top).map((found) => found.doc)
	];
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
		else if (choice?.type === "function") {
			// Cohere cannot name the tool to call, so only that tool is offered and a call is required.
			const named = out.tools.filter((tool) => tool.function.name === choice.function?.name);
			if (named.length > 0) {
				out.tools = named;
				out.tool_choice = "REQUIRED";
			} else drop(dropped, "tool_choice");
		} else if (choice !== undefined && choice !== "auto") drop(dropped, "tool_choice");
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
	if (body.logprobs === true) out.logprobs = true;
	clamp(out, clamped);
	const format = body.response_format;
	if (format?.type === "json_object" || (format?.type === "json_schema" && format.json_schema?.schema !== undefined)) {
		if (offered || documents.length > 0) {
			const at = out.messages.findIndex((message) => message.role !== "system");
			out.messages.splice(at === -1 ? out.messages.length : at, 0, { role: "system", content: formatInstruction(format) });
		} else {
			// A ternary: both sides are tested, and the `if` form got a V8 coverage merge count of -1 for its implicit else.
			out.response_format = { type: "json_object", ...(format.type === "json_schema" ? { json_schema: format.json_schema.schema } : {}) };
		}
	}
	if (documents.length > 0) out.documents = documents;
	for (const key of ["citation_options", "safety_mode", "priority"]) if (body[key] !== undefined) out[key] = body[key];
	if (typeof body.strict_tools === "boolean") out.strict_tools = body.strict_tools;
	const thinking = thinkingOf(body, context);
	if (thinking !== undefined) out.thinking = thinking;
	for (const key of Object.keys(body)) {
		if (HANDLED.has(key) || SILENT.has(key) || NATIVE_FIELDS.includes(key)) continue;
		if (key === "n" && !(body.n > 1)) continue;
		drop(dropped, key);
	}
	for (const found of gathered.documents.values()) {
		const text = found.texts.join("\n\n");
		found.doc.data.text = text;
		gathered.info[found.doc.id].length = text.length;
	}
	if (context.state) {
		context.state.documents = gathered.info;
		context.state.tools = gathered.tools;
		if (body.parallel_tool_calls === false) context.state.singleCall = true;
		// Citations are possible, so the chunker holds each thinking block until it ends (its citations become markers in it).
		if (documents.length > 0 || gathered.documents.size > 0) context.state.cites = true;
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
 * Chat Completions usage from a Cohere `usage` object: the model's own token counts (`tokens`), else the billed ones (`billed_units`), and the
 * cached prompt tokens (`cached_tokens`) as `prompt_tokens_details.cached_tokens`. The input count is taken to include the cached tokens, as
 * Chat Completions' `prompt_tokens` does.
 * @param {any} usage - Cohere `usage`.
 * @returns {{prompt_tokens: number, completion_tokens: number, total_tokens: number, prompt_tokens_details?: {cached_tokens: number}} | undefined} Usage, or undefined when there are no counts.
 */
export function usageOf(usage) {
	const source =
		Number.isFinite(usage?.tokens?.input_tokens) || Number.isFinite(usage?.tokens?.output_tokens) ? usage.tokens : usage?.billed_units;
	if (!Number.isFinite(source?.input_tokens) && !Number.isFinite(source?.output_tokens)) return undefined;
	const prompt = Number.isFinite(source.input_tokens) ? source.input_tokens : 0;
	const completion = Number.isFinite(source.output_tokens) ? source.output_tokens : 0;
	const cached = Number.isFinite(usage.cached_tokens) ? usage.cached_tokens : 0;
	return {
		prompt_tokens: prompt,
		completion_tokens: completion,
		total_tokens: prompt + completion,
		...(cached > 0 ? { prompt_tokens_details: { cached_tokens: cached } } : {})
	};
}

/**
 * The same counts as Anthropic usage, which is what the OpenAI front's usage report reads from a converted reply (the cached tokens are not in
 * `input_tokens`, as for Anthropic).
 * @param {any} usage - Cohere `usage`.
 * @returns {{input_tokens: number, output_tokens: number, cache_read_input_tokens: number, cache_creation_input_tokens: number} | undefined} Anthropic usage, or undefined when there are no counts.
 */
export function folded(usage) {
	const counted = usageOf(usage);
	if (counted === undefined) return undefined;
	const cached = counted.prompt_tokens_details?.cached_tokens ?? 0;
	return {
		input_tokens: Math.max(0, counted.prompt_tokens - cached),
		output_tokens: counted.completion_tokens,
		cache_read_input_tokens: cached,
		cache_creation_input_tokens: 0
	};
}

/**
 * Chat Completions `logprobs` entries for the log probabilities Cohere reports. Cohere gives, for a piece of the reply, its text, the token ids and one
 * log probability per token; the tokens' own strings are not given, so the text is the first token's and the others are empty strings (the tokens
 * join back to the text), and there are no top alternatives.
 * @param {any} items - Cohere `logprobs` (a list of `{ token_ids, text, logprobs }`) or one item.
 * @returns {{ token: string, logprob: number, bytes: number[], top_logprobs: [] }[]} Entries.
 */
export function logprobsOf(items) {
	const entries = [];
	for (const item of Array.isArray(items) ? items : [items]) {
		const list = Array.isArray(item?.logprobs) ? item.logprobs : [];
		list.forEach((logprob, at) => {
			const token = at === 0 && typeof item.text === "string" ? item.text : "";
			entries.push({ token, logprob, bytes: [...Buffer.from(token, "utf8")], top_logprobs: [] });
		});
	}
	return entries;
}

/**
 * The neutral citations of one Cohere citation: one for each source it names. `document` sources are the documents of the request (the state says
 * what each id was: a `document` or `search_result` block, with its position) or documents a client sent itself, and `tool` sources are tool results
 * (a `search_result` whose `source` is the tool call id).
 * @param {any} citation - Cohere citation (`start`, `end`, `sources`).
 * @param {number} base - Where the text the citation's offsets count from starts in the reply text.
 * @param {any} [state] - Conversion state (`documents`, `tools`).
 * @returns {import("./citations.mjs").Citation[]} Neutral citations spanning the cited text.
 */
export function citationsOf(citation, base, state) {
	const span = { start: base + citation.start, end: base + citation.end };
	/** @type {any[]} */
	const found = [];
	for (const source of Array.isArray(citation?.sources) ? citation.sources : []) {
		if (source?.type === "tool") {
			const [call] = String(source.id).split(":");
			found.push({
				kind: "search_result",
				source: call,
				index: state?.tools?.[call] ?? 0,
				text: JSON.stringify(source.tool_output ?? {}),
				location: {
					type: "block",
					start: Number(String(source.id).split(":")[1] ?? 0) || 0,
					end: (Number(String(source.id).split(":")[1] ?? 0) || 0) + 1
				},
				span
			});
			continue;
		}
		const info = state?.documents?.[source?.id];
		const document = source?.document ?? {};
		const text = typeof document.text === "string" ? document.text : typeof document.snippet === "string" ? document.snippet : undefined;
		const title = info?.title ?? (typeof document.title === "string" ? document.title : undefined);
		const cited = text === undefined ? {} : { text };
		if (info?.kind === "search_result") {
			found.push({
				kind: "search_result",
				index: info.index,
				...(title === undefined ? {} : { title }),
				...(info.source === undefined ? {} : { source: info.source }),
				...cited,
				location: { type: "block", start: 0, end: info.blocks ?? 1 },
				span
			});
		} else if (info?.kind === "document") {
			found.push({
				kind: "document",
				index: info.index,
				...(title === undefined ? {} : { title }),
				...cited,
				location: { type: "char", start: 0, end: info.length },
				span
			});
		} else {
			found.push({ kind: "document", id: source?.id, ...(title === undefined ? {} : { title }), ...cited, span });
		}
	}
	return found;
}

/**
 * Convert a (non-streaming) Cohere reply to a Chat Completions `chat.completion`: text blocks are joined into the content, `thinking` blocks go
 * in the settings' reasoning field, `tool_calls` become tool calls, `finish_reason` becomes `finish_reason`, `usage` becomes `usage` and `logprobs`
 * become `choices[0].logprobs`. The `tool_plan` (the sentence the model writes before a tool call) is the start of the content, and `citations`
 * are `annotations` (neutral citations, see `lib/citations.mjs`) spanning the text they cite. A citation of the model's thinking has no place in
 * Chat Completions, so it is written into the reasoning text as `[n]` markers at the cited spans, followed by a list of the sources.
 * @param {any} reply - Parsed Cohere reply.
 * @param {{ reasoningField?: string, model?: string, state?: any }} [options] - `reasoningField` is where the reasoning goes (default `reasoning`); `model` is the model name on the completion; `state` is the conversion state (`documents`, `tools`, `singleCall`).
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
	const list = Array.isArray(message.tool_calls) ? message.tool_calls : [];
	const calls = (options.state?.singleCall ? list.slice(0, 1) : list).map((call) => ({
		id: call?.id,
		type: "function",
		function: { name: call?.function?.name, arguments: call?.function?.arguments ?? "{}" }
	}));
	// Where each content block's text starts among the text blocks (a thinking block has no text in the content).
	const starts = [];
	let length = 0;
	for (const block of blocks) {
		starts.push(length);
		if (block?.type === "text") length += block.text.length;
	}
	const plan = typeof message.tool_plan === "string" ? message.tool_plan : "";
	const body = blocks.map((block) => (block?.type === "text" ? block.text : "")).join("");
	const lead = plan === "" ? 0 : plan.length + (body === "" ? 0 : PLAN_BREAK.length);
	const out = /** @type {any} */ ({ role: "assistant", content: plan === "" ? body : plan + (body === "" ? "" : PLAN_BREAK) + body });
	// A citation of the model's thinking becomes `[n]` markers in the thinking text and a list of the sources at its end (no protocol has citations on reasoning).
	const marks = newMarks();
	const thoughts = Array.isArray(message.citations) ? message.citations.filter((citation) => citation?.type === "THINKING_CONTENT") : [];
	const reasoning =
		blocks
			.map((block, at) =>
				block?.type === "thinking"
					? markPiece(
							block.thinking,
							thoughts
								.filter((citation) => (citation.content_index ?? 0) === at)
								.map((citation) => ({ end: citation.end, sources: Array.isArray(citation.sources) ? citation.sources : [] })),
							marks,
							options.state
						)
					: ""
			)
			.join("") + marks.list();
	if (reasoning !== "") out[options.reasoningField ?? "reasoning"] = reasoning;
	if (calls.length > 0) out.tool_calls = calls;
	const cited = [];
	for (const citation of Array.isArray(message.citations) ? message.citations : []) {
		if (citation?.type === "PLAN") cited.push(...citationsOf(citation, 0, options.state));
		else if (citation?.type !== "THINKING_CONTENT")
			cited.push(...citationsOf(citation, lead + (starts[citation?.content_index ?? 0] ?? 0), options.state));
	}
	if (cited.length > 0) out.annotations = cited.map((citation) => toAnnotation(citation));
	const usage = usageOf(reply.usage);
	const entries = Array.isArray(reply.logprobs) ? logprobsOf(reply.logprobs) : [];
	return {
		id: completionId(),
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model: options.model,
		choices: [
			{
				index: 0,
				message: out,
				...(entries.length > 0 ? { logprobs: { content: entries } } : {}),
				finish_reason: finishOf(reply.finish_reason, calls.length > 0)
			}
		],
		...(usage === undefined ? {} : { usage })
	};
}

/**
 * Create the converter of a Cohere stream's events into Chat Completions chunks. One chunker is for one reply: it keeps the completion id (so
 * every chunk carries the same one), whether any tool was called and how much text has been sent (citations count from it). When the request could get
 * citations (`state.cites`) each thinking block is held until its `content-end`, and the citations of its text (`THINKING_CONTENT`) are written into it as `[n]` markers,
 * followed by the list of sources before the next thing that is not thinking. The `tool-plan-delta`
 * events are content text (a blank line separates the plan from content that follows it), `citation-start` events are `annotations` chunks,
 * `content-delta` log probabilities are `logprobs`, and the `debug` events are not carried over.
 * @param {{ model?: string, reasoningField?: string, includeUsage?: boolean, state?: any }} [options] - `model` is the model name on the chunks; `reasoningField` is where the reasoning goes (default `reasoning`); `includeUsage` (default true) adds the final usage chunk; `state` is the conversion state (`documents`, `tools`, `singleCall`).
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
	// Characters of content sent, where the tool plan and each content block started in them, and whether the plan was followed by text.
	let length = 0;
	let planAt = null;
	let planned = false;
	const starts = new Map();
	// With citations possible, each thinking block is held until it ends so its citations can be written into it as markers.
	const hold = options.state?.cites === true;
	const held = new Map();
	const marks = newMarks();
	let listed = false;
	const make = (delta, finish = null, extra = {}) => ({
		id,
		object: "chat.completion.chunk",
		created,
		model: options.model,
		choices: [{ index: 0, delta, finish_reason: finish, ...extra }]
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
	const text = (value, extra = {}) => {
		length += value.length;
		return [...first(), make({ content: value }, null, extra)];
	};
	const release = (index) => {
		const block = held.get(index);
		held.delete(index);
		const marked = block === undefined ? "" : markPiece(block.text, block.cites, marks, options.state);
		return marked === "" ? [] : [...first(), make({ [field]: marked })];
	};
	// Before anything that follows thinking: the blocks still held, then the source list (once).
	const settle = () => {
		const out = [...held.keys()].flatMap((index) => release(index));
		const list = marks.list();
		if (list !== "" && !listed) {
			listed = true;
			out.push(...first(), make({ [field]: list }));
		}
		return out;
	};
	return {
		event(name, data) {
			const type = data?.type ?? name;
			if (type === "content-end") return release(data.index);
			if (type === "content-delta") {
				const content = data?.delta?.message?.content;
				const extra = data?.logprobs === undefined ? {} : { logprobs: { content: logprobsOf(data.logprobs) } };
				if (typeof content?.text === "string" && content.text !== "") {
					// Text after a tool plan starts a new paragraph.
					const before = settle();
					const lead = planned && !starts.has(data.index) ? PLAN_BREAK : "";
					if (!starts.has(data.index)) starts.set(data.index, length + lead.length);
					return [...before, ...text(lead + content.text, extra)];
				}
				if (typeof content?.thinking === "string" && content.thinking !== "") {
					if (!hold) return [...first(), make({ [field]: content.thinking }, null, extra)];
					if (!held.has(data.index)) held.set(data.index, { text: "", cites: [] });
					held.get(data.index).text += content.thinking;
					return [];
				}
				return [];
			}
			if (type === "tool-plan-delta") {
				const plan = data?.delta?.message?.tool_plan;
				if (typeof plan !== "string" || plan === "") return [];
				const before = settle();
				planAt ??= length;
				planned = true;
				return [...before, ...text(plan)];
			}
			if (type === "citation-start") {
				const citation = data?.delta?.message?.citations;
				if (citation === undefined) return [];
				if (citation.type === "THINKING_CONTENT") {
					held.get(data.index)?.cites.push({ end: citation.end, sources: Array.isArray(citation.sources) ? citation.sources : [] });
					return [];
				}
				const base = citation.type === "PLAN" ? (planAt ?? 0) : (starts.get(data.index) ?? length);
				const found = citationsOf(citation, base, options.state);
				return found.length === 0 ? [] : [...first(), make({ annotations: found.map((entry) => toAnnotation(entry)) })];
			}
			if (type === "tool-call-start" || type === "tool-call-delta") {
				// With `parallel_tool_calls: false` only the first call goes on (Cohere has no such field).
				if (options.state?.singleCall && data.index > 0) return [];
				if (type === "tool-call-delta") {
					const args = data?.delta?.message?.tool_calls?.function?.arguments;
					if (typeof args !== "string" || args === "") return [];
					return [...first(), make({ tool_calls: [{ index: data.index, function: { arguments: args } }] })];
				}
				const call = data?.delta?.message?.tool_calls;
				calls += 1;
				const entry = { index: data.index, id: call?.id, type: "function", function: { name: call?.function?.name, arguments: "" } };
				return [...settle(), ...first(), make({ tool_calls: [entry] })];
			}
			if (type === "message-end") {
				const failure = failureOf(data?.delta?.finish_reason, data?.delta?.error);
				if (failure !== null) return fail(failure);
				finished = true;
				usage = data?.delta?.usage;
				const counted = usageOf(usage);
				const out = [...settle(), ...first(), make({}, finishOf(data?.delta?.finish_reason, calls > 0))];
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

/**
 * The text of a request body that the model reads, for a tokenizer: system, user, assistant and tool message text, reasoning, tool plans, tool
 * call names and arguments, tool definitions and documents. It reads a Cohere body and a Chat Completions body alike.
 * @param {any} body - Request body.
 * @returns {string[]} The pieces of text, in order.
 */
export function promptText(body) {
	const out = [];
	const add = (value) => {
		if (typeof value === "string" && value !== "") out.push(value);
	};
	const content = (value) => {
		if (typeof value === "string") add(value);
		else {
			for (const part of Array.isArray(value) ? value : []) {
				add(part?.text);
				add(part?.thinking);
				if (part?.document !== undefined) add(JSON.stringify(part.document.data ?? part.document));
			}
		}
	};
	for (const message of Array.isArray(body?.messages) ? body.messages : []) {
		content(message?.content);
		add(message?.tool_plan);
		add(reasoningOf(message));
		for (const call of Array.isArray(message?.tool_calls) ? message.tool_calls : []) {
			add(call?.function?.name);
			add(call?.function?.arguments);
		}
	}
	for (const tool of Array.isArray(body?.tools) ? body.tools : []) add(JSON.stringify(tool?.function ?? tool));
	for (const document of Array.isArray(body?.documents) ? body.documents : [])
		add(typeof document === "string" ? document : JSON.stringify(document?.data ?? document));
	return out;
}

/**
 * Cut a text into pieces of at most `size` characters, never between the two halves of a surrogate pair.
 * @param {string} text - The text.
 * @param {number} size - Most characters in a piece.
 * @returns {string[]} The pieces (none for an empty text).
 */
export function chunksOf(text, size) {
	const out = [];
	for (let at = 0; at < text.length;) {
		let end = Math.min(at + size, text.length);
		// A high surrogate at the end belongs with the low one after it.
		if (end < text.length && text.charCodeAt(end - 1) >= 0xd800 && text.charCodeAt(end - 1) <= 0xdbff) end--;
		out.push(text.slice(at, end));
		at = end;
	}
	return out;
}

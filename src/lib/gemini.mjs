/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/gemini.mjs
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
 * @fileoverview Google Gemini's native `generateContent` API as Chat Completions: the request body, the reply and the streamed chunks are translated to and from the Chat Completions shapes the converters already know. Written to be shared by every upstream that speaks this API (the Gemini API and Vertex AI).
 * @module @cldmv/llm-translator/lib/gemini
 */
import { TranslatorError } from "./errors.mjs";
import { callId, completionId } from "./ids.mjs";
import { parseArguments } from "./arguments.mjs";
import { reasoningOf } from "./thinking.mjs";
import { gemini as schemaOf } from "./gemini-schema.mjs";
import { FORMATS as ENCODED, encode } from "./gemini-audio.mjs";
import { ACTIONS, converter, ids } from "./gemini-computer.mjs";

/** `format` of the `reasoning_details` items that carry a Gemini `thoughtSignature` (`data`) and the part it belongs to (`for`: `text`, `thought` or `call`, with the tool call `id` for a call, and `rest` for text and thought: the characters of the text that follow the part). */
export const FORMAT = "google-gemini-v1";

/** The `thoughtSignature` Google documents for a function call part that has no real signature (history written by another model, or a client that dropped them). */
export const SKIP_SIGNATURE = "skip_thought_signature_validator";

/** Chat Completions fields the body conversion reads. */
const HANDLED = new Set([
	"model",
	"messages",
	"stream",
	"tools",
	"tool_choice",
	"parallel_tool_calls",
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
	"reasoning_effort",
	"logprobs",
	"top_logprobs",
	"modalities",
	"audio"
]);

/** Chat Completions fields that mean nothing to Gemini and are not worth a mention when they are left out. */
const SILENT = new Set(["stream_options", "user", "metadata", "store", "service_tier"]);

/** Every field the conversion reads or ignores on purpose. */
const KNOWN = new Set([...HANDLED, ...SILENT]);

/** Image types Gemini reads inline, as the MIME types a data URL names. GIF is turned into PNG before the body is built. */
const IMAGES = new Set(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);

/** Text that stands in for an image Gemini cannot be given. */
const IMAGE_NOTE =
	"[An image was omitted because Gemini cannot read it: it has to be a base64 PNG, JPEG, GIF, WebP, HEIC or HEIF image, or an http(s) or gs URL of a type Gemini reads (a GIF at a URL needs the documentUrls setting).]";

/** Text of a tool result that has none: Gemini wants a response object with something in it. */
const NO_OUTPUT = "(no output)";

/** The thinking budget (tokens) sent for each reasoning effort on a model that takes a budget. */
const BUDGETS = { minimal: 512, low: 1024, medium: 8192, high: 24576, xhigh: 24576, max: 24576 };

/** The thinking levels of Gemini 3 and later models, lowest first, and the level each effort name asks for. */
const LEVELS = ["MINIMAL", "LOW", "MEDIUM", "HIGH", "XHIGH"];
const EFFORT_LEVEL = { minimal: 0, low: 1, medium: 2, high: 3, xhigh: 4, max: 4 };

/** File types read from an http(s) or gs URL, by extension. GIF is not here: Gemini does not read it. */
const TYPES = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	heic: "image/heic",
	heif: "image/heif",
	bmp: "image/bmp",
	pdf: "application/pdf",
	txt: "text/plain",
	html: "text/html",
	csv: "text/csv",
	json: "application/json",
	mp3: "audio/mp3",
	wav: "audio/wav",
	aac: "audio/aac",
	flac: "audio/flac",
	ogg: "audio/ogg",
	mp4: "video/mp4",
	webm: "video/webm",
	mov: "video/quicktime"
};

/** The MIME type of each audio format an OpenAI `input_audio` part names. */
const AUDIO = {
	wav: "audio/wav",
	mp3: "audio/mp3",
	aiff: "audio/aiff",
	aac: "audio/aac",
	ogg: "audio/ogg",
	flac: "audio/flac",
	m4a: "audio/aac"
};

/** Gemini's name for each output modality OpenAI names. */
const MODALITIES = { text: "TEXT", audio: "AUDIO", image: "IMAGE" };

/** Audio formats a reply can be returned in: Gemini answers with raw 16-bit PCM, which is wrapped in a WAV header, returned as it is, or encoded (`lib/gemini-audio`). */
const AUDIO_FORMATS = new Set(["wav", "pcm16", "pcm", ...ENCODED]);

/** Chat Completions `finish_reason` for each Gemini `finishReason`. A reason that is not here is not an answer to show as a failure: see `finishOf`. */
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

/** Most candidates one request asks for (Gemini's own limit); more are answered by fan-out. */
export const MAX_CANDIDATES = 8;

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
	for (const field of ["systemInstruction", "tools", "toolConfig", "cachedContent"])
		if (request[field] !== undefined) out[field] = request[field];
	return { generateContentRequest: out };
}

/**
 * A reference to a file at a URL, as a `fileData` part: an http(s) URL (a public one, a signed one, a Files API URI, a YouTube video) or a
 * Cloud Storage `gs://` URI. The type is the given one, else the one the extension names, else the fallback; a Files API URI and a YouTube URL
 * need none. A GIF (Gemini does not read it) and any other kind of URL are not references.
 * @param {string} url - The URL.
 * @param {string | undefined} mime - The MIME type the caller knows.
 * @param {string | undefined} fallback - The type to assume when there is none.
 * @returns {any | null} The part, or null when Gemini cannot be given the URL.
 */
function reference(url, mime, fallback) {
	const match = /^(?:https?|gs):\/\/[^?#]*/i.exec(url);
	if (match === null) return null;
	const extension = /\.([a-z0-9]+)$/i.exec(match[0])?.[1]?.toLowerCase();
	if (extension === "gif" || mime === "image/gif") return null;
	const known = /^https:\/\/(?:generativelanguage\.googleapis\.com\/v1beta\/files\/|(?:www\.)?youtube\.com\/|youtu\.be\/)/i.test(url);
	const type = mime ?? (extension === undefined ? undefined : TYPES[extension]) ?? (known ? undefined : fallback);
	return { fileData: { fileUri: url, ...(type === undefined ? {} : { mimeType: type }) } };
}

/**
 * The Gemini parts of a Chat Completions message content: text parts (an empty one is left out), images and PDFs from base64 data URLs and
 * references to files at URLs (an `image_url` part may carry a PDF or another file: that is how the Anthropic converter hands one over),
 * files from base64 data URLs or by reference, and audio.
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
			const url = String(part.image_url?.url ?? part.image_url ?? "");
			const match = /^data:([^;,]+);base64,(.*)$/s.exec(url);
			const sent = match
				? IMAGES.has(match[1]) || match[1] === "application/pdf"
					? { inlineData: { mimeType: match[1], data: match[2] } }
					: null
				: reference(url, part.image_url?.mime_type, "image/jpeg");
			if (sent === null) {
				out.push({ text: IMAGE_NOTE });
				drop(dropped, "image_url");
			} else out.push(sent);
		} else if (part?.type === "file") {
			const match = /^data:([^;,]+);base64,(.*)$/s.exec(String(part.file?.file_data ?? ""));
			const sent = match
				? { inlineData: { mimeType: match[1], data: match[2] } }
				: reference(String(part.file?.file_id ?? ""), undefined, undefined);
			if (sent === null) drop(dropped, "content.file");
			else out.push(sent);
		} else if (part?.type === "input_audio" && typeof part.input_audio?.data === "string" && part.input_audio.data !== "") {
			const format = String(part.input_audio.format ?? "wav").toLowerCase();
			out.push({ inlineData: { mimeType: AUDIO[format] ?? `audio/${format}`, data: part.input_audio.data } });
		} else drop(dropped, `content.${part?.type ?? "part"}`);
	}
	return out;
}

/**
 * The thought signatures an assistant message carries: the `reasoning_details` items in this protocol's format (anything else is ignored).
 * @param {any} details - `reasoning_details` of the message.
 * @returns {{ text: {data: string, rest: number}[], thought: {data: string, rest: number}[], legacy: string | undefined, calls: Map<string, string> }} The signatures of the text and of the thought (each with how much text follows the part), a signature of the text that says no position (the last text part gets it), and the signature of each tool call by its id.
 */
function signaturesOf(details) {
	const out = { text: [], thought: [], legacy: undefined, calls: new Map() };
	for (const item of Array.isArray(details) ? details : []) {
		if (item?.format !== FORMAT || typeof item.data !== "string" || item.data === "") continue;
		const placed = Number.isInteger(item.rest) && item.rest >= 0;
		if (item.for === "call" && typeof item.id === "string") out.calls.set(item.id, item.data);
		else if (item.for === "thought" && placed) out.thought.push({ data: item.data, rest: item.rest });
		else if (item.for === "text") {
			if (placed) out.text.push({ data: item.data, rest: item.rest });
			else out.legacy = item.data;
		}
	}
	return out;
}

/**
 * Cut a text where its signed parts ended: the end of a part is the length of the text less the characters that followed it. The part after the
 * last signed one has no signature.
 * @param {string} text - The whole text.
 * @param {{data: string, rest: number}[]} marks - The signatures with their `rest`.
 * @returns {{text: string, signature?: string}[]} The parts, in order; a signed part may be empty.
 */
function cut(text, marks) {
	const ordered = marks.map((mark) => ({ ...mark, end: Math.max(0, text.length - mark.rest) })).sort((left, right) => left.end - right.end);
	const out = [];
	let at = 0;
	for (const mark of ordered) {
		const end = Math.max(at, mark.end);
		out.push({ text: text.slice(at, end), signature: mark.data });
		at = end;
	}
	if (at < text.length) out.push({ text: text.slice(at) });
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
 * The parts of an assistant message: the thought parts that carry a signature, the text (cut where its signed parts ended), and the function
 * calls, each with its signature. The first call of a turn that has no signature gets Google's placeholder (see `conversationOf`).
 * @param {any} message - Chat Completions assistant message.
 * @param {string[]} dropped - Collects what was left out.
 * @param {boolean} plain - Write tool calls as text.
 * @param {Map<string, string>} names - Tool names by call id, filled here.
 * @returns {any[]} Parts.
 */
function assistantParts(message, dropped, plain, names) {
	const signatures = signaturesOf(message.reasoning_details);
	const found = partsOf(message.content, dropped);
	const parts = [];
	const thought = reasoningOf(message);
	if (thought !== "") {
		const signed = cut(thought, signatures.thought).filter((entry) => entry.signature !== undefined);
		for (const entry of signed) parts.push({ text: entry.text, thought: true, thoughtSignature: entry.signature });
		if (signed.length === 0 && signatures.text.length === 0 && signatures.legacy === undefined && signatures.calls.size === 0)
			drop(dropped, "reasoning");
	}
	const texts = found.filter((part) => part.text !== undefined);
	const others = found.filter((part) => part.text === undefined);
	if (signatures.text.length > 0 && texts.length > 0) {
		for (const entry of cut(texts.map((part) => part.text).join(""), signatures.text)) {
			parts.push({ text: entry.text, ...(entry.signature === undefined ? {} : { thoughtSignature: entry.signature }) });
		}
	} else {
		parts.push(...texts);
		const last = [...parts].reverse().find((part) => part.thought === undefined && part.text !== undefined);
		if (signatures.legacy !== undefined && last) last.thoughtSignature = signatures.legacy;
	}
	parts.push(...others);
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
	return parts;
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
 * @param {Map<string, {mimeType: string, data: string}>} [shots] - Screenshots to send as the parts of the function response of the call with that id (computer use).
 * @returns {{contents: any[], system: any[]}} Gemini contents and system parts.
 */
function conversationOf(list, dropped, marker, plain, shots) {
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
			const shot = shots?.get(message.tool_call_id);
			if (shot !== undefined) result.parts = [{ inlineData: { mimeType: shot.mimeType, data: shot.data } }];
			parts = [plain ? { text: textOfResult(result) } : { functionResponse: result }, ...found.filter((part) => part.text === undefined)];
		} else if (message?.role === "user") parts = partsOf(message.content, dropped);
		else if (message?.role === "assistant") {
			role = "model";
			parts = assistantParts(message, dropped, plain, names);
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
 * The 2.5 model family of a model id, for the range of its thinking budget.
 * @param {unknown} model - Model id as sent upstream, with or without the `models/` prefix.
 * @returns {{min: number, max: number} | null} The smallest and largest budget (a request for less than `min` is raised to it: Pro cannot switch thinking off, Flash-Lite thinks in at least 512 tokens), or null for another model.
 */
function rangeOf(model) {
	const match = /^(?:models\/)?gemini-2\.5-(pro|flash-lite|flash)(?:$|[-@])/.exec(String(model));
	if (match === null) return null;
	return match[1] === "pro" ? { min: 128, max: 32768 } : match[1] === "flash-lite" ? { min: 512, max: 24576 } : { min: 0, max: 24576 };
}

/**
 * The thinking levels a model takes. Gemini 3 and later models take levels (`thinkingLevel`) and Gemini 2.5 and earlier take a token budget.
 * @param {unknown} model - Model id as sent upstream, with or without the `models/` prefix.
 * @param {"auto" | "level" | "budget"} control - The `gemini.thinking` setting: `auto` decides from the model id, `level` and `budget` say what a model that is not recognized takes.
 * @returns {number[] | null} Indexes into `LEVELS`, or null for a model that takes a budget. Gemini 4 has no `MINIMAL` and adds `XHIGH`, `gemini-3-pro` has `LOW` and `HIGH` only, other Pro models no `MINIMAL`, and the Gemini 3 Flash models the four lower levels.
 */
function levelsOf(model, control) {
	const match = /^(?:models\/)?gemini-(\d+)(?:\.\d+)?-([a-z]+)/.exec(String(model));
	if (control === "budget") return null;
	if (match === null) return control === "level" ? [0, 1, 2, 3] : null;
	if (Number(match[1]) < 3) return control === "level" ? [0, 1, 2, 3] : null;
	if (Number(match[1]) >= 4) return [1, 2, 3, 4];
	if (match[2] === "pro") return /^(?:models\/)?gemini-3-pro/.test(String(model)) ? [1, 3] : [1, 2, 3];
	return [0, 1, 2, 3];
}

/**
 * The `thinkingConfig` for a request. A model that takes a budget gets the explicit one, or one per effort (`BUDGETS`; `none` is a zero
 * budget), kept inside the range of its family; a dynamic budget (`-1`) is asked for with `dynamic`. A model that takes levels gets the level of
 * the effort (a budget counts as the effort it is closest to), moved to the nearest level the model has; `none` is the lowest level, because
 * these models cannot switch thinking off, and sending a budget to them is refused or deprecated, and dynamic is the model's own default. Thought
 * summaries are asked for whenever thinking is on.
 * @param {any} effort - Chat Completions `reasoning_effort`.
 * @param {{budget?: number, dynamic?: boolean, model?: unknown, control?: "auto" | "level" | "budget"}} spec - The explicit budget, whether the client asked for dynamic thinking, the model sent upstream and the `gemini.thinking` setting.
 * @param {string[]} dropped - Collects what was left out.
 * @returns {any} `thinkingConfig`, or undefined when the request does not ask for any.
 */
function thinkingOf(effort, { budget, dynamic: asked, model, control = "auto" }, dropped) {
	let dynamic = asked;
	const levels = levelsOf(model, control);
	const range = rangeOf(model);
	// `reasoning_effort: "dynamic"` (not an OpenAI value) asks for the model to decide, as Anthropic's `adaptive` does.
	if (effort === "dynamic") dynamic = true;
	const sized = (tokens) => (range === null ? tokens : tokens === 0 ? range.min : Math.min(range.max, Math.max(range.min, tokens)));
	if (levels === null) {
		if (dynamic === true) return { includeThoughts: true, thinkingBudget: -1 };
		if (budget !== undefined) return { includeThoughts: true, thinkingBudget: sized(budget) };
		if (effort === undefined || effort === null) return undefined;
		if (effort === "none") return range !== null && range.min > 0 ? { thinkingBudget: range.min } : { thinkingBudget: 0 };
		if (Object.hasOwn(BUDGETS, effort)) return { includeThoughts: true, thinkingBudget: sized(BUDGETS[effort]) };
	} else {
		let want;
		if (dynamic === true) return { includeThoughts: true };
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
 * The tool names an OpenAI `allowed_tools` choice lists.
 * @param {any} choice - `tool_choice`.
 * @returns {{mode: string, names: string[]} | null} The mode and the names, or null when it is not an `allowed_tools` choice.
 */
function allowedOf(choice) {
	if (choice?.type !== "allowed_tools") return null;
	const entries = Array.isArray(choice.allowed_tools?.tools) ? choice.allowed_tools.tools : [];
	return {
		mode: choice.allowed_tools?.mode === "required" ? "required" : "auto",
		names: entries.map((entry) => entry?.function?.name).filter((name) => typeof name === "string")
	};
}

/**
 * The tools and the calling mode of a request: the function declarations (each schema as Gemini takes it), the built-in tools the request or the
 * upstream names, and `tool_choice` as `functionCallingConfig`: `required` and a named function are `ANY` (the latter with `allowedFunctionNames`),
 * `none` is `NONE`, and an OpenAI `allowed_tools` choice is `ANY` with the names when its mode is `required`, and otherwise `AUTO` over only the
 * tools it lists.
 * @param {any} body - Chat Completions body.
 * @param {any[]} builtin - Built-in tools to add (`{ googleSearch: {} }`).
 * @param {string[]} dropped - Collects what was left out.
 * @returns {{tools?: any[], toolConfig?: any}} The `tools` and `toolConfig` fields.
 */
function toolsOf(body, builtin, dropped) {
	const out = {};
	const offered = Array.isArray(body.tools) && body.tools.length > 0;
	const allowed = allowedOf(body.tool_choice);
	const listed = offered
		? allowed !== null && allowed.mode === "auto"
			? body.tools.filter((tool) => allowed.names.includes(tool.function?.name))
			: body.tools
		: [];
	const tools = [];
	if (listed.length > 0) {
		tools.push({
			functionDeclarations: listed.map((tool) => {
				const schema = tool.function?.parameters;
				const empty = schema?.type === "object" && Object.keys(schema.properties ?? {}).length === 0;
				return {
					name: tool.function?.name,
					...(tool.function?.description === undefined ? {} : { description: tool.function.description }),
					...(schema === undefined || schema === null || empty ? {} : { parametersJsonSchema: schemaOf(schema) })
				};
			})
		});
	}
	tools.push(...builtin);
	if (tools.length > 0) out.tools = tools;
	if (offered) {
		const choice = body.tool_choice;
		if (choice === "required") out.toolConfig = { functionCallingConfig: { mode: "ANY" } };
		else if (choice === "none") out.toolConfig = { functionCallingConfig: { mode: "NONE" } };
		else if (choice?.type === "function")
			out.toolConfig = { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [choice.function?.name] } };
		else if (allowed !== null) {
			if (allowed.mode === "required") out.toolConfig = { functionCallingConfig: { mode: "ANY", allowedFunctionNames: allowed.names } };
		} else if (choice !== undefined && choice !== "auto") drop(dropped, "tool_choice");
	}
	return out;
}

/**
 * Convert a Chat Completions request body to a `generateContent` body (`contents`, `systemInstruction`, `generationConfig`, `tools`, `toolConfig`,
 * `safetySettings` and `cachedContent`; the model and the choice of streaming belong to the URL, so neither is in the body). `max_tokens`,
 * `temperature`, `top_p`, `top_k`, `stop`, `seed`, the penalties and `n` become `generationConfig` fields, `response_format` becomes
 * `responseMimeType` with `responseJsonSchema`, tools become function declarations with their JSON Schema as `parametersJsonSchema`,
 * `tool_choice` becomes the calling mode, images, files and audio are sent as bytes or as references to files at URLs, `reasoning_effort`
 * or a thinking budget becomes `thinkingConfig`, `logprobs` and `top_logprobs` become `responseLogprobs` and `logprobs`, and `modalities` and `audio` become
 * `responseModalities` and `speechConfig`. What Gemini has no field for (`logit_bias`, reasoning text in history that has no signature, ...) is left out and named
 * in `dropped`. A request without tools has its past tool calls and results written as text.
 * @param {any} body - Chat Completions request body.
 * @param {{ dropped?: string[], sampling?: Record<string, any>, thinkingBudget?: number, thinkingDynamic?: boolean, marker?: string, model?: string, gemini?: any, computer?: {images: Map<string, {mimeType: string, data: string}>} }} [context] - `computer` is set for a request that uses the computer tool: its history is function calls even when no function tool is declared, and `images` are the screenshots of the results;  `model` is the model the request goes to (default: the body's `model`), which decides between a thinking budget and a level; `dropped` collects the names of what was left out; `sampling` are extension fields for `generationConfig`; `thinkingBudget` is the token budget of enabled thinking and `thinkingDynamic` says the client asked for the model to decide; `marker` is the text that marks a failed tool result; `gemini` is the `gemini` setting (safety settings, built-in tools, a cached content, output modalities and the thinking control) with `builtin`, the built-in tools the request itself asked for.
 * @returns {any} `generateContent` request body.
 * @throws {TranslatorError} `invalid_request` for an audio output format Gemini cannot produce.
 */
export function chatBody(body, context = {}) {
	const dropped = context.dropped ?? [];
	const setting = context.gemini ?? {};
	const offered = (Array.isArray(body.tools) && body.tools.length > 0) || context.computer !== undefined;
	const { contents, system } = conversationOf(
		Array.isArray(body.messages) ? body.messages : [],
		dropped,
		context.marker,
		!offered,
		context.computer?.images
	);
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
		if (format.json_schema?.schema !== undefined) config.responseJsonSchema = schemaOf(format.json_schema.schema);
	} else if (format !== undefined && format !== null && format.type !== "text") drop(dropped, "response_format");
	const model = context.model ?? body.model;
	const thinking = thinkingOf(
		body.reasoning_effort,
		{ budget: context.thinkingBudget, dynamic: context.thinkingDynamic, model, control: setting.thinking },
		dropped
	);
	if (thinking !== undefined) config.thinkingConfig = thinking;
	if (body.logprobs === true) {
		config.responseLogprobs = true;
		if (Number.isInteger(body.top_logprobs)) config.logprobs = Math.min(20, Math.max(0, body.top_logprobs));
	} else if (body.logprobs !== undefined && body.logprobs !== null && body.logprobs !== false) drop(dropped, "logprobs");
	if (Array.isArray(setting.responseModalities)) config.responseModalities = setting.responseModalities;
	else if (/-image(?:$|[-@])/.test(String(model))) config.responseModalities = ["TEXT", "IMAGE"];
	if (Array.isArray(body.modalities)) {
		const asked = body.modalities.map((name) => MODALITIES[name]).filter((name) => name !== undefined);
		if (asked.length !== body.modalities.length) drop(dropped, "modalities");
		if (asked.length > 0) config.responseModalities = asked;
	}
	if (setting.imageConfig !== undefined) config.imageConfig = setting.imageConfig;
	if (setting.speechConfig !== undefined) config.speechConfig = setting.speechConfig;
	if (setting.mediaResolution !== undefined) config.mediaResolution = setting.mediaResolution;
	if (body.audio !== undefined && body.audio !== null) {
		const wanted = String(body.audio.format ?? "wav").toLowerCase();
		if (!AUDIO_FORMATS.has(wanted)) {
			throw new TranslatorError(
				`audio.format: Gemini returns raw PCM audio, which can be given as "wav", "pcm16", "mp3", "opus" or "flac", not "${wanted}"`,
				{
					code: "invalid_request",
					param: "audio.format"
				}
			);
		}
		if (typeof body.audio.voice === "string" && body.audio.voice !== "") {
			config.speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: body.audio.voice } } };
		}
		if (!Array.isArray(body.modalities) && config.responseModalities === undefined) config.responseModalities = ["AUDIO"];
	}
	if (Object.keys(config).length > 0) out.generationConfig = config;
	Object.assign(out, toolsOf(body, [...(setting.tools ?? []), ...(setting.builtin ?? [])], dropped));
	if (Array.isArray(setting.safetySettings) && setting.safetySettings.length > 0) out.safetySettings = setting.safetySettings;
	if (typeof setting.cachedContent === "string") {
		// A request that names a cached content must not carry what the cache holds.
		out.cachedContent = setting.cachedContent;
		for (const field of ["systemInstruction", "tools", "toolConfig"]) {
			if (out[field] !== undefined) {
				delete out[field];
				drop(dropped, field);
			}
		}
	}
	for (const key of Object.keys(body)) {
		if (!KNOWN.has(key)) drop(dropped, key);
	}
	return out;
}

/**
 * Chat Completions `finish_reason` for a Gemini `finishReason`: `STOP` is `stop`, `MAX_TOKENS` is `length`, the safety, recitation, blocklist,
 * prohibited content, SPII and image safety reasons are `content_filter`, and every other reason (a malformed function call, a missing thought
 * signature, `OTHER`, one this table does not know) is `stop`: the reply ends there, with the text and the calls it has and a note saying why
 * (see `noteOf`). A reply that called tools is `tool_calls`.
 * @param {string | undefined} reason - Gemini `finishReason`.
 * @param {boolean} calls - Whether the reply carried tool calls.
 * @returns {string} `finish_reason`.
 */
export function finishOf(reason, calls) {
	const finish = reason !== undefined && Object.hasOwn(FINISH, reason) ? FINISH[reason] : "stop";
	return calls && finish === "stop" ? "tool_calls" : finish;
}

/**
 * The note that goes at the end of a reply whose `finishReason` is neither a normal end nor a cut-off nor a filter: Gemini's own explanation
 * (`finishMessage`), or the reason alone.
 * @param {any} candidate - Gemini candidate.
 * @returns {string} The note, or an empty string for a reply that ended normally.
 */
function noteOf(candidate) {
	const reason = candidate?.finishReason;
	if (reason === undefined || Object.hasOwn(FINISH, reason)) return "";
	const message = typeof candidate.finishMessage === "string" && candidate.finishMessage !== "" ? `: ${candidate.finishMessage}` : "";
	return `[Gemini ended the reply early (${reason})${message}]`;
}

/**
 * Chat Completions usage from a Gemini `usageMetadata`. Gemini counts cached tokens inside `promptTokenCount` and thinking tokens apart from
 * `candidatesTokenCount`; the completion is both, and tokens of tool use prompts count as prompt.
 * When the request created a cached content, the tokens it wrote are `prompt_tokens_details.cache_write_tokens` (the name OpenRouter uses; OpenAI has none) and are taken out of the cached count, because Gemini reads back what it just wrote.
 * @param {any} meta - Gemini `usageMetadata`.
 * @param {number} [created] - Tokens written to a cached content by this request.
 * @returns {{prompt_tokens: number, completion_tokens: number, total_tokens: number, prompt_tokens_details?: {cached_tokens?: number, cache_write_tokens?: number}, completion_tokens_details?: {reasoning_tokens: number}} | undefined} Usage, or undefined when there are no counts.
 */
export function usageOf(meta, created) {
	if (!Number.isFinite(meta?.promptTokenCount) && !Number.isFinite(meta?.candidatesTokenCount)) return undefined;
	const count = (value) => (Number.isFinite(value) ? value : 0);
	const prompt = count(meta.promptTokenCount) + count(meta.toolUsePromptTokenCount);
	const thoughts = count(meta.thoughtsTokenCount);
	const completion = count(meta.candidatesTokenCount) + thoughts;
	const written = count(created);
	const cached = Math.max(0, count(meta.cachedContentTokenCount) - written);
	return {
		prompt_tokens: prompt,
		completion_tokens: completion,
		total_tokens: prompt + completion,
		...(cached > 0 || written > 0
			? {
					prompt_tokens_details: {
						...(cached > 0 ? { cached_tokens: cached } : {}),
						...(written > 0 ? { cache_write_tokens: written } : {})
					}
				}
			: {}),
		...(thoughts > 0 ? { completion_tokens_details: { reasoning_tokens: thoughts } } : {})
	};
}

/**
 * The same counts as Anthropic usage, which is what the OpenAI front's usage report reads from a converted reply (cached tokens are not in `input_tokens`).
 * @param {any} meta - Gemini `usageMetadata`.
 * @param {number} [created] - Tokens written to a cached content by this request.
 * @returns {{input_tokens: number, output_tokens: number, cache_read_input_tokens: number, cache_creation_input_tokens: number} | undefined} Anthropic usage, or undefined when there are no counts.
 */
export function folded(meta, created) {
	const usage = usageOf(meta, created);
	if (usage === undefined) return undefined;
	const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
	const written = usage.prompt_tokens_details?.cache_write_tokens ?? 0;
	return {
		input_tokens: usage.prompt_tokens - cached - written,
		output_tokens: usage.completion_tokens,
		cache_read_input_tokens: cached,
		cache_creation_input_tokens: written
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
 * @param {{for: "text" | "thought" | "call", id?: string, rest?: number}} place - The part it belongs to: a call (with its id), or the text or the thought (with the characters that follow the part).
 * @returns {any} The item.
 */
function detailOf(index, signature, place) {
	return { type: "reasoning.encrypted", format: FORMAT, index, data: signature, ...place };
}

/**
 * Chat Completions `logprobs` for a candidate's `logprobsResult`.
 * @param {any} result - Gemini `logprobsResult`.
 * @returns {{content: any[], refusal: null} | undefined} The `logprobs` object, or undefined when the candidate has none.
 */
function logprobsOf(result) {
	if (!Array.isArray(result?.chosenCandidates) || result.chosenCandidates.length === 0) return undefined;
	const entry = (candidate) => ({
		token: String(candidate?.token ?? ""),
		logprob: Number.isFinite(candidate?.logProbability) ? candidate.logProbability : 0,
		bytes: [...Buffer.from(String(candidate?.token ?? ""))]
	});
	return {
		content: result.chosenCandidates.map((candidate, at) => ({
			...entry(candidate),
			top_logprobs: (Array.isArray(result.topCandidates?.[at]?.candidates) ? result.topCandidates[at].candidates : []).map(entry)
		})),
		refusal: null
	};
}

/**
 * Raw 16-bit PCM audio as a WAV file.
 * @param {Buffer} pcm - Samples.
 * @param {number} rate - Sample rate.
 * @returns {Buffer} The WAV file (mono, 16 bits).
 */
function wav(pcm, rate) {
	const head = Buffer.alloc(44);
	head.write("RIFF", 0);
	head.writeUInt32LE(36 + pcm.length, 4);
	head.write("WAVEfmt ", 8);
	head.writeUInt32LE(16, 16);
	head.writeUInt16LE(1, 20);
	head.writeUInt16LE(1, 22);
	head.writeUInt32LE(rate, 24);
	head.writeUInt32LE(rate * 2, 28);
	head.writeUInt16LE(2, 32);
	head.writeUInt16LE(16, 34);
	head.write("data", 36);
	head.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([head, pcm]);
}

/**
 * The text a code execution part is shown as: the code in a fenced block, or its output in one.
 * @param {any} part - `executableCode` or `codeExecutionResult` part.
 * @returns {string} Text.
 */
function codeText(part) {
	if (part.executableCode) {
		const language =
			typeof part.executableCode.language === "string" && part.executableCode.language !== "LANGUAGE_UNSPECIFIED"
				? part.executableCode.language.toLowerCase()
				: "";
		return `\n\`\`\`${language}\n${part.executableCode.code ?? ""}\n\`\`\`\n`;
	}
	const failed = typeof part.codeExecutionResult.outcome === "string" && part.codeExecutionResult.outcome !== "OUTCOME_OK";
	return `\n\`\`\`${failed ? "text (failed)" : "text"}\n${part.codeExecutionResult.output ?? ""}\n\`\`\`\n`;
}

/**
 * Walks the parts of one candidate and gathers what a Chat Completions message holds. Shared by the JSON and the streamed conversion: a streamed
 * reply feeds it part by part and asks for the signatures at the end, when the length of the text is known.
 * @param {{ field?: string, parallel?: boolean, images?: "images" | "text", computer?: {size: {width: number, height: number} | null, custom: Set<string>, shape?: "toolset" | "classic", enabled?: Set<string>} }} [options] - `computer` turns Gemini's computer actions into Anthropic's calls (`size` is the size of the latest screenshot, `custom` the names of the request's own tools); `parallel` false keeps only the first function call; `images` says whether generated images go in `images` or as markdown in the text.
 * @returns {{ add: (part: any) => any, finish: () => any }} `add` takes a part and returns what it contributed (`text`, `thought`, `call`, `image`, `audio`, `signature`); `finish` gives the signature items.
 */
function gatherer(options = {}) {
	let text = 0;
	let thought = 0;
	let calls = 0;
	let seen = 0;
	let carried;
	const pending = [];
	// With the computer tool, Gemini's actions become Anthropic's `computer` calls (`lib/gemini-computer`).
	const computer = options.computer ? converter(options.computer.size, options.computer.enabled) : null;
	return {
		add(part) {
			const got = {};
			let own = text;
			let kind = "text";
			if (part?.functionCall) {
				if (options.parallel === false && seen > 0) return got;
				seen++;
				const given = part.functionCall.id;
				const base = typeof given === "string" && given !== "" ? given : callId();
				const name = part.functionCall.name;
				const args = part.functionCall.args ?? {};
				let made = [{ name, args }];
				if (computer !== null && ACTIONS.has(name) && !options.computer.custom.has(name)) {
					made = computer.push(name, args).map((input) => {
						// The toolset's calls are named by the member, with no `action` in the input; the older tool's are `computer` with `input.action`.
						const { action, ...rest } = input;
						return options.computer.shape === "toolset" ? { name: action, args: rest } : { name: "computer", args: input };
					});
				}
				const named = ids(base, made.length);
				got.calls = made.map((call, at) => ({
					index: calls++,
					id: named[at],
					type: "function",
					function: { name: call.name, arguments: JSON.stringify(call.args) }
				}));
				got.base = base;
			} else if (part?.thought === true && typeof part.text === "string") {
				got.thought = part.text;
				thought += part.text.length;
				own = thought;
				kind = "thought";
			} else if (typeof part?.text === "string") {
				got.text = part.text;
				text += part.text.length;
				own = text;
			} else if (part?.executableCode || part?.codeExecutionResult) {
				got.text = codeText(part);
				text += got.text.length;
				own = text;
			} else if (typeof part?.inlineData?.data === "string") {
				const mime = String(part.inlineData.mimeType ?? "");
				if (mime.startsWith("image/")) got.image = { mime, data: part.inlineData.data };
				else if (mime.startsWith("audio/")) got.audio = { mime, data: part.inlineData.data };
			}
			const signature = typeof part?.thoughtSignature === "string" && part.thoughtSignature !== "" ? part.thoughtSignature : undefined;
			if (signature !== undefined) got.signature = true;
			if (part?.functionCall) {
				// A signature on an action that was folded into the next call (a key held for a click) goes to that call.
				const use = signature ?? carried;
				if (got.calls.length === 0) carried = use;
				else if (use !== undefined) {
					pending.push({ data: use, id: got.base });
					carried = undefined;
				}
			} else if (signature !== undefined) pending.push({ data: signature, kind, end: own });
			return got;
		},
		finish() {
			computer?.finish();
			return {
				signatures: pending.map((entry, index) =>
					detailOf(
						index,
						entry.data,
						entry.id === undefined
							? { for: entry.kind, rest: (entry.kind === "thought" ? thought : text) - entry.end }
							: { for: "call", id: entry.id }
					)
				)
			};
		}
	};
}

/**
 * The audio of a reply as the `audio` object of a Chat Completions message.
 * @param {{mime: string, data: string}[]} pieces - The audio parts, in order.
 * @param {string | undefined} format - `wav` (the default), `pcm16` or `pcm`, or `mp3`, `opus` or `flac`, which `lib/gemini-audio` encodes (its encoder is loaded when the request is made).
 * @returns {{id: string, data: string, expires_at: number, transcript: string}} The audio object.
 */
function audioOf(pieces, format) {
	const pcm = Buffer.concat(pieces.map((piece) => Buffer.from(piece.data, "base64")));
	const rate = Number(/rate=(\d+)/.exec(pieces[0].mime)?.[1] ?? 24000);
	return {
		id: `audio_${completionId().slice(9)}`,
		data: (ENCODED.includes(String(format))
			? encode(pcm, rate, String(format))
			: format === "pcm16" || format === "pcm"
				? pcm
				: wav(pcm, rate)
		).toString("base64"),
		expires_at: 0,
		transcript: ""
	};
}

/** The MIME type of each audio format a reply can be returned in. */
const AUDIO_MIME = { wav: "audio/wav", pcm16: "audio/L16", pcm: "audio/L16", mp3: "audio/mpeg", opus: "audio/ogg", flac: "audio/flac" };

/**
 * The audio of a reply as a markdown link with a data URI, for a front that has no place for audio (Anthropic's).
 * @param {{mime: string, data: string}[]} pieces - The audio parts, in order.
 * @param {string | undefined} format - The format (`wav` when there is none).
 * @returns {string} `[audio](data:audio/wav;base64,...)`.
 */
function audioLink(pieces, format) {
	return `[audio](data:${AUDIO_MIME[format ?? "wav"]};base64,${audioOf(pieces, format).data})`;
}

/**
 * One candidate as a Chat Completions choice.
 * @param {any} candidate - Gemini candidate.
 * @param {number} index - Choice index.
 * @param {{ field: string, parallel?: boolean, images?: "images" | "text", audio?: string, computer?: any }} options - Where the reasoning goes, whether parallel calls are kept, where generated images go and the audio format asked for.
 * @returns {any} Choice.
 */
function choiceOf(candidate, index, options) {
	const gather = gatherer(options);
	let text = "";
	let thought = "";
	const calls = [];
	const images = [];
	const audio = [];
	for (const part of Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []) {
		const got = gather.add(part);
		if (got.text !== undefined) text += got.text;
		if (got.thought !== undefined) thought += got.thought;
		// A whole message numbers no tool call: the index is for a stream.
		for (const call of got.calls ?? []) calls.push({ id: call.id, type: call.type, function: call.function });
		if (got.image !== undefined) images.push(got.image);
		if (got.audio !== undefined) audio.push(got.audio);
	}
	const finish = finishOf(candidate?.finishReason, calls.length > 0);
	const note = noteOf(candidate);
	if (note !== "") text += `${text === "" ? "" : "\n\n"}${note}`;
	if (options.images === "text") {
		for (const image of images) text += `${text === "" ? "" : "\n\n"}![image](data:${image.mime};base64,${image.data})`;
	}
	const message = { role: "assistant", content: text };
	if (thought !== "") message[options.field] = thought;
	const { signatures } = gather.finish();
	if (signatures.length > 0) message.reasoning_details = signatures;
	if (calls.length > 0) message.tool_calls = calls;
	if (images.length > 0 && options.images !== "text") {
		message.images = images.map((image) => ({ type: "image_url", image_url: { url: `data:${image.mime};base64,${image.data}` } }));
	}
	if (audio.length > 0 && options.images === "text")
		message.content += `${message.content === "" ? "" : "\n\n"}${audioLink(audio, options.audio)}`;
	else if (audio.length > 0) message.audio = audioOf(audio, options.audio);
	if (finish === "content_filter") message.refusal = refusalOf(candidate.finishReason, candidate.finishMessage, false);
	const logprobs = logprobsOf(candidate?.logprobsResult);
	return { index, message, ...(logprobs === undefined ? {} : { logprobs }), finish_reason: finish };
}

/**
 * Convert a (non-streaming) `generateContent` reply to a Chat Completions `chat.completion`: text parts are joined into the content, thought
 * parts go in the settings' reasoning field, `functionCall` parts become tool calls (with Gemini's call id when it sent one), thought signatures
 * become `reasoning_details` items (see `FORMAT`) that are sent back with the next request, generated images are `images` (or markdown in the text),
 * audio is `audio`, code and its output are fenced blocks in the text, `logprobsResult` is `logprobs`, `finishReason` becomes `finish_reason` and
 * `usageMetadata` becomes `usage`. A prompt Gemini blocked (`promptFeedback.blockReason`, no candidates) is an empty reply that was filtered.
 * @param {any} reply - Parsed `generateContent` reply.
 * @param {{ reasoningField?: string, model?: string, cacheCreated?: number, parallel?: boolean, images?: "images" | "text", audio?: string, computer?: {size: {width: number, height: number} | null, custom: Set<string>, shape?: "toolset" | "classic", enabled?: Set<string>} }} [options] - `reasoningField` is where the reasoning goes (default `reasoning`); `model` is the model name on the completion; `cacheCreated` is the tokens this request wrote to a cached content; `parallel` false keeps only the first function call; `images` says where generated images and audio go (default `images` and `audio`; `text` writes them into the text as data URI links); `audio` is the format asked for; `computer` turns Gemini's computer actions into Anthropic's calls.
 * @returns {any} `chat.completion` object.
 * @throws {TranslatorError} `invalid_upstream_response` (502) when the reply has no candidate and no block reason.
 */
export function completion(reply, options = {}) {
	const spec = {
		field: options.reasoningField ?? "reasoning",
		parallel: options.parallel,
		images: options.images,
		audio: options.audio?.toLowerCase(),
		computer: options.computer
	};
	let choices;
	if (Array.isArray(reply?.candidates) && reply.candidates.length > 0) {
		choices = reply.candidates.map((candidate, at) => choiceOf(candidate, candidate.index ?? at, spec));
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
	const usage = usageOf(reply.usageMetadata, options.cacheCreated);
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
 * ends that candidate. One chunker is for one reply: it keeps the completion id (so every chunk carries the same one) and the numbering of tool
 * calls of each candidate. The signatures of text and thought are given at the end of a candidate, when the length of its text is known. An
 * `error` object in the stream gives one `{ error }` chunk.
 * @param {{ model?: string, reasoningField?: string, includeUsage?: boolean, cacheCreated?: number, candidates?: number, parallel?: boolean, images?: "images" | "text", audio?: string, computer?: {size: {width: number, height: number} | null, custom: Set<string>, shape?: "toolset" | "classic", enabled?: Set<string>} }} [options] - `model` is the model name on the chunks; `reasoningField` is where the reasoning goes (default `reasoning`); `includeUsage` (default true) adds the final usage chunk; `cacheCreated` is the tokens this request wrote to a cached content; `candidates` is how many candidates are streamed (default 1; the others are ignored); `parallel` false keeps only the first function call of a candidate; `images` says where generated images go; `audio` is the format asked for.
 * @returns {{ event: (data: any) => any[], finished: () => boolean, usage: () => any }} `event` gives the chunks one stream chunk produces, `finished` says whether every candidate ended (a `finishReason`, a blocked prompt, or a failure) and `usage` is the latest `usageMetadata`.
 */
export function createChunker(options = {}) {
	const id = completionId();
	const created = Math.floor(Date.now() / 1000);
	const field = options.reasoningField ?? "reasoning";
	const wanted = options.candidates ?? 1;
	const audio = options.audio?.toLowerCase();
	const states = new Map();
	let failed = false;
	let blocked = false;
	let counted = false;
	let usage;
	const state = (index) => {
		if (!states.has(index)) states.set(index, { started: false, done: false, text: "", gather: gatherer(options), audio: [], calls: 0 });
		return states.get(index);
	};
	const make = (index, delta, finish = null, extra = {}) => ({
		id,
		object: "chat.completion.chunk",
		created,
		model: options.model,
		choices: [{ index, delta, ...extra, finish_reason: finish }]
	});
	// The first chunk of every candidate names the role.
	const first = (index) => {
		const own = state(index);
		if (own.started) return [];
		own.started = true;
		return [make(index, { role: "assistant", content: "" })];
	};
	const ended = () => failed || blocked || (states.size >= 1 && [...states.values()].filter((entry) => entry.done).length >= wanted);
	return {
		event(data) {
			if (data?.error !== undefined && data?.error !== null) {
				failed = true;
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
			const candidates = Array.isArray(data?.candidates) ? data.candidates.filter((entry) => (entry.index ?? 0) < wanted) : [];
			if (candidates.length === 0) {
				const reason = data?.promptFeedback?.blockReason;
				if (typeof reason === "string") {
					blocked = true;
					out.push(
						...first(0),
						make(0, { refusal: refusalOf(reason, data.promptFeedback.blockReasonMessage, true) }),
						make(0, {}, "content_filter")
					);
				}
			}
			for (const candidate of candidates) {
				const index = candidate.index ?? 0;
				const own = state(index);
				if (own.done) continue;
				for (const part of Array.isArray(candidate.content?.parts) ? candidate.content.parts : []) {
					const got = own.gather.add(part);
					if (got.text !== undefined && got.text !== "") {
						own.text += got.text;
						out.push(...first(index), make(index, { content: got.text }));
					}
					if (got.thought !== undefined && got.thought !== "") out.push(...first(index), make(index, { [field]: got.thought }));
					for (const call of got.calls ?? []) {
						own.calls++;
						out.push(...first(index), make(index, { tool_calls: [call] }));
					}
					if (got.image !== undefined) {
						if (options.images === "text")
							out.push(...first(index), make(index, { content: `![image](data:${got.image.mime};base64,${got.image.data})` }));
						else
							out.push(
								...first(index),
								make(index, { images: [{ type: "image_url", image_url: { url: `data:${got.image.mime};base64,${got.image.data}` } }] })
							);
					}
					if (got.audio !== undefined) own.audio.push(got.audio);
				}
				const logprobs = logprobsOf(candidate.logprobsResult);
				if (logprobs !== undefined) out.push(...first(index), make(index, {}, null, { logprobs }));
				if (typeof candidate.finishReason === "string") {
					own.done = true;
					const note = noteOf(candidate);
					if (note !== "") out.push(...first(index), make(index, { content: `${own.text === "" ? "" : "\n\n"}${note}` }));
					const { signatures } = own.gather.finish();
					if (signatures.length > 0) out.push(...first(index), make(index, { reasoning_details: signatures }));
					if (own.audio.length > 0) {
						out.push(
							...first(index),
							make(
								index,
								options.images === "text"
									? { content: `${own.text === "" ? "" : "\n\n"}${audioLink(own.audio, audio)}` }
									: { audio: audioOf(own.audio, audio) }
							)
						);
					}
					const finish = finishOf(candidate.finishReason, own.calls > 0);
					if (finish === "content_filter")
						out.push(...first(index), make(index, { refusal: refusalOf(candidate.finishReason, candidate.finishMessage, false) }));
					out.push(...first(index), make(index, {}, finish));
				}
			}
			const total = usageOf(usage, options.cacheCreated);
			if (ended() && !failed && !counted && total !== undefined && options.includeUsage !== false) {
				counted = true;
				out.push({ id, object: "chat.completion.chunk", created, model: options.model, choices: [], usage: total });
			}
			return out;
		},
		finished: ended,
		usage: () => usage
	};
}

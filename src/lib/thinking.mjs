/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/thinking.mjs
 *	@Date: 2026-10-25T12:28:19-07:00 (1792956499)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:02-07:00 (1792958342)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Reasoning helpers: foreign-marked signatures that can carry provider reasoning data, `<think>` tag splitting and field access.
 */
import { deflateRawSync, inflateRaw } from "node:zlib";
import { promisify } from "node:util";

const inflate = promisify(inflateRaw);

const PREFIX = "llmt:";
const OPEN = "<think>";
const CLOSE = "</think>";
/** Marks a deflated payload; not a base64url character, so plain and packed signatures cannot be confused. */
const PACKED = "~";
const BASE64URL = /^[A-Za-z0-9_-]*$/;
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
/** Payloads longer than this many characters of JSON are deflated. */
const PACK_AT = 512;
/** Longest signature produced or accepted, in characters. A larger payload is replaced by the plain marker. */
const MAX_SIGNATURE = 256 * 1024;
/** Longest decoded JSON accepted (also bounds inflation). */
const MAX_JSON = 1024 * 1024;
/** Longest single string, most items in a list, most keys in an object and deepest nesting accepted in carried data. */
const MAX_TEXT = 512 * 1024;
const MAX_ITEMS = 256;
const MAX_KEYS = 32;
const MAX_DEPTH = 5;
/** Per request: most bytes inflated or decoded in total, most marked signatures decoded, most failed decodes before decoding stops, and the largest output-to-input ratio of an inflated signature. */
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const MAX_REQUEST_SIGNATURES = 1024;
const MAX_REQUEST_FAILURES = 8;
const MAX_RATIO = 30;
/** `format` of the `reasoning_details` items that carry an Anthropic thinking block (text with its signature) or redacted thinking (data). */
export const ANTHROPIC_FORMAT = "anthropic-claude-v1";
/** Fields of an OpenAI assistant message that carry provider reasoning. */
const TEXT_FIELDS = ["reasoning_content", "reasoning"];

/**
 * The signature with no provider data: the plain marker `{"v":1}`.
 * @returns {string} Signature string.
 */
function marker() {
	return PREFIX + Buffer.from('{"v":1}').toString("base64url");
}

/**
 * Check provider reasoning data against the limits both {@link sign} and {@link unsign} enforce, and copy it. At most one text field
 * (`reasoning_content` or `reasoning`, a string of at most 512 KiB) and `reasoning_details` (at most 256 JSON objects, nested at most 5 levels,
 * at most 32 keys each with plain identifier keys, strings of at most 512 KiB); nothing else is kept.
 * @param {any} data - Candidate data.
 * @returns {{ reasoning_content?: string, reasoning?: string, reasoning_details?: object[] } | null} The cleaned copy, or null when it is not acceptable or empty.
 */
function validate(data) {
	if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
	try {
		const out = {};
		for (const key of TEXT_FIELDS) {
			if (data[key] === undefined) continue;
			if (typeof data[key] !== "string" || data[key].length > MAX_TEXT) return null;
			out[key] = data[key];
		}
		if (Object.keys(out).length > 1) return null;
		if (data.reasoning_details !== undefined) {
			const details = plain(data.reasoning_details, 0);
			if (!Array.isArray(details) || details.some((item) => item === null || typeof item !== "object" || Array.isArray(item))) return null;
			out.reasoning_details = details;
		}
		return Object.keys(out).length > 0 ? out : null;
	} catch {
		return null;
	}
}

/**
 * Create the signature attached to a thinking block produced from upstream reasoning. It is clearly marked as not coming from Anthropic.
 *
 * Format: `llmt:` followed by the base64url of a JSON payload `{"v":1}`, or `{"v":1,"p":"<producer>","d":{...}}` when provider reasoning data has to
 * come back with the block. `p` names the driver and protocol that produced the data (so it is restored only for the same producer) and `d` holds
 * one text field (`reasoning_content` or `reasoning`) and/or `reasoning_details`. A payload longer than 512 bytes is deflated and written
 * as `llmt:~` plus base64url, unless that would not shrink it or would exceed the 30:1 inflation ratio {@link unsign} accepts. Data that
 * {@link unsign} would reject (over the size limits, unknown shape) or a result over 256 KiB leaves the plain marker.
 * @param {{ reasoning_content?: string, reasoning?: string, reasoning_details?: object[] }} [data] - Provider reasoning data to carry.
 * @param {string} [producer] - Producer binding, `driver:protocol:host`.
 * @returns {string} Signature string.
 */
export function sign(data, producer) {
	const clean = data === undefined ? null : validate(data);
	if (clean === null) return marker();
	const bytes = Buffer.from(JSON.stringify(producer === undefined ? { v: 1, d: clean } : { v: 1, p: producer, d: clean }));
	if (bytes.length > MAX_JSON) return marker();
	let body = bytes.toString("base64url");
	if (bytes.length > PACK_AT) {
		const packed = deflateRawSync(bytes);
		if (bytes.length <= MAX_RATIO * packed.length && packed.length < bytes.length) body = PACKED + packed.toString("base64url");
	}
	const out = PREFIX + body;
	return out.length > MAX_SIGNATURE ? marker() : out;
}

/**
 * Whether a signature was produced by {@link sign}.
 * @param {unknown} signature - Signature value.
 * @returns {signature is string} True for translator-made signatures.
 */
export function isOurs(signature) {
	return typeof signature === "string" && signature.startsWith(PREFIX);
}

/**
 * Copy a JSON value, accepting only plain data: objects with ordinary keys, arrays, strings, finite numbers, booleans and null, within
 * the size and depth limits. Anything else throws.
 * @param {unknown} value - Value to copy.
 * @param {number} depth - Current nesting depth.
 * @returns {unknown} The copy.
 */
function plain(value, depth) {
	if (value === null || typeof value === "boolean") return value;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.length <= MAX_TEXT) return value;
	if (depth < MAX_DEPTH && Array.isArray(value) && value.length <= MAX_ITEMS) return value.map((entry) => plain(entry, depth + 1));
	if (depth < MAX_DEPTH && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length <= MAX_KEYS) {
		const out = {};
		for (const [key, entry] of Object.entries(value)) {
			if (!KEY.test(key)) throw new TypeError("key");
			out[key] = plain(entry, depth + 1);
		}
		return out;
	}
	throw new TypeError("value");
}

/**
 * The limits on decoding signatures within one request, shared by every conversion of it (retries and failover included): how many bytes may be
 * inflated or decoded in total, how many marked signatures may be decoded, and how many decodes may fail before decoding stops for the rest of the
 * request. Bytes are charged before a signature is inflated (the most it could produce) and refunded down to what it did produce, so a signature that
 * fails still costs. Results are cached by producer and signature, so converting the same request again costs nothing. Once the budget is spent the
 * caller falls back to the thinking text.
 * @returns {{ bytes: number, signatures: number, failures: number, cache: Map<string, any> }} A fresh budget for one request.
 */
export function createBudget() {
	return { bytes: MAX_REQUEST_BYTES, signatures: MAX_REQUEST_SIGNATURES, failures: MAX_REQUEST_FAILURES, cache: new Map() };
}

/**
 * Read the provider reasoning data out of a signature made by {@link sign}. Strict: the signature must carry the mark, be within the size
 * limits and decode to `{"v":1,"p":...,"d":{...}}` with only the known fields, each well formed, and its producer must equal `producer`
 * (a payload with no producer is returned only when none is given). Anything else (a real Anthropic signature, a plain marker, a forged, garbled or
 * foreign one) gives null and the caller falls back to the thinking text. Inflation is bounded while it runs: by 1 MiB per signature, by the rest of
 * the per-request budget, and by a 30:1 ratio of output to compressed input, so a small signature cannot expand into a large allocation; after a few
 * failed decodes the rest of the request is not decoded at all.
 * @param {unknown} signature - Signature value from a thinking block.
 * @param {{ producer?: string, budget?: ReturnType<typeof createBudget> }} [options] - `producer` is the current `driver:protocol:host`; `budget` is shared by all signatures of one request (see {@link createBudget}).
 * @returns {Promise<{ reasoning_content?: string, reasoning?: string, reasoning_details?: object[] } | null>} The data, or null.
 */
export async function unsign(signature, { producer, budget = createBudget() } = {}) {
	if (!isOurs(signature) || signature.length > MAX_SIGNATURE) return null;
	const key = `${producer}\n${signature}`;
	if (budget.cache.has(key)) return budget.cache.get(key);
	if (budget.signatures <= 0 || budget.failures <= 0) return null;
	budget.signatures--;
	const result = await decode(signature, producer, budget);
	if (result === undefined) {
		budget.failures--;
		budget.cache.set(key, null);
		return null;
	}
	budget.cache.set(key, result);
	return result;
}

/**
 * Decode one marked signature, charging the budget before any inflation.
 * @param {string} signature - Marked signature within the length limit.
 * @param {string | undefined} producer - Current producer.
 * @param {ReturnType<typeof createBudget>} budget - Per-request budget.
 * @returns {Promise<object | null | undefined>} The data; null for a well-formed signature that is not for this producer or carries nothing; undefined when it failed to decode (counts as a failure).
 */
async function decode(signature, producer, budget) {
	try {
		let body = signature.slice(PREFIX.length);
		const packed = body.startsWith(PACKED);
		if (packed) body = body.slice(PACKED.length);
		if (!BASE64URL.test(body)) return undefined;
		const raw = Buffer.from(body, "base64url");
		const limit = Math.min(MAX_JSON, budget.bytes);
		// The most this signature may produce is charged up front; what it did not produce is refunded once it has been read.
		const attempt = packed ? Math.min(limit, MAX_RATIO * raw.length) : raw.length;
		if (attempt < 1 || attempt > limit) return undefined;
		budget.bytes -= attempt;
		const bytes = packed ? await inflate(raw, { maxOutputLength: attempt }) : raw;
		budget.bytes += attempt - bytes.length;
		const payload = JSON.parse(bytes.toString("utf8"));
		if (payload?.v !== 1 || payload.d === undefined) return undefined;
		if (payload.p !== producer) return null;
		return validate(payload.d) ?? undefined;
	} catch {
		return undefined;
	}
}

/**
 * The `reasoning_details` item for an Anthropic thinking block or redacted thinking block, in the form an OpenAI client replays.
 * @param {any} block - Anthropic `thinking` or `redacted_thinking` content block (with its signature or data).
 * @param {number} index - Position among what the OpenAI message shows: 0 before the text, 1 after it (or before the first tool call when there is no text), then one more for each tool call.
 * @returns {object | null} The item, or null for a block that cannot be replayed (no signature or data).
 */
export function detailOf(block, index) {
	if (block?.type === "thinking" && typeof block.signature === "string" && block.signature !== "") {
		return {
			type: "reasoning.text",
			text: typeof block.thinking === "string" ? block.thinking : "",
			signature: block.signature,
			format: ANTHROPIC_FORMAT,
			index
		};
	}
	if (block?.type === "redacted_thinking" && typeof block.data === "string" && block.data !== "") {
		return { type: "reasoning.encrypted", data: block.data, format: ANTHROPIC_FORMAT, index };
	}
	return null;
}

/**
 * Anthropic thinking and redacted thinking blocks from the `reasoning_details` an OpenAI client replayed. Strict: only items in this
 * translator's Anthropic format with the expected string fields become blocks, only their known fields are copied, and at most 64 items
 * totalling 1 MiB of text are taken; anything else is ignored.
 * @param {unknown} details - `reasoning_details` of an assistant message.
 * @returns {{ at: number, block: any }[]} Anthropic content blocks with the position (`index`) they had in the original message, which the caller uses to keep thinking in place between the text and the tool calls (possibly empty).
 */
export function blocksOf(details) {
	const position = (item) => (Number.isInteger(item.index) && item.index >= 0 ? item.index : 0);
	if (!Array.isArray(details)) return [];
	const blocks = [];
	let size = 0;
	for (const item of details.slice(0, 64)) {
		if (item === null || typeof item !== "object" || item.format !== ANTHROPIC_FORMAT) continue;
		if (item.type === "reasoning.text" && typeof item.text === "string" && typeof item.signature === "string" && item.signature !== "") {
			size += item.text.length + item.signature.length;
			if (size <= MAX_JSON)
				blocks.push({ at: position(item), block: { type: "thinking", thinking: item.text, signature: item.signature } });
		} else if (item.type === "reasoning.encrypted" && typeof item.data === "string" && item.data !== "") {
			size += item.data.length;
			if (size <= MAX_JSON) blocks.push({ at: position(item), block: { type: "redacted_thinking", data: item.data } });
		}
	}
	return blocks;
}

/**
 * Which field of an OpenAI message or delta carries its reasoning text (`reasoning` or the older `reasoning_content`), if any.
 * @param {{ reasoning?: unknown, reasoning_content?: unknown }|undefined} part - Message or delta.
 * @returns {"reasoning"|"reasoning_content"|null} Field name.
 */
export function reasoningKey(part) {
	if (typeof part?.reasoning === "string" && part.reasoning !== "") return "reasoning";
	if (typeof part?.reasoning_content === "string" && part.reasoning_content !== "") return "reasoning_content";
	return null;
}

/**
 * Add a streamed `reasoning_details` fragment to the list being built, so a stream yields the same items as a JSON reply. Fragments with the
 * same `index` and `type` are one item: `text` and `summary` are concatenated and `signature`, `data`, `format` and `id` are taken from the
 * fragment that carries them. A fragment without an `index`, or a new one, is appended; anything that is not an object is skipped.
 * @param {any[]} list - Items so far (mutated).
 * @param {any} fragment - One element of a streamed `reasoning_details` array.
 * @returns {any[]} The same list.
 */
export function mergeDetail(list, fragment) {
	if (fragment === null || typeof fragment !== "object" || Array.isArray(fragment)) return list;
	const into =
		fragment.index === undefined ? undefined : list.find((entry) => entry.index === fragment.index && entry.type === fragment.type);
	if (into === undefined) {
		list.push({ ...fragment });
		return list;
	}
	for (const key of ["text", "summary"])
		if (typeof fragment[key] === "string") into[key] = (typeof into[key] === "string" ? into[key] : "") + fragment[key];
	for (const key of ["signature", "data", "format", "id"])
		if (typeof fragment[key] === "string" && fragment[key] !== "") into[key] = fragment[key];
	return list;
}

/**
 * Readable text of a `reasoning_details` list (`reasoning.text` and `reasoning.summary` items), for a thinking block whose reasoning
 * arrived only as structured details.
 * @param {unknown} details - `reasoning_details` value.
 * @returns {string} Concatenated text ("" for encrypted-only details).
 */
export function detailsText(details) {
	if (!Array.isArray(details)) return "";
	return details
		.map((item) => (typeof item?.text === "string" ? item.text : typeof item?.summary === "string" ? item.summary : ""))
		.join("");
}

/**
 * Reasoning text carried by an OpenAI message or delta (`reasoning` or the older `reasoning_content`).
 * @param {{ reasoning?: unknown, reasoning_content?: unknown }|undefined} part - Message or delta.
 * @returns {string} Reasoning text ("" when absent).
 */
export function reasoningOf(part) {
	const value = part?.reasoning ?? part?.reasoning_content;
	return typeof value === "string" ? value : "";
}

/**
 * Split a complete content string into reasoning and answer. Only a LEADING `<think>...</think>` is recognised
 * (whitespace before it and after it is ignored); an unterminated `<think>` treats everything as reasoning.
 *
 * With `open` the output is taken to start inside a thought (the chat template already wrote `<think>` into the
 * generation prompt): everything before the first `</think>` is reasoning. When no `</think>` appears the whole
 * content is answer text. A literal leading `<think>` is still honoured.
 * @param {string} content - Full message content.
 * @param {boolean} [open] - The output starts inside a thought.
 * @returns {{ reasoning: string, text: string }} Split result.
 */
export function splitThink(content, open = false) {
	const trimmed = content.trimStart();
	if (!trimmed.startsWith(OPEN)) {
		const close = open ? content.indexOf(CLOSE) : -1;
		if (close === -1) return { reasoning: "", text: content };
		return { reasoning: content.slice(0, close), text: content.slice(close + CLOSE.length).trimStart() };
	}
	const end = trimmed.indexOf(CLOSE);
	if (end === -1) return { reasoning: trimmed.slice(OPEN.length), text: "" };
	return { reasoning: trimmed.slice(OPEN.length, end), text: trimmed.slice(end + CLOSE.length).trimStart() };
}

/**
 * Incremental version of {@link splitThink} for streamed content. Feed content deltas to `push()` and call `end()`
 * once; each call returns `{ reasoning, text }` pieces that are safe to emit now (partial tags are held back).
 *
 * With `open` (see {@link splitThink}) nothing is emitted until the first `</think>` arrives, because only then is it known
 * that the content so far was reasoning; if the stream ends first, everything held is released as answer text.
 * @param {boolean} [open] - The output starts inside a thought.
 *
 * `release()` stops splitting: anything held is returned as text and all later content passes through as text (used once the server
 * sends reasoning in its own field, when content is never split). `pending()` is true while, with `open`, it is not yet known whether
 * the content so far is reasoning.
 * @returns {{ push: (delta: string) => { reasoning: string, text: string }, end: () => { reasoning: string, text: string }, release: () => { reasoning: string, text: string }, pending: () => boolean }} Splitter.
 */
export function createThinkSplitter(open = false) {
	// "start": undecided; "think": inside the tag; "after": skipping whitespace after the close tag; "plain": passthrough;
	// "implicit": started inside a thought that has no open tag, waiting for the close tag.
	let mode = "start";
	let held = "";

	const step = (input, final) => {
		let reasoning = "";
		let text = "";
		let buffer = held + input;
		held = "";
		for (;;) {
			if (mode === "plain") {
				text += buffer;
				break;
			}
			if (mode === "start") {
				const trimmed = buffer.trimStart();
				if (trimmed === "" && !final) {
					held = buffer;
					break;
				}
				if (trimmed.startsWith(OPEN)) {
					mode = "think";
					buffer = trimmed.slice(OPEN.length);
				} else if (!final && trimmed !== "" && OPEN.startsWith(trimmed)) {
					held = buffer;
					break;
				} else {
					mode = open ? "implicit" : "plain";
				}
			} else if (mode === "implicit") {
				const end = buffer.indexOf(CLOSE);
				if (end !== -1) {
					reasoning += buffer.slice(0, end);
					buffer = buffer.slice(end + CLOSE.length);
					mode = "after";
				} else if (final) {
					text += buffer;
					break;
				} else {
					held = buffer;
					break;
				}
			} else if (mode === "think") {
				const end = buffer.indexOf(CLOSE);
				if (end !== -1) {
					reasoning += buffer.slice(0, end);
					buffer = buffer.slice(end + CLOSE.length);
					mode = "after";
					continue;
				}
				const keep = final ? 0 : partialSuffix(buffer, CLOSE);
				reasoning += buffer.slice(0, buffer.length - keep);
				held = buffer.slice(buffer.length - keep);
				break;
			} else {
				buffer = buffer.trimStart();
				if (buffer === "") break;
				mode = "plain";
			}
		}
		return { reasoning, text };
	};

	const release = () => {
		const text = held;
		held = "";
		mode = "plain";
		return { reasoning: "", text };
	};

	return {
		push: (delta) => step(delta, false),
		end: () => step("", true),
		release,
		pending: () => open && (mode === "start" || mode === "implicit")
	};
}

/**
 * Length of the longest suffix of `buffer` that is a proper prefix of `tag`.
 * @param {string} buffer - Text to inspect.
 * @param {string} tag - Tag to match against.
 * @returns {number} Suffix length (0 when none).
 */
function partialSuffix(buffer, tag) {
	for (let n = Math.min(buffer.length, tag.length - 1); n > 0; n--) {
		if (tag.startsWith(buffer.slice(buffer.length - n))) return n;
	}
	return 0;
}

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
/** `format` of the `reasoning_details` items that carry an Anthropic thinking block (text with its signature) or redacted thinking (data). */
export const ANTHROPIC_FORMAT = "anthropic-claude-v1";
/** Fields of an OpenAI assistant message that carry provider reasoning. */
const TEXT_FIELDS = ["reasoning_content", "reasoning"];

/**
 * Create the signature attached to a thinking block produced from upstream reasoning. It is clearly marked as not coming from Anthropic.
 *
 * Format: `llmt:` followed by the base64url of a JSON payload `{"v":1}`, or `{"v":1,"d":{...}}` when provider reasoning data has to come
 * back with the block. `d` holds only `reasoning_content` and `reasoning` (strings) and `reasoning_details` (a list of JSON objects).
 * A payload longer than 512 characters is deflated and written as `llmt:~` plus base64url. When the result would exceed 256 KiB the data
 * is left out and the plain marker is returned.
 * @param {{ reasoning_content?: string, reasoning?: string, reasoning_details?: object[] }} [data] - Provider reasoning data to carry.
 * @returns {string} Signature string.
 */
export function sign(data) {
	const payload = data === undefined ? { v: 1 } : { v: 1, d: data };
	const json = JSON.stringify(payload);
	const body =
		json.length > PACK_AT ? PACKED + deflateRawSync(Buffer.from(json)).toString("base64url") : Buffer.from(json).toString("base64url");
	const out = PREFIX + body;
	return out.length > MAX_SIGNATURE ? sign() : out;
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
 * Read the provider reasoning data out of a signature made by {@link sign}. Strict: the signature must carry the mark, be within the size
 * limits and decode to `{"v":1,"d":{...}}` with only the known fields, each well formed; anything else (a real Anthropic signature, a plain
 * marker, a forged or garbled one) gives null and the caller falls back to the thinking text.
 * @param {unknown} signature - Signature value from a thinking block.
 * @returns {Promise<{ reasoning_content?: string, reasoning?: string, reasoning_details?: object[] } | null>} The data, or null.
 */
export async function unsign(signature) {
	if (!isOurs(signature) || signature.length > MAX_SIGNATURE) return null;
	try {
		let body = signature.slice(PREFIX.length);
		const packed = body.startsWith(PACKED);
		if (packed) body = body.slice(PACKED.length);
		if (!BASE64URL.test(body)) return null;
		const raw = Buffer.from(body, "base64url");
		const json = (packed ? await inflate(raw, { maxOutputLength: MAX_JSON }) : raw).toString("utf8");
		const payload = JSON.parse(json);
		if (payload?.v !== 1 || payload.d === undefined) return null;
		const data = payload.d;
		if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
		const out = {};
		for (const key of TEXT_FIELDS) {
			if (data[key] === undefined) continue;
			if (typeof data[key] !== "string" || data[key].length > MAX_TEXT) return null;
			out[key] = data[key];
		}
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
 * The `reasoning_details` item for an Anthropic thinking block or redacted thinking block, in the form an OpenAI client replays.
 * @param {any} block - Anthropic `thinking` or `redacted_thinking` content block (with its signature or data).
 * @param {number} index - Position among the message's reasoning items.
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
 * @returns {any[]} Anthropic content blocks (possibly empty).
 */
export function blocksOf(details) {
	if (!Array.isArray(details)) return [];
	const blocks = [];
	let size = 0;
	for (const item of details.slice(0, 64)) {
		if (item === null || typeof item !== "object" || item.format !== ANTHROPIC_FORMAT) continue;
		if (item.type === "reasoning.text" && typeof item.text === "string" && typeof item.signature === "string" && item.signature !== "") {
			size += item.text.length + item.signature.length;
			if (size <= MAX_JSON) blocks.push({ type: "thinking", thinking: item.text, signature: item.signature });
		} else if (item.type === "reasoning.encrypted" && typeof item.data === "string" && item.data !== "") {
			size += item.data.length;
			if (size <= MAX_JSON) blocks.push({ type: "redacted_thinking", data: item.data });
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

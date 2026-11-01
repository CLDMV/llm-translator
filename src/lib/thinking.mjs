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
 * @fileoverview Reasoning helpers: foreign-marked signatures, `<think>` tag splitting and field access.
 */

const PREFIX = "llmt:";
const OPEN = "<think>";
const CLOSE = "</think>";

/**
 * Create the signature attached to a thinking block produced from upstream reasoning. It is clearly marked as not
 * coming from Anthropic.
 * @returns {string} Signature string.
 */
export function sign() {
	return PREFIX + Buffer.from(JSON.stringify({ v: 1 })).toString("base64url");
}

/**
 * Whether a signature was produced by {@link sign}.
 * @param {unknown} signature - Signature value.
 * @returns {boolean} True for translator-made signatures.
 */
export function isOurs(signature) {
	return typeof signature === "string" && signature.startsWith(PREFIX);
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

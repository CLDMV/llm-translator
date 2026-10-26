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
 * @param {string} content - Full message content.
 * @returns {{ reasoning: string, text: string }} Split result.
 */
export function splitThink(content) {
	const trimmed = content.trimStart();
	if (!trimmed.startsWith(OPEN)) return { reasoning: "", text: content };
	const end = trimmed.indexOf(CLOSE);
	if (end === -1) return { reasoning: trimmed.slice(OPEN.length), text: "" };
	return { reasoning: trimmed.slice(OPEN.length, end), text: trimmed.slice(end + CLOSE.length).trimStart() };
}

/**
 * Incremental version of {@link splitThink} for streamed content. Feed content deltas to `push()` and call `end()`
 * once; each call returns `{ reasoning, text }` pieces that are safe to emit now (partial tags are held back).
 * @returns {{ push: (delta: string) => { reasoning: string, text: string }, end: () => { reasoning: string, text: string } }} Splitter.
 */
export function createThinkSplitter() {
	// "start": undecided; "think": inside the tag; "after": skipping whitespace after the close tag; "plain": passthrough.
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
					mode = "plain";
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

	return { push: (delta) => step(delta, false), end: () => step("", true) };
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

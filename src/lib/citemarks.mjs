/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/citemarks.mjs
 *	@Date: 2026-11-25T01:10:00-08:00 (1795597800)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-25T01:10:00-08:00 (1795597800)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Citation markers in the text of a model that was offered numbered sources (the `web_search` results).
 *
 * The upstream model has no way to write Anthropic's `citations`, so it is told to write a marker right after a claim: `[[cite:N]]`, where `N`
 * is the number of the source it read. The server tool runner numbers the sources of one request in order (the results of earlier turns in the
 * history first, then each search of this turn), so a number is never reused. This module reads the markers back:
 * - {@link split} for a whole text (a non-streamed reply): the marker is removed and the span it follows becomes a text block that carries the
 *   citations. The span is the text since the previous marker or the previous sentence boundary (a `.`, `!` or `?` followed by white space, or a
 *   line break) in the same text block. Markers that follow each other (only white space between) cite the same span. A marker with no number
 *   in the sources is left in the text, and a marker with no text before it is dropped.
 * - {@link streamer} for a stream: text goes out as it arrives, only a tail that may be the start of a marker is held back. A marker ends the
 *   block that is open (the block holds the text since the last marker or the block's start, because text already sent cannot be split by
 *   sentence); the text after it starts a new block.
 * Scanning is done by hand (no regular expressions) so a long text cannot cost more than a linear pass.
 * @module @cldmv/llm-translator/lib/citemarks
 */

/** The start of a marker. */
const OPEN = "[[cite:";

/** The most digits a marker's number may have; a longer run is not a marker. */
const DIGITS = 6;

const NONE = { kind: "none", length: 0, id: 0 };
const PARTIAL = { kind: "partial", length: 0, id: 0 };

/**
 * Read a marker at a position.
 * @param {string} text - Text.
 * @param {number} at - Index of a `[`.
 * @returns {{kind: string, length: number, id: number}} `kind` `full` for a complete marker (`length` of it and its source number `id`), `partial`
 *   when the text ends inside what could still become one, `none` otherwise (`length` and `id` are 0).
 */
export function match(text, at) {
	const head = text.slice(at, at + OPEN.length);
	if (!OPEN.startsWith(head)) return NONE;
	if (head.length < OPEN.length) return PARTIAL;
	const from = at + OPEN.length;
	let end = from;
	while (end < text.length && end - from < DIGITS && text[end] >= "0" && text[end] <= "9") end++;
	if (end === text.length) return PARTIAL;
	if (end === from || text[end] !== "]") return NONE;
	if (end + 1 === text.length) return PARTIAL;
	if (text[end + 1] !== "]") return NONE;
	return { kind: "full", length: end + 2 - at, id: Number(text.slice(from, end)) };
}

/**
 * Whether a character is white space for the purpose of spans.
 * @param {string} char - One character.
 * @returns {boolean} True for a space, tab or line break.
 */
function blank(char) {
	return char === " " || char === "\t" || char === "\n" || char === "\r";
}

/**
 * Where the span a marker cites starts in the text before it: after the last sentence boundary, or 0.
 * @param {string} text - Text before the marker (not blank).
 * @param {number} end - Length of the text without its trailing white space.
 * @returns {number} Start index.
 */
function spanStart(text, end) {
	for (let at = end - 2; at >= 0; at--) {
		const char = text[at];
		if (char === "\n" || ((char === "." || char === "!" || char === "?") && blank(text[at + 1]))) {
			// The white space after the boundary stays with the text before it.
			let start = at + 1;
			while (blank(text[start])) start++;
			return start;
		}
	}
	return 0;
}

/**
 * Cut a text at its citation markers.
 * @param {string} text - Text of a text block.
 * @param {any[]} sources - Citations by number minus one (`sources[0]` is source 1).
 * @returns {{text: string, citations: any[]}[]} Text blocks that join to the text without its markers; the ones that cite have `citations`.
 */
export function split(text, sources) {
	const out = [];
	let buffer = "";
	let pending = null;
	let gap = "";
	const add = (piece) => {
		if (piece === "") return;
		if (pending !== null) {
			if (piece.trim() === "") {
				gap += piece;
				return;
			}
			out.push(pending);
			pending = null;
			piece = gap + piece;
			gap = "";
		}
		buffer += piece;
	};
	const mark = (citation) => {
		if (pending !== null) {
			if (!pending.citations.includes(citation)) pending.citations.push(citation);
			gap = "";
			return;
		}
		const end = buffer.trimEnd().length;
		if (end === 0) return;
		const start = spanStart(buffer, end);
		if (start > 0) out.push({ text: buffer.slice(0, start), citations: [] });
		pending = { text: buffer.slice(start), citations: [citation] };
		buffer = "";
	};
	let from = 0;
	while (from < text.length) {
		const at = text.indexOf(OPEN, from);
		if (at === -1) {
			add(text.slice(from));
			break;
		}
		add(text.slice(from, at));
		const found = match(text, at);
		if (found.kind !== "full") {
			add("[");
			from = at + 1;
		} else {
			from = at + found.length;
			if (found.id >= 1 && found.id <= sources.length) mark(sources[found.id - 1]);
			else add(text.slice(at, from));
		}
	}
	if (pending !== null) out.push(pending);
	if (buffer !== "") out.push({ text: buffer, citations: [] });
	return out;
}

/**
 * A reader for the text of one streamed block.
 * @param {any[]} sources - Citations by number minus one.
 * @returns {{feed: (chunk: string) => ({text: string} | {mark: any})[], end: () => ({text: string} | {mark: any})[]}} `feed` takes the next piece of
 *   text, `end` the end of the block (it releases a held tail that never became a marker). Both return operations in order: text to send, or a
 *   citation whose marker was read.
 */
export function streamer(sources) {
	let held = "";
	const read = (chunk, last) => {
		const text = held + chunk;
		held = "";
		const ops = [];
		const put = (piece) => {
			if (piece === "") return;
			if (ops.length > 0 && "text" in ops[ops.length - 1]) ops[ops.length - 1].text += piece;
			else ops.push({ text: piece });
		};
		let from = 0;
		for (;;) {
			const at = text.indexOf("[", from);
			if (at === -1) {
				put(text.slice(from));
				return ops;
			}
			put(text.slice(from, at));
			const found = match(text, at);
			if (found.kind === "partial") {
				if (last) put(text.slice(at));
				else held = text.slice(at);
				return ops;
			}
			if (found.kind === "none") {
				put("[");
				from = at + 1;
				continue;
			}
			from = at + found.length;
			if (found.id >= 1 && found.id <= sources.length) ops.push({ mark: sources[found.id - 1] });
			else put(text.slice(at, from));
		}
	};
	return { feed: (chunk) => read(chunk, false), end: () => read("", true) };
}

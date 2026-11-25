/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/html-text.mjs
 *	@Date: 2026-11-25T00:40:00-08:00 (1795596000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-25T00:40:00-08:00 (1795596000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview HTML to readable text for the web fetch server tool. A single forward scan over the markup (no backtracking patterns, so a hostile
 * page cannot make it slow): comments, `<script>`-like elements and tags are dropped, block elements become line breaks, character references are
 * decoded and white space is collapsed.
 * @module @cldmv/llm-translator/lib/html-text
 */

/** Elements whose content is not text a reader sees. */
const HIDDEN = new Set(["script", "style", "noscript", "template", "svg", "title", "iframe", "object"]);

/** Elements that start a new line. */
const BLOCKS = new Set([
	"address",
	"article",
	"aside",
	"blockquote",
	"br",
	"dd",
	"div",
	"dl",
	"dt",
	"fieldset",
	"figcaption",
	"figure",
	"footer",
	"form",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"header",
	"hr",
	"li",
	"main",
	"nav",
	"ol",
	"p",
	"pre",
	"section",
	"table",
	"tbody",
	"tfoot",
	"thead",
	"tr",
	"ul"
]);

/** The named character references that turn up in ordinary pages. */
const NAMED = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	copy: "©",
	reg: "®",
	trade: "™",
	mdash: "—",
	ndash: "–",
	hellip: "…",
	lsquo: "‘",
	rsquo: "’",
	ldquo: "“",
	rdquo: "”",
	bull: "•",
	middot: "·"
};

const NAME = /[a-z][a-z0-9]*/y;

/**
 * Decode the character references of a text.
 * @param {string} text - Text with `&amp;`, `&#38;` or `&#x26;` forms.
 * @returns {string} Text with them replaced; a reference that is not known stays as written.
 */
export function decode(text) {
	return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,8});/gi, (whole, ref) => {
		if (ref[0] !== "#") return NAMED[ref.toLowerCase()] ?? whole;
		const code = ref[1].toLowerCase() === "x" ? Number.parseInt(ref.slice(2), 16) : Number.parseInt(ref.slice(1), 10);
		return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : whole;
	});
}

/**
 * Collapse the white space of a text: runs of spaces become one, lines are trimmed and no more than one blank line is kept.
 * @param {string} text - Text.
 * @returns {string} Tidy text.
 */
function tidy(text) {
	return text
		.replace(/[^\S\n]+/g, " ")
		.replace(/ ?\n ?/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * The text of an HTML document and its title.
 * @param {string} html - Markup.
 * @returns {{text: string, title: string | null}} Readable text, and the `<title>` (null when there is none or it is empty).
 */
export function htmlToText(html) {
	// Lower-cased without changing any length, so an index into one is an index into the other.
	const lower = html.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));
	let title = null;
	let out = "";
	let at = 0;
	/** Start a new line unless one has just started; the indentation of pretty-printed markup before it is dropped. */
	const lineBreak = () => {
		let end = out.length;
		while (end > 0 && out[end - 1] !== "\n" && /\s/.test(out[end - 1])) end--;
		out = out.slice(0, end);
		if (!out.endsWith("\n")) out += "\n";
	};
	for (;;) {
		const open = html.indexOf("<", at);
		if (open === -1) {
			out += html.slice(at);
			break;
		}
		out += html.slice(at, open);
		if (lower.startsWith("<!--", open)) {
			const close = html.indexOf("-->", open + 4);
			if (close === -1) break;
			at = close + 3;
			continue;
		}
		const closing = html[open + 1] === "/";
		NAME.lastIndex = open + (closing ? 2 : 1);
		const found = NAME.exec(lower);
		const end = html.indexOf(">", open);
		if (found === null) {
			// `<!doctype>`, `<?xml ?>` and stray `<` characters: markup is dropped, a lone `<` is text.
			if (html[open + 1] === "!" || html[open + 1] === "?") {
				if (end === -1) break;
				at = end + 1;
			} else {
				out += "<";
				at = open + 1;
			}
			continue;
		}
		if (end === -1) break;
		const name = found[0];
		at = end + 1;
		if (closing) {
			if (BLOCKS.has(name)) lineBreak();
			continue;
		}
		if (name === "title" && title === null) {
			const stop = lower.indexOf("</title", at);
			const raw = html.slice(at, stop === -1 ? html.length : stop);
			title = tidy(decode(raw.replace(/<[^>]*>/g, "").replace(/[<>]/g, ""))) || null;
		}
		if (HIDDEN.has(name)) {
			// The element's content is skipped up to its closing tag, or to the end when the page never closes it.
			const stop = lower.indexOf(`</${name}`, at);
			if (stop === -1) break;
			const after = html.indexOf(">", stop);
			if (after === -1) break;
			at = after + 1;
		} else if (BLOCKS.has(name)) lineBreak();
	}
	return { text: tidy(decode(out)), title };
}

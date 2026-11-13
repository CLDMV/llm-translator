/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/typed.mjs
 *	@Date: 2026-10-31T14:00:00-07:00 (1793480400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-31T14:00:00-07:00 (1793480400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Typed content chunks: flatten a message `content` array of typed chunks (Mistral reasoning models) into text and thinking.
 */

/**
 * Join the text of a chunk list or string (a `thinking` chunk holds a list of text chunks).
 * @param {any} part - A string, a chunk, or an array of those.
 * @returns {string} The text found.
 */
function join(part) {
	if (typeof part === "string") return part;
	if (Array.isArray(part)) return part.map(join).join("");
	return typeof part?.text === "string" ? part.text : "";
}

/**
 * Split typed content chunks into answer text and thinking. `{type:"text"}` chunks make the text, `{type:"thinking"}` chunks make the thinking
 * (their `thinking` field is a list of text chunks, or a string); other chunk types are skipped.
 * @param {any} content - Message or delta `content`.
 * @returns {{ text: string, thinking: string } | null} The parts, or null when `content` is not an array.
 */
export function flatten(content) {
	if (!Array.isArray(content)) return null;
	let text = "";
	let thinking = "";
	for (const part of content) {
		if (part?.type === "text") text += join(part);
		else if (part?.type === "thinking") thinking += join(part.thinking);
	}
	return { text, thinking };
}

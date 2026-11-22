/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/gemini-grounding.mjs
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
 * @fileoverview Gemini's grounding and citation metadata as the translator's neutral citations (`lib/citations.mjs`): `groundingMetadata` (the sources a search or retrieval used, and the supports that say which part of the answer each backs) and `citationMetadata` (the sources a reply quotes, with the span it quotes them at). Gemini counts spans in UTF-8 bytes, the neutral shape in JavaScript string indices, so offsets are converted here.
 * @module @cldmv/llm-translator/lib/gemini-grounding
 */
import { toAnnotation } from "./citations.mjs";

/**
 * The index in a string of a UTF-8 byte offset into it.
 * @param {string} text - The text.
 * @param {unknown} bytes - Byte offset (a number; anything else is 0).
 * @returns {number} String index, kept inside the text.
 */
function indexOf(text, bytes) {
	const wanted = Number.isFinite(bytes) ? Math.max(0, Number(bytes)) : 0;
	return Buffer.from(text).subarray(0, wanted).toString().length;
}

/**
 * Where a position of the visible text is in the message content, which also holds the text between parts (the code a part ran, for example).
 * @param {{text: string, at: number}[]} parts - The text parts, merged where they follow each other, with where each starts in the content.
 * @param {number} position - Index into the parts' text joined.
 * @param {boolean} end - Whether the position is the end of a span, which stays in the part it ends when that is where it falls.
 * @returns {number} Index into the content.
 */
function placed(parts, position, end) {
	let left = position;
	for (const part of parts) {
		if (left < part.text.length || (end && left === part.text.length)) return part.at + left;
		left -= part.text.length;
	}
	const last = parts.at(-1);
	return last.at + last.text.length;
}

/**
 * The source of a grounding chunk.
 * @param {any} chunk - `groundingChunks[]` entry.
 * @returns {any | null} Neutral citation without a span, or null for a chunk with no source.
 */
function sourceOf(chunk) {
	const web = chunk?.web ?? chunk?.maps;
	if (typeof web?.uri === "string")
		return { kind: "web", url: web.uri, ...(typeof web.title === "string" && web.title !== "" ? { title: web.title } : {}) };
	const context = chunk?.retrievedContext;
	if (context === null || typeof context !== "object") return null;
	const uri = typeof context.uri === "string" && context.uri !== "" ? context.uri : undefined;
	const title = typeof context.title === "string" && context.title !== "" ? { title: context.title } : {};
	const text = typeof context.text === "string" && context.text !== "" ? { text: context.text } : {};
	if (uri === undefined) return Object.keys(title).length + Object.keys(text).length === 0 ? null : { kind: "document", ...title, ...text };
	return /^https?:\/\//i.test(uri) ? { kind: "web", url: uri, ...title, ...text } : { kind: "document", source: uri, ...title, ...text };
}

/**
 * The neutral citations of a candidate's grounding and citation metadata, as Chat Completions annotations.
 * @param {{groundingMetadata?: any, citationMetadata?: any}} metadata - The candidate's metadata (the latest of each seen so far, for a stream).
 * @param {{text: string, at: number}[]} parts - The text parts of the reply (adjacent text parts merged), with where each starts in the content.
 * @returns {any[]} Annotations (`toAnnotation`), in the order of the text.
 */
export function annotationsOf(metadata, parts) {
	if (parts.length === 0) return [];
	const whole = parts.map((part) => part.text).join("");
	const found = [];
	const chunks = Array.isArray(metadata?.groundingMetadata?.groundingChunks) ? metadata.groundingMetadata.groundingChunks : [];
	for (const support of Array.isArray(metadata?.groundingMetadata?.groundingSupports) ? metadata.groundingMetadata.groundingSupports : []) {
		const segment = support?.segment;
		if (segment === null || typeof segment !== "object") continue;
		// A segment is in the text of the part it names; with no part, in the whole text.
		const part = Number.isInteger(segment.partIndex) ? parts[segment.partIndex] : undefined;
		const span =
			part === undefined
				? { start: placed(parts, indexOf(whole, segment.startIndex), false), end: placed(parts, indexOf(whole, segment.endIndex), true) }
				: { start: part.at + indexOf(part.text, segment.startIndex), end: part.at + indexOf(part.text, segment.endIndex) };
		for (const at of Array.isArray(support.groundingChunkIndices) ? support.groundingChunkIndices : []) {
			const source = sourceOf(chunks[at]);
			if (source !== null) found.push({ ...source, span });
		}
	}
	const cited = metadata?.citationMetadata;
	for (const source of Array.isArray(cited?.citationSources)
		? cited.citationSources
		: Array.isArray(cited?.citations)
			? cited.citations
			: []) {
		if (typeof source?.uri !== "string" || source.uri === "") continue;
		found.push({
			kind: "web",
			url: source.uri,
			...(typeof source.title === "string" && source.title !== "" ? { title: source.title } : {}),
			...(typeof source.license === "string" && source.license !== "" ? { source: source.license } : {}),
			span: { start: placed(parts, indexOf(whole, source.startIndex), false), end: placed(parts, indexOf(whole, source.endIndex), true) }
		});
	}
	return found.sort((left, right) => left.span.start - right.span.start).map((citation) => toAnnotation(citation));
}

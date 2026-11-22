/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/citations.mjs
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
 * @fileoverview A provider-neutral citation shape and the helpers that map it to and from each protocol's own: Anthropic `citations` on text blocks (and `citations_delta`), Chat Completions `annotations`, and Responses `output_text` annotations. Every converter pivots through Chat Completions, so the neutral citation travels in `message.annotations` (and `delta.annotations` in a stream) next to the standard `url_citation` an OpenAI client reads; a provider that has its own citation data (Cohere, Gemini grounding) only has to produce neutral citations.
 * @module @cldmv/llm-translator/lib/citations
 */

/** Key a converter puts on a Chat Completions content part to say which request source (an Anthropic `document` or `search_result` block) the part came from. The property is not enumerable, so the part serializes, compares and logs as it always did; a copy of the part (a spread) does not carry it. */
export const SOURCE = Symbol.for("llmt.source");

/**
 * The neutral citation. `kind` says what was cited: `web` (a URL), `document` (a document the request carried) or `search_result` (a
 * `search_result` block). Offsets are JavaScript string indices (UTF-16 code units); a provider that counts bytes converts them first.
 * @typedef {object} Citation
 * @property {"web" | "document" | "search_result"} kind - What was cited.
 * @property {string} [text] - The cited text of the source.
 * @property {string} [title] - Title of the source.
 * @property {string} [url] - URL of a `web` source.
 * @property {string} [source] - The `source` of a `search_result`, or the name a provider gave the source.
 * @property {string} [id] - Provider id of the source (a file id, Anthropic's `encrypted_index`).
 * @property {number} [index] - Position of the document (`document_index`) or search result (`search_result_index`) among the request's.
 * @property {{ type: "char" | "page" | "block", start: number, end: number }} [location] - Where in the source the cited text is (end is exclusive).
 * @property {{ start: number, end: number }} [span] - Where in the reply text the citation applies.
 */

/**
 * The request source a converter tags a content part with (see `SOURCE`).
 * @typedef {object} Source
 * @property {"document" | "search_result"} kind - The block type.
 * @property {number} index - Position among the request's blocks of that type.
 * @property {string} [title] - Title.
 * @property {string} [source] - A search result's `source`.
 * @property {boolean} citations - Whether the block asked for citations (`citations.enabled`).
 * @property {number} [blocks] - How many content blocks a search result has.
 */

/**
 * Tag a content part with the request source it came from.
 * @template T
 * @param {T} part - Chat Completions content part.
 * @param {Source} source - The source.
 * @returns {T} The same part.
 */
export function tag(part, source) {
	Object.defineProperty(part, SOURCE, { value: source, enumerable: false, writable: true, configurable: true });
	return part;
}

/**
 * The request source a content part was tagged with.
 * @param {any} part - Chat Completions content part.
 * @returns {Source | undefined} The source, or undefined for an untagged part.
 */
export function sourceOf(part) {
	return part?.[SOURCE];
}

/**
 * Drop the keys whose value is undefined, so a citation compares equal to one written out by hand.
 * @param {Record<string, any>} object - Object.
 * @returns {any} The object without undefined values.
 */
function clean(object) {
	return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

/** @param {any} value - Candidate. @returns {boolean} True for a non-null, non-array object. */
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** @param {any} value - Candidate. @returns {boolean} True for an `http` or `https` URL. */
const isUrl = (value) => typeof value === "string" && /^https?:\/\//i.test(value);

/**
 * The neutral citation of an Anthropic citation object.
 * @param {any} citation - `char_location`, `page_location`, `content_block_location`, `web_search_result_location` or `search_result_location`.
 * @returns {Citation | null} The citation, or null for a type this does not know.
 */
export function fromAnthropic(citation) {
	if (!isObject(citation)) return null;
	const document = (location) =>
		clean({
			kind: "document",
			text: citation.cited_text,
			title: citation.document_title ?? undefined,
			index: citation.document_index,
			id: citation.file_id,
			location
		});
	switch (citation.type) {
		case "char_location":
			return document({ type: "char", start: citation.start_char_index, end: citation.end_char_index });
		case "page_location":
			return document({ type: "page", start: citation.start_page_number, end: citation.end_page_number });
		case "content_block_location":
			return document({ type: "block", start: citation.start_block_index, end: citation.end_block_index });
		case "web_search_result_location":
			return clean({
				kind: "web",
				text: citation.cited_text,
				title: citation.title ?? undefined,
				url: citation.url,
				id: citation.encrypted_index
			});
		case "search_result_location":
			return clean({
				kind: "search_result",
				text: citation.cited_text,
				title: citation.title ?? undefined,
				source: citation.source,
				index: citation.search_result_index,
				location: { type: "block", start: citation.start_block_index, end: citation.end_block_index }
			});
		default:
			return null;
	}
}

/**
 * The Anthropic citation object of a neutral citation. A `web` citation is a `web_search_result_location` and a `search_result` one a
 * `search_result_location`; a `document` one is a `page_location` or `content_block_location` when its location says so and a `char_location`
 * otherwise (a source with no location is the whole text: characters 0 to its length). Fields the provider did not give are empty (`cited_text`,
 * `encrypted_index`) or zero (indexes).
 * @param {Citation} citation - Neutral citation.
 * @returns {any} Anthropic citation.
 */
export function toAnthropic(citation) {
	const where = citation.location;
	if (citation.kind === "web") {
		return {
			type: "web_search_result_location",
			cited_text: citation.text ?? "",
			url: citation.url ?? "",
			title: citation.title ?? null,
			encrypted_index: citation.id ?? ""
		};
	}
	if (citation.kind === "search_result") {
		return {
			type: "search_result_location",
			cited_text: citation.text ?? "",
			source: citation.source ?? citation.url ?? "",
			title: citation.title ?? null,
			search_result_index: citation.index ?? 0,
			start_block_index: where?.start ?? 0,
			end_block_index: where?.end ?? 1
		};
	}
	const base = { cited_text: citation.text ?? "", document_index: citation.index ?? 0, document_title: citation.title ?? null };
	if (where?.type === "page") return { type: "page_location", ...base, start_page_number: where.start, end_page_number: where.end };
	if (where?.type === "block")
		return { type: "content_block_location", ...base, start_block_index: where.start, end_block_index: where.end };
	return { type: "char_location", ...base, start_char_index: where?.start ?? 0, end_char_index: where?.end ?? citation.text?.length ?? 0 };
}

/**
 * The URL a citation can be shown with: its `url`, or the `source` of a search result when that is a URL.
 * @param {Citation} citation - Neutral citation.
 * @returns {string | undefined} The URL.
 */
function urlOf(citation) {
	return citation.url ?? (citation.kind === "search_result" && isUrl(citation.source) ? citation.source : undefined);
}

/**
 * Read the neutral citation an annotation carries: the one under its `citation` key, else the standard form it knows (`url_citation`).
 * @param {any} annotation - Chat Completions or Responses annotation.
 * @returns {Citation | null} The citation, or null for an annotation that is not one.
 */
function read(annotation) {
	if (!isObject(annotation)) return null;
	if (isObject(annotation.citation)) return annotation.citation.kind === undefined ? null : { ...annotation.citation };
	return null;
}

/**
 * The neutral citation of a Chat Completions annotation: the neutral citation the translator put under `citation` when it made the annotation,
 * else the standard `url_citation` (its `start_index` and `end_index` are the span).
 * @param {any} annotation - Chat Completions annotation.
 * @returns {Citation | null} The citation, or null for an annotation this does not know.
 */
export function fromAnnotation(annotation) {
	const own = read(annotation);
	if (own !== null) return own;
	const url = annotation?.type === "url_citation" ? annotation.url_citation : null;
	if (!isObject(url)) return null;
	return clean({ kind: "web", url: url.url, title: url.title || undefined, span: { start: url.start_index, end: url.end_index } });
}

/**
 * The Chat Completions annotation of a neutral citation: a standard `url_citation` when the source has a URL (so an OpenAI client reads it),
 * and a `citation` annotation otherwise. Both carry the neutral citation under `citation`, which the translator reads back.
 * @param {Citation} citation - Neutral citation.
 * @returns {any} Annotation.
 */
export function toAnnotation(citation) {
	const url = urlOf(citation);
	if (url === undefined) return { type: "citation", citation };
	return {
		type: "url_citation",
		url_citation: { start_index: citation.span?.start ?? 0, end_index: citation.span?.end ?? 0, title: citation.title ?? "", url },
		citation
	};
}

/**
 * The neutral citation of a Responses `output_text` annotation: the neutral citation under `citation`, else `url_citation` (a web source),
 * `file_citation` (a document with the file's id and name; `index` is where in the text it applies) or `container_file_citation`.
 * @param {any} annotation - Responses annotation.
 * @returns {Citation | null} The citation, or null for an annotation that is not one (`file_path`).
 */
export function fromResponses(annotation) {
	const own = read(annotation);
	if (own !== null) return own;
	if (!isObject(annotation)) return null;
	if (annotation.type === "url_citation") {
		return clean({
			kind: "web",
			url: annotation.url,
			title: annotation.title || undefined,
			span: { start: annotation.start_index, end: annotation.end_index }
		});
	}
	if (annotation.type === "file_citation") {
		return clean({
			kind: "document",
			id: annotation.file_id,
			title: annotation.filename || undefined,
			span: { start: annotation.index, end: annotation.index }
		});
	}
	if (annotation.type === "container_file_citation") {
		return clean({
			kind: "document",
			id: annotation.file_id,
			title: annotation.filename || undefined,
			span: { start: annotation.start_index, end: annotation.end_index }
		});
	}
	return null;
}

/**
 * The Responses annotation of a neutral citation: `url_citation` for a source with a URL, `file_citation` for one with a file id, and a
 * `citation` annotation otherwise. Each carries the neutral citation under `citation`.
 * @param {Citation} citation - Neutral citation.
 * @returns {any} Annotation.
 */
export function toResponses(citation) {
	const url = urlOf(citation);
	if (url !== undefined) {
		return {
			type: "url_citation",
			start_index: citation.span?.start ?? 0,
			end_index: citation.span?.end ?? 0,
			url,
			title: citation.title ?? "",
			citation
		};
	}
	if (citation.id !== undefined) {
		return { type: "file_citation", file_id: citation.id, filename: citation.title ?? "", index: citation.span?.start ?? 0, citation };
	}
	return { type: "citation", citation };
}

/**
 * Neutral citations from a list of annotations.
 * @param {any} list - Annotations (anything that is not a list is none).
 * @param {(annotation: any) => Citation | null} [read] - The reader (`fromAnnotation` by default; `fromResponses` for Responses annotations).
 * @returns {Citation[]} The citations of the annotations that are one.
 */
export function readAll(list, read = fromAnnotation) {
	return (Array.isArray(list) ? list : []).map((annotation) => read(annotation)).filter((citation) => citation !== null);
}

/**
 * Neutral citations from the `citations` list of an Anthropic text block.
 * @param {any} list - The block's `citations` (null or missing is none).
 * @returns {Citation[]} The citations of the types this knows.
 */
export function readAnthropic(list) {
	return (Array.isArray(list) ? list : []).map((citation) => fromAnthropic(citation)).filter((citation) => citation !== null);
}

/**
 * Where a citation applies in a text: a range, or a point (the span is empty) that belongs to the text before it. A citation with no usable
 * span is a point at the end of the text.
 * @param {Citation} citation - Neutral citation.
 * @param {number} length - Length of the text.
 * @returns {{ start: number, end: number }} The clamped range; start equals end for a point.
 */
function rangeOf(citation, length) {
	const span = citation.span;
	if (!Number.isInteger(span?.start) || !Number.isInteger(span?.end) || span.end < span.start) return { start: length, end: length };
	const start = Math.min(Math.max(span.start, 0), length);
	return { start, end: Math.min(Math.max(span.end, 0), length) };
}

/**
 * Cut a reply text into the text blocks Anthropic would write for it: each run of overlapping spans is one block that carries the citations
 * of those spans, and the text between them is plain blocks. A point citation (an empty span, or none) goes on the block that holds the
 * character before it, and no span at all means the end of the text, so the last block.
 * @param {string} text - The reply text.
 * @param {Citation[]} citations - Citations with spans in the text.
 * @returns {{ text: string, citations: Citation[] }[]} Blocks that join back to the text; none for an empty text.
 */
export function segments(text, citations) {
	if (text === "") return [];
	const ranged = [];
	const points = [];
	for (const citation of citations) {
		const range = rangeOf(citation, text.length);
		(range.end > range.start ? ranged : points).push({ citation, ...range });
	}
	ranged.sort((left, right) => left.start - right.start || left.end - right.end);
	const out = [];
	let at = 0;
	for (let i = 0; i < ranged.length;) {
		const start = ranged[i].start;
		let end = ranged[i].end;
		const group = [ranged[i++].citation];
		for (; i < ranged.length && ranged[i].start < end; i++) {
			end = Math.max(end, ranged[i].end);
			group.push(ranged[i].citation);
		}
		if (start > at) out.push({ text: text.slice(at, start), start: at, citations: [] });
		out.push({ text: text.slice(start, end), start, citations: group });
		at = end;
	}
	if (at < text.length) out.push({ text: text.slice(at), start: at, citations: [] });
	for (const point of points) {
		out.find((block) => point.start - 1 < block.start + block.text.length).citations.push(point.citation);
	}
	return out.map(({ text: piece, citations: list }) => ({ text: piece, citations: list }));
}

/**
 * Join text blocks into one text and give each block's citations their span in it.
 * @param {{ text: string, citations?: Citation[] }[]} blocks - Text blocks in order.
 * @returns {{ text: string, citations: Citation[] }} The joined text and the citations, each spanning the block it was on.
 */
export function join(blocks) {
	let text = "";
	const citations = [];
	for (const block of blocks) {
		for (const citation of block.citations ?? [])
			citations.push({ ...citation, span: { start: text.length, end: text.length + block.text.length } });
		text += block.text;
	}
	return { text, citations };
}

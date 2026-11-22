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
 * @property {string} [text] - A search result's own text (its content blocks joined), without the heading the part has.
 */
/**
 * Tag a content part with the request source it came from.
 * @template T
 * @param {T} part - Chat Completions content part.
 * @param {Source} source - The source.
 * @returns {T} The same part.
 */
export function tag<T>(part: T, source: Source): T;
/**
 * The request source a content part was tagged with.
 * @param {any} part - Chat Completions content part.
 * @returns {Source | undefined} The source, or undefined for an untagged part.
 */
export function sourceOf(part: any): Source | undefined;
/**
 * The neutral citation of an Anthropic citation object.
 * @param {any} citation - `char_location`, `page_location`, `content_block_location`, `web_search_result_location` or `search_result_location`.
 * @returns {Citation | null} The citation, or null for a type this does not know.
 */
export function fromAnthropic(citation: any): Citation | null;
/**
 * The Anthropic citation object of a neutral citation. A `web` citation is a `web_search_result_location` and a `search_result` one a
 * `search_result_location`; a `document` one is a `page_location` or `content_block_location` when its location says so and a `char_location`
 * otherwise (a source with no location is the whole text: characters 0 to its length). Fields the provider did not give are empty (`cited_text`,
 * `encrypted_index`) or zero (indexes).
 * @param {Citation} citation - Neutral citation.
 * @returns {any} Anthropic citation.
 */
export function toAnthropic(citation: Citation): any;
/**
 * The neutral citation of a Chat Completions annotation: the neutral citation the translator put under `citation` when it made the annotation,
 * else the standard `url_citation` (its `start_index` and `end_index` are the span).
 * @param {any} annotation - Chat Completions annotation.
 * @returns {Citation | null} The citation, or null for an annotation this does not know.
 */
export function fromAnnotation(annotation: any): Citation | null;
/**
 * The Chat Completions annotation of a neutral citation: a standard `url_citation` when the source has a URL (so an OpenAI client reads it),
 * and a `citation` annotation otherwise. Both carry the neutral citation under `citation`, which the translator reads back.
 * @param {Citation} citation - Neutral citation.
 * @returns {any} Annotation.
 */
export function toAnnotation(citation: Citation): any;
/**
 * The neutral citation of a Responses `output_text` annotation: the neutral citation under `citation`, else `url_citation` (a web source),
 * `file_citation` (a document with the file's id and name; `index` is where in the text it applies) or `container_file_citation`.
 * @param {any} annotation - Responses annotation.
 * @returns {Citation | null} The citation, or null for an annotation that is not one (`file_path`).
 */
export function fromResponses(annotation: any): Citation | null;
/**
 * The Responses annotation of a neutral citation: `url_citation` for a source with a URL, `file_citation` for one with a file id, and a
 * `citation` annotation otherwise. Each carries the neutral citation under `citation`.
 * @param {Citation} citation - Neutral citation.
 * @returns {any} Annotation.
 */
export function toResponses(citation: Citation): any;
/**
 * Neutral citations from a list of annotations.
 * @param {any} list - Annotations (anything that is not a list is none).
 * @param {(annotation: any) => Citation | null} [read] - The reader (`fromAnnotation` by default; `fromResponses` for Responses annotations).
 * @returns {Citation[]} The citations of the annotations that are one.
 */
export function readAll(list: any, read?: (annotation: any) => Citation | null): Citation[];
/**
 * Neutral citations from the `citations` list of an Anthropic text block.
 * @param {any} list - The block's `citations` (null or missing is none).
 * @returns {Citation[]} The citations of the types this knows.
 */
export function readAnthropic(list: any): Citation[];
/**
 * Cut a reply text into the text blocks Anthropic would write for it: each run of overlapping spans is one block that carries the citations
 * of those spans, and the text between them is plain blocks. A point citation (an empty span, or none) goes on the block that holds the
 * character before it, and no span at all means the end of the text, so the last block.
 * @param {string} text - The reply text.
 * @param {Citation[]} citations - Citations with spans in the text.
 * @returns {{ text: string, citations: Citation[] }[]} Blocks that join back to the text; none for an empty text.
 */
export function segments(text: string, citations: Citation[]): {
    text: string;
    citations: Citation[];
}[];
/**
 * Join text blocks into one text and give each block's citations their span in it.
 * @param {{ text: string, citations?: Citation[] }[]} blocks - Text blocks in order.
 * @returns {{ text: string, citations: Citation[] }} The joined text and the citations, each spanning the block it was on.
 */
export function join(blocks: {
    text: string;
    citations?: Citation[];
}[]): {
    text: string;
    citations: Citation[];
};
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
export const SOURCE: unique symbol;
/**
 * The neutral citation. `kind` says what was cited: `web` (a URL), `document` (a document the request carried) or `search_result` (a
 * `search_result` block). Offsets are JavaScript string indices (UTF-16 code units); a provider that counts bytes converts them first.
 */
export type Citation = {
    /**
     * - What was cited.
     */
    kind: "web" | "document" | "search_result";
    /**
     * - The cited text of the source.
     */
    text?: string;
    /**
     * - Title of the source.
     */
    title?: string;
    /**
     * - URL of a `web` source.
     */
    url?: string;
    /**
     * - The `source` of a `search_result`, or the name a provider gave the source.
     */
    source?: string;
    /**
     * - Provider id of the source (a file id, Anthropic's `encrypted_index`).
     */
    id?: string;
    /**
     * - Position of the document (`document_index`) or search result (`search_result_index`) among the request's.
     */
    index?: number;
    /**
     * - Where in the source the cited text is (end is exclusive).
     */
    location?: {
        type: "char" | "page" | "block";
        start: number;
        end: number;
    };
    /**
     * - Where in the reply text the citation applies.
     */
    span?: {
        start: number;
        end: number;
    };
};
/**
 * The request source a converter tags a content part with (see `SOURCE`).
 */
export type Source = {
    /**
     * - The block type.
     */
    kind: "document" | "search_result";
    /**
     * - Position among the request's blocks of that type.
     */
    index: number;
    /**
     * - Title.
     */
    title?: string;
    /**
     * - A search result's `source`.
     */
    source?: string;
    /**
     * - Whether the block asked for citations (`citations.enabled`).
     */
    citations: boolean;
    /**
     * - How many content blocks a search result has.
     */
    blocks?: number;
    /**
     * - A search result's own text (its content blocks joined), without the heading the part has.
     */
    text?: string;
};

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/citations.test.vitest.mjs
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
 * @fileoverview The neutral citation: Anthropic citation objects, Chat Completions and Responses annotations in both directions, request source tags, and cutting a text into cited blocks and joining them back.
 */
import { describe, expect, it } from "vitest";
import {
	fromAnnotation,
	fromAnthropic,
	fromResponses,
	join,
	readAll,
	readAnthropic,
	segments,
	sourceOf,
	tag,
	toAnnotation,
	toAnthropic,
	toResponses
} from "../../src/lib/citations.mjs";

const char = { type: "char_location", cited_text: "abc", document_index: 1, document_title: "Doc", start_char_index: 2, end_char_index: 5 };
const page = { type: "page_location", cited_text: "p", document_index: 0, document_title: null, start_page_number: 1, end_page_number: 3 };
const block = {
	type: "content_block_location",
	cited_text: "b",
	document_index: 2,
	document_title: "B",
	start_block_index: 0,
	end_block_index: 2
};
const web = { type: "web_search_result_location", cited_text: "w", url: "https://a.test/x", title: "A", encrypted_index: "enc" };
const result = {
	type: "search_result_location",
	cited_text: "s",
	source: "https://b.test",
	title: "S",
	search_result_index: 3,
	start_block_index: 1,
	end_block_index: 2
};

describe("Anthropic citations", () => {
	it("reads each citation type as a neutral citation", () => {
		expect(fromAnthropic(char)).toEqual({
			kind: "document",
			text: "abc",
			title: "Doc",
			index: 1,
			location: { type: "char", start: 2, end: 5 }
		});
		expect(fromAnthropic(page)).toEqual({ kind: "document", text: "p", index: 0, location: { type: "page", start: 1, end: 3 } });
		expect(fromAnthropic({ ...block, file_id: "f1" })).toEqual({
			kind: "document",
			text: "b",
			title: "B",
			index: 2,
			id: "f1",
			location: { type: "block", start: 0, end: 2 }
		});
		expect(fromAnthropic(web)).toEqual({ kind: "web", text: "w", title: "A", url: "https://a.test/x", id: "enc" });
		expect(fromAnthropic(result)).toEqual({
			kind: "search_result",
			text: "s",
			title: "S",
			source: "https://b.test",
			index: 3,
			location: { type: "block", start: 1, end: 2 }
		});
		expect(fromAnthropic({ ...web, title: null })).not.toHaveProperty("title");
		expect(fromAnthropic({ ...result, title: null })).not.toHaveProperty("title");
		for (const bad of [{ type: "other" }, null, "x", [], undefined]) expect(fromAnthropic(bad)).toBeNull();
	});

	it("writes each citation kind back, so every Anthropic type round trips", () => {
		for (const citation of [char, page, block, web, result]) {
			const neutral = fromAnthropic(citation);
			expect(toAnthropic(neutral)).toEqual(citation);
		}
	});

	it("fills what a provider did not give", () => {
		expect(toAnthropic({ kind: "web", url: "https://a.test" })).toEqual({
			type: "web_search_result_location",
			cited_text: "",
			url: "https://a.test",
			title: null,
			encrypted_index: ""
		});
		expect(toAnthropic({ kind: "web" })).toMatchObject({ url: "" });
		expect(toAnthropic({ kind: "search_result", url: "https://u.test" })).toEqual({
			type: "search_result_location",
			cited_text: "",
			source: "https://u.test",
			title: null,
			search_result_index: 0,
			start_block_index: 0,
			end_block_index: 1
		});
		expect(toAnthropic({ kind: "search_result" })).toMatchObject({ source: "" });
		expect(toAnthropic({ kind: "document", text: "four" })).toEqual({
			type: "char_location",
			cited_text: "four",
			document_index: 0,
			document_title: null,
			start_char_index: 0,
			end_char_index: 4
		});
		expect(toAnthropic({ kind: "document" })).toMatchObject({ cited_text: "", end_char_index: 0 });
	});

	it("reads the citations of a text block, and nothing from a missing or bad list", () => {
		expect(readAnthropic([char, { type: "x" }, web])).toHaveLength(2);
		expect(readAnthropic(null)).toEqual([]);
		expect(readAnthropic(undefined)).toEqual([]);
	});
});

describe("Chat Completions annotations", () => {
	it("reads a standard url_citation, with its indexes as the span", () => {
		expect(
			fromAnnotation({ type: "url_citation", url_citation: { start_index: 3, end_index: 9, title: "T", url: "https://a.test" } })
		).toEqual({
			kind: "web",
			url: "https://a.test",
			title: "T",
			span: { start: 3, end: 9 }
		});
		expect(fromAnnotation({ type: "url_citation", url_citation: { start_index: 0, end_index: 1, title: "", url: "u" } })).toEqual({
			kind: "web",
			url: "u",
			span: { start: 0, end: 1 }
		});
		for (const bad of [{ type: "other" }, { type: "url_citation" }, null, "x", { type: "citation", citation: {} }, { citation: "x" }]) {
			expect(fromAnnotation(bad)).toBeNull();
		}
	});

	it("writes a url_citation for a source with a URL, carrying the neutral citation", () => {
		const web = { kind: "web", url: "https://a.test", title: "A", span: { start: 1, end: 4 } };
		const out = toAnnotation(web);
		expect(out).toEqual({
			type: "url_citation",
			url_citation: { start_index: 1, end_index: 4, title: "A", url: "https://a.test" },
			citation: web
		});
		expect(fromAnnotation(out)).toEqual(web);
		const found = { kind: "search_result", source: "https://b.test", index: 2 };
		expect(toAnnotation(found)).toMatchObject({
			type: "url_citation",
			url_citation: { start_index: 0, end_index: 0, title: "", url: "https://b.test" }
		});
	});

	it("writes a citation annotation for a source with no URL, which reads back whole", () => {
		const doc = {
			kind: "document",
			title: "D",
			index: 1,
			text: "t",
			location: { type: "page", start: 1, end: 2 },
			span: { start: 0, end: 5 }
		};
		const out = toAnnotation(doc);
		expect(out).toEqual({ type: "citation", citation: doc });
		expect(fromAnnotation(out)).toEqual(doc);
		expect(toAnnotation({ kind: "search_result", source: "not a url" })).toMatchObject({ type: "citation" });
		expect(toAnnotation({ kind: "search_result" })).toMatchObject({ type: "citation" });
	});

	it("reads a list, leaving out what is not a citation", () => {
		const list = [toAnnotation({ kind: "web", url: "https://a.test" }), { type: "other" }, null];
		expect(readAll(list)).toHaveLength(1);
		expect(readAll(undefined)).toEqual([]);
		expect(readAll("x")).toEqual([]);
	});
});

describe("Responses annotations", () => {
	it("reads url_citation, file_citation and container_file_citation", () => {
		expect(fromResponses({ type: "url_citation", start_index: 2, end_index: 6, url: "https://a.test", title: "T" })).toEqual({
			kind: "web",
			url: "https://a.test",
			title: "T",
			span: { start: 2, end: 6 }
		});
		expect(fromResponses({ type: "url_citation", start_index: 0, end_index: 1, url: "u", title: "" })).toEqual({
			kind: "web",
			url: "u",
			span: { start: 0, end: 1 }
		});
		expect(fromResponses({ type: "file_citation", file_id: "file-1", filename: "a.pdf", index: 7 })).toEqual({
			kind: "document",
			id: "file-1",
			title: "a.pdf",
			span: { start: 7, end: 7 }
		});
		expect(fromResponses({ type: "file_citation", file_id: "file-1", filename: "", index: 0 })).toEqual({
			kind: "document",
			id: "file-1",
			span: { start: 0, end: 0 }
		});
		expect(
			fromResponses({ type: "container_file_citation", container_id: "c", file_id: "f", filename: "x.txt", start_index: 1, end_index: 3 })
		).toEqual({
			kind: "document",
			id: "f",
			title: "x.txt",
			span: { start: 1, end: 3 }
		});
		expect(fromResponses({ type: "container_file_citation", file_id: "f", filename: "", start_index: 1, end_index: 3 })).not.toHaveProperty(
			"title"
		);
		for (const bad of [{ type: "file_path", file_id: "f", index: 0 }, null, "x", { type: "citation", citation: {} }])
			expect(fromResponses(bad)).toBeNull();
	});

	it("writes url_citation, file_citation or a citation annotation, and reads them back", () => {
		const web = { kind: "web", url: "https://a.test", title: "A", span: { start: 1, end: 4 } };
		expect(toResponses(web)).toEqual({
			type: "url_citation",
			start_index: 1,
			end_index: 4,
			url: "https://a.test",
			title: "A",
			citation: web
		});
		expect(toResponses({ kind: "search_result", source: "https://s.test" })).toMatchObject({
			type: "url_citation",
			start_index: 0,
			end_index: 0,
			title: ""
		});
		const file = { kind: "document", id: "file-1", title: "a.pdf", span: { start: 5, end: 9 } };
		expect(toResponses(file)).toEqual({ type: "file_citation", file_id: "file-1", filename: "a.pdf", index: 5, citation: file });
		expect(toResponses({ kind: "document", id: "f" })).toMatchObject({ filename: "", index: 0 });
		const doc = { kind: "document", index: 0, title: "D" };
		expect(toResponses(doc)).toEqual({ type: "citation", citation: doc });
		for (const citation of [web, file, doc]) expect(fromResponses(toResponses(citation))).toEqual(citation);
		expect(readAll([toResponses(web), { type: "file_path" }], fromResponses)).toHaveLength(1);
	});
});

describe("request source tags", () => {
	it("tags a content part with its source without changing how it serializes or compares", () => {
		const part = tag({ type: "text", text: "x" }, { kind: "document", index: 2, citations: true });
		expect(sourceOf(part)).toEqual({ kind: "document", index: 2, citations: true });
		expect(JSON.stringify(part)).toBe('{"type":"text","text":"x"}');
		expect(part).toEqual({ type: "text", text: "x" });
		expect(sourceOf({ ...part })).toBeUndefined();
		expect(sourceOf({ type: "text" })).toBeUndefined();
		expect(sourceOf(undefined)).toBeUndefined();
	});
});

describe("segments and join", () => {
	const cite = (start, end, name = "c") => ({ kind: "web", url: name, span: { start, end } });
	const shape = (list) => list.map((entry) => [entry.text, entry.citations.map((citation) => citation.url)]);

	it("is plain text without citations, and nothing for no text", () => {
		expect(segments("", [cite(0, 1)])).toEqual([]);
		expect(segments("hello", [])).toEqual([{ text: "hello", citations: [] }]);
	});

	it("cuts the text at the spans of the citations", () => {
		expect(shape(segments("Hello big world", [cite(6, 9, "a")]))).toEqual([
			["Hello ", []],
			["big", ["a"]],
			[" world", []]
		]);
		expect(shape(segments("Hello big world", [cite(0, 5, "a"), cite(10, 15, "b")]))).toEqual([
			["Hello", ["a"]],
			[" big ", []],
			["world", ["b"]]
		]);
		expect(shape(segments("abcdef", [cite(0, 3, "a"), cite(3, 6, "b")]))).toEqual([
			["abc", ["a"]],
			["def", ["b"]]
		]);
	});

	it("puts citations of overlapping or equal spans on one block", () => {
		expect(shape(segments("0123456789", [cite(2, 6, "a"), cite(4, 8, "b"), cite(2, 6, "c")]))).toEqual([
			["01", []],
			["234567", ["a", "c", "b"]],
			["89", []]
		]);
		expect(shape(segments("0123456789", [cite(4, 8, "b"), cite(2, 6, "a")])).map((entry) => entry[0])).toEqual(["01", "234567", "89"]);
		expect(shape(segments("0123456789", [cite(2, 9, "a"), cite(3, 5, "b")]))[1]).toEqual(["2345678", ["a", "b"]]);
	});

	it("clamps spans to the text, and puts a point or a citation with no span on the text before it", () => {
		expect(shape(segments("abc", [cite(-5, 99, "a")]))).toEqual([["abc", ["a"]]]);
		expect(shape(segments("abc", [cite(5, 9, "a")]))).toEqual([["abc", ["a"]]]);
		expect(shape(segments("abcdef", [cite(0, 3, "a"), cite(3, 3, "p")]))).toEqual([
			["abc", ["a", "p"]],
			["def", []]
		]);
		expect(shape(segments("abcdef", [cite(0, 3, "a"), cite(5, 5, "p")]))).toEqual([
			["abc", ["a"]],
			["def", ["p"]]
		]);
		expect(shape(segments("abcdef", [cite(0, 0, "z")]))).toEqual([["abcdef", ["z"]]]);
		expect(shape(segments("abcdef", [cite(0, 3, "a"), { kind: "web", url: "n" }]))).toEqual([
			["abc", ["a"]],
			["def", ["n"]]
		]);
		expect(shape(segments("abcdef", [{ kind: "web", url: "bad", span: { start: 4, end: 2 } }]))).toEqual([["abcdef", ["bad"]]]);
		expect(shape(segments("abcdef", [{ kind: "web", url: "bad", span: { start: "x", end: 2 } }]))).toEqual([["abcdef", ["bad"]]]);
	});

	it("joins blocks back, each citation spanning its block", () => {
		const out = join([{ text: "Hello " }, { text: "big", citations: [{ kind: "web", url: "a" }] }, { text: " world", citations: [] }]);
		expect(out).toEqual({ text: "Hello big world", citations: [{ kind: "web", url: "a", span: { start: 6, end: 9 } }] });
		expect(join([])).toEqual({ text: "", citations: [] });
	});

	it("cutting and joining are inverses for citations on whole blocks", () => {
		const blocks = segments("one two three", [cite(4, 7, "a")]);
		expect(join(blocks)).toEqual({ text: "one two three", citations: [cite(4, 7, "a")] });
	});
});

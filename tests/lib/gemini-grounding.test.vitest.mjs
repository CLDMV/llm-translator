/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/gemini-grounding.test.vitest.mjs
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
 * @fileoverview Gemini's grounding and citation metadata as annotations: sources of every kind, spans from UTF-8 bytes to string positions, parts, code between parts, and what is skipped.
 */
import { describe, expect, it } from "vitest";
import { annotationsOf } from "../../src/lib/gemini-grounding.mjs";
import { fromAnnotation } from "../../src/lib/citations.mjs";

const one = (text, at = 0) => [{ text, at }];
const support = (start, end, indices, extra = {}) => ({
	segment: { startIndex: start, endIndex: end, ...extra },
	groundingChunkIndices: indices
});
const citations = (annotations) => annotations.map((annotation) => fromAnnotation(annotation));

describe("grounding", () => {
	it("a web source backs a span of the text: a url_citation an OpenAI client reads, with the neutral citation under it", () => {
		const metadata = {
			groundingMetadata: {
				groundingChunks: [{ web: { uri: "https://a.example/x", title: "A" } }, { web: { uri: "https://b.example" } }],
				groundingSupports: [support(0, 5, [0, 1])]
			}
		};
		const out = annotationsOf(metadata, one("Hello world"));
		expect(out).toHaveLength(2);
		expect(out[0]).toEqual({
			type: "url_citation",
			url_citation: { start_index: 0, end_index: 5, title: "A", url: "https://a.example/x" },
			citation: { kind: "web", url: "https://a.example/x", title: "A", span: { start: 0, end: 5 } }
		});
		expect(citations(out)[1]).toEqual({ kind: "web", url: "https://b.example", span: { start: 0, end: 5 } });
	});

	it("maps places like web sources, and retrieved contexts by their address", () => {
		const metadata = {
			groundingMetadata: {
				groundingChunks: [
					{ maps: { uri: "https://maps.example/p", title: "Place" } },
					{ retrievedContext: { uri: "https://docs.example/d", title: "Doc", text: "quoted" } },
					{ retrievedContext: { uri: "gs://bucket/file.pdf", title: "File", text: "from the file" } },
					{ retrievedContext: { uri: "gs://bucket/bare" } },
					{ retrievedContext: { title: "No address", text: "t" } },
					{ retrievedContext: { title: "Only a title" } },
					{ retrievedContext: { text: "only text" } },
					{ retrievedContext: { uri: "", title: "", text: "" } },
					{ retrievedContext: "x" },
					{ web: { uri: "https://t.example", title: "" } },
					{},
					null
				],
				groundingSupports: [support(0, 2, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 99])]
			}
		};
		expect(citations(annotationsOf(metadata, one("abcdef"))).map((entry) => ({ ...entry, span: undefined }))).toEqual([
			{ kind: "web", url: "https://maps.example/p", title: "Place" },
			{ kind: "web", url: "https://docs.example/d", title: "Doc", text: "quoted" },
			{ kind: "document", source: "gs://bucket/file.pdf", title: "File", text: "from the file" },
			{ kind: "document", source: "gs://bucket/bare" },
			{ kind: "document", title: "No address", text: "t" },
			{ kind: "document", title: "Only a title" },
			{ kind: "document", text: "only text" },
			{ kind: "web", url: "https://t.example" }
		]);
	});

	it("counts the span in UTF-8 bytes and gives it in string positions", () => {
		const text = "é😀 ok";
		const bytes = Buffer.from("é😀 ").length;
		const metadata = {
			groundingMetadata: { groundingChunks: [{ web: { uri: "https://u" } }], groundingSupports: [support(bytes, bytes + 2, [0])] }
		};
		expect(citations(annotationsOf(metadata, one(text)))[0].span).toEqual({ start: text.indexOf("ok"), end: text.length });
		const outside = {
			groundingMetadata: { groundingChunks: [{ web: { uri: "https://u" } }], groundingSupports: [support(500, 900, [0])] }
		};
		expect(citations(annotationsOf(outside, one("short")))[0].span).toEqual({ start: 5, end: 5 });
		const bad = {
			groundingMetadata: {
				groundingChunks: [{ web: { uri: "https://u" } }],
				groundingSupports: [{ segment: {}, groundingChunkIndices: [0] }, support("x", -4, [0])]
			}
		};
		expect(citations(annotationsOf(bad, one("abc"))).map((entry) => entry.span)).toEqual([
			{ start: 0, end: 0 },
			{ start: 0, end: 0 }
		]);
	});

	it("puts spans in the content when other text sits between the parts, and a span in the part it names", () => {
		// The content is "AAA" + a code block of 6 characters + "BBBB": the two text parts start at 0 and 9.
		const parts = [
			{ text: "AAA", at: 0 },
			{ text: "BBBB", at: 9 }
		];
		const metadata = {
			groundingMetadata: {
				groundingChunks: [{ web: { uri: "https://u" } }],
				groundingSupports: [
					support(2, 3, [0]),
					support(3, 5, [0]),
					support(1, 3, [0], { partIndex: 1 }),
					support(0, 1, [0], { partIndex: 7 }),
					support(6, 7, [0])
				]
			}
		};
		expect(citations(annotationsOf(metadata, parts)).map((entry) => entry.span)).toEqual([
			{ start: 0, end: 1 },
			{ start: 2, end: 3 },
			{ start: 9, end: 11 },
			{ start: 10, end: 12 },
			{ start: 12, end: 13 }
		]);
	});

	it("takes the spans of citation sources too, under either name, with the licence as the source", () => {
		const gemini = {
			citationMetadata: {
				citationSources: [
					{ startIndex: 2, endIndex: 4, uri: "https://quoted.example", license: "MIT" },
					{ startIndex: 0, endIndex: 1, uri: "" },
					null,
					{ uri: "https://bare.example" }
				]
			}
		};
		expect(citations(annotationsOf(gemini, one("abcdef")))).toEqual([
			{ kind: "web", url: "https://bare.example", span: { start: 0, end: 0 } },
			{ kind: "web", url: "https://quoted.example", source: "MIT", span: { start: 2, end: 4 } }
		]);
		const vertex = { citationMetadata: { citations: [{ startIndex: 1, endIndex: 3, uri: "https://v.example", title: "V", license: "" }] } };
		expect(citations(annotationsOf(vertex, one("abcdef")))).toEqual([
			{ kind: "web", url: "https://v.example", title: "V", span: { start: 1, end: 3 } }
		]);
	});

	it("is empty with no metadata, no text, or nothing that is a source, and sorts by where the text is", () => {
		expect(annotationsOf({}, one("x"))).toEqual([]);
		expect(annotationsOf(undefined, one("x"))).toEqual([]);
		expect(
			annotationsOf(
				{ groundingMetadata: { groundingChunks: [{ web: { uri: "https://u" } }], groundingSupports: [support(0, 1, [0])] } },
				[]
			)
		).toEqual([]);
		expect(annotationsOf({ groundingMetadata: { groundingSupports: "x", groundingChunks: "x" }, citationMetadata: {} }, one("x"))).toEqual(
			[]
		);
		expect(
			annotationsOf(
				{
					groundingMetadata: {
						groundingChunks: [{ web: { uri: "https://u" } }],
						groundingSupports: [null, "x", { segment: "x" }, { segment: {}, groundingChunkIndices: "x" }]
					}
				},
				one("x")
			)
		).toEqual([]);
		const late = {
			groundingMetadata: {
				groundingChunks: [{ web: { uri: "https://a" } }, { web: { uri: "https://b" } }],
				groundingSupports: [support(4, 5, [1]), support(0, 1, [0])]
			}
		};
		expect(citations(annotationsOf(late, one("abcdef"))).map((entry) => entry.url)).toEqual(["https://a", "https://b"]);
	});
});

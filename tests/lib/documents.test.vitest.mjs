/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/documents.test.vitest.mjs
 *	@Date: 2026-10-25T12:20:50-07:00 (1792956050)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:04-07:00 (1792958344)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { afterEach, describe, expect, test } from "vitest";
import { expand } from "../../src/lib/documents.mjs";
import * as pdf from "../../src/lib/pdf.mjs";
import { resolve } from "../../src/lib/settings.mjs";
import { makePdf, pdfBase64 } from "../helpers/pdf.mjs";

const ctx = (settings = {}, extra = {}) => ({ settings: resolve(settings), toolInputs: new Map(), toolUseId: null, ...extra });
const pdfBlock = (pages, extra = {}, title) => ({
	type: "document",
	source: { type: "base64", media_type: "application/pdf", data: pdfBase64(pages, title) },
	...extra
});

describe("documents.expand", () => {
	afterEach(() => pdf.load());

	test("documentConverter overrides everything", async () => {
		const seen = [];
		const converter = async (block, c) => {
			seen.push([block.type, c.settings.documents]);
			return [{ type: "text", text: "custom" }];
		};
		expect(await expand({ type: "document" }, ctx({ documentConverter: converter, documents: "error" }))).toEqual([
			{ type: "text", text: "custom" }
		]);
		expect(seen).toEqual([["document", "error"]]);
	});

	test("documents: error throws", async () => {
		await expect(expand(pdfBlock(["a"]), ctx({ documents: "error" }))).rejects.toMatchObject({ code: "unsupported_document" });
	});

	test("documents: note", async () => {
		const out = await expand(pdfBlock(["a"], { title: "Spec" }), ctx({ documents: "note" }));
		expect(out).toEqual([
			{ type: "text", text: '[The document "Spec" could not be read by this model. document conversion is disabled.]' }
		]);
	});

	test("text sources keep title and context", async () => {
		expect(
			await expand({ type: "document", title: "T", context: "C", source: { type: "text", media_type: "text/plain", data: "body" } }, ctx())
		).toEqual([{ type: "text", text: '<document title="T">\nC\n\nbody\n</document>' }]);
		expect(await expand({ type: "document", source: { type: "text", data: "body" } }, ctx())).toEqual([
			{ type: "text", text: "<document>\nbody\n</document>" }
		]);
	});

	test("content sources convert directly", async () => {
		expect(await expand({ type: "document", source: { type: "content", content: "hello" } }, ctx())).toEqual([
			{ type: "text", text: "hello" }
		]);
		const blocks = [{ type: "text", text: "x" }];
		expect(await expand({ type: "document", source: { type: "content", content: blocks } }, ctx())).toBe(blocks);
	});

	test("base64 plain text is decoded", async () => {
		const data = Buffer.from("plain body").toString("base64");
		expect(await expand({ type: "document", source: { type: "base64", media_type: "text/plain", data } }, ctx())).toEqual([
			{ type: "text", text: "<document>\nplain body\n</document>" }
		]);
	});

	test("URL and unsupported sources become notes", async () => {
		const url = await expand({ type: "document", title: "Remote", source: { type: "url", url: "https://x/y.pdf" } }, ctx());
		expect(url[0].text).toBe(
			'[The document "Remote" could not be read by this model. documents referenced by URL cannot be fetched by the translator.]'
		);
		const file = await expand({ type: "document", source: { type: "file", file_id: "f" } }, ctx());
		expect(file[0].text).toContain('"(unnamed)"');
		expect(file[0].text).toContain("document sources of type file are not supported");
		const docx = await expand({ type: "document", source: { type: "base64", media_type: "application/msword", data: "" } }, ctx());
		expect(docx[0].text).toContain("document sources of type base64 (application/msword) are not supported");
		const bare = await expand({ type: "document" }, ctx());
		expect(bare[0].text).toContain("document sources of type undefined are not supported");
	});

	test("PDF becomes per-page text plus page images", async () => {
		const out = await expand(pdfBlock(["First page text", "Page two"], { title: "Report" }), ctx());
		expect(out.map((b) => b.type)).toEqual(["text", "text", "image", "text", "image"]);
		expect(out[0].text).toBe('Document "Report" (2 pages)');
		expect(out[1].text).toBe("--- Page 1 ---\nFirst page text");
		expect(out[2].source).toMatchObject({ type: "base64", media_type: "image/png" });
		expect(out[3].text).toBe("--- Page 2 ---\nPage two");
	});

	test("PDF title falls back to the document metadata, then to nothing", async () => {
		expect((await expand(pdfBlock(["a"], {}, "Meta Title"), ctx({ images: false })))[0].text).toBe(
			'Document "Meta Title" (1 page)\n\n--- Page 1 ---\na'
		);
		expect((await expand(pdfBlock(["a"], {}, ""), ctx({ images: false })))[0].text).toBe("Document (1 page)\n\n--- Page 1 ---\na");
	});

	test("text only when images are off, pdf.pages is off, or canvas is unavailable", async () => {
		const block = pdfBlock(["a", "b"], { title: "T" });
		const expected = 'Document "T" (2 pages)\n\n--- Page 1 ---\na\n\n--- Page 2 ---\nb';
		expect(await expand(block, ctx({ images: false }))).toEqual([{ type: "text", text: expected }]);
		expect(await expand(block, ctx({ pdf: { pages: false } }))).toEqual([{ type: "text", text: expected }]);
		const real = await import("unpdf");
		await pdf.load(async (name) => {
			if (name === "unpdf") return real;
			throw new Error("no canvas");
		});
		expect(await expand(block, ctx())).toEqual([{ type: "text", text: expected }]);
	});

	test("maxImages limits the rendered pages", async () => {
		const out = await expand(pdfBlock(["a", "b", "c"], { title: "T" }), ctx({ pdf: { maxImages: 1 } }));
		expect(out.map((b) => b.type)).toEqual(["text", "text", "image", "text", "text"]);
	});

	test("a rendering failure keeps the page text", async () => {
		const real = await import("unpdf");
		const broken = {
			...real,
			renderPageAsImage: async () => {
				throw new Error("canvas broke");
			}
		};
		await pdf.load(async (name) => (name === "unpdf" ? broken : {}));
		const out = await expand(pdfBlock(["a"], { title: "T" }), ctx());
		expect(out.map((b) => b.type)).toEqual(["text", "text"]);
	});

	test("an unreadable PDF falls back to a note, with a pdftotext hint when the path is known", async () => {
		const block = {
			type: "document",
			source: { type: "base64", media_type: "application/pdf", data: Buffer.from("garbage").toString("base64") }
		};
		const plain = await expand(block, ctx());
		expect(plain[0].text).toMatch(/^\[The document "\(unnamed\)" could not be read by this model\. The PDF could not be read: .+\.\]$/);
		const toolInputs = new Map([["toolu_1", { file_path: "/data/report.pdf" }]]);
		const hinted = await expand(block, ctx({}, { toolInputs, toolUseId: "toolu_1" }));
		expect(hinted[0].text).toContain('"/data/report.pdf"');
		expect(hinted[0].text).toContain("To read it, run `pdftotext -layout /data/report.pdf -` with the shell tool.]");
		const noPath = await expand(block, ctx({}, { toolInputs, toolUseId: "toolu_2" }));
		expect(noPath[0].text).not.toContain("pdftotext");
	});

	test("an unavailable PDF library also falls back to a note", async () => {
		await pdf.load(async () => {
			throw new Error("x");
		});
		const out = await expand(pdfBlock(["a"]), ctx());
		expect(out[0].text).toContain("PDF support is unavailable");
	});

	test("limit violations are errors, not notes", async () => {
		await expect(expand(pdfBlock(["a", "b"]), ctx({ pdf: { maxPages: 1 } }))).rejects.toMatchObject({ code: "pdf_too_many_pages" });
		expect(makePdf(["a"]).length).toBeGreaterThan(0);
	});
});

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/pdf.test.vitest.mjs
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

import { afterAll, describe, expect, test } from "vitest";
import * as pdf from "../../src/lib/pdf.mjs";
import { makePdf } from "../helpers/pdf.mjs";

const limits = { maxPages: 100, maxBytes: 32 * 1024 * 1024 };

describe("pdf", () => {
	afterAll(() => pdf.load());

	test("loads lazily on first use", async () => {
		expect(pdf.available()).toEqual({ unpdf: false, canvas: false });
		const result = await pdf.extract(makePdf(["Hello PDF one", "Second page"], "Test Doc"), limits);
		expect(result).toEqual({ pageCount: 2, title: "Test Doc", pages: ["Hello PDF one", "Second page"] });
		expect(pdf.available()).toEqual({ unpdf: true, canvas: true });
	});

	test("load() reports availability and re-imports", async () => {
		expect(await pdf.load()).toEqual({ unpdf: true, canvas: true, errors: {} });
	});

	test("a document without a title yields null", async () => {
		expect((await pdf.extract(makePdf(["x"], ""), limits)).title).toBeNull();
	});

	test("enforces the byte and page limits with Anthropic-shaped errors", async () => {
		const bytes = makePdf(["a", "b"]);
		await expect(pdf.extract(bytes, { ...limits, maxBytes: 10 })).rejects.toMatchObject({
			code: "pdf_too_large",
			status: 413,
			type: "request_too_large"
		});
		await expect(pdf.extract(bytes, { ...limits, maxPages: 1 })).rejects.toMatchObject({
			code: "pdf_too_many_pages",
			status: 400,
			message: expect.stringContaining("maximum of 1 PDF pages")
		});
	});

	test("unreadable bytes raise pdf_unreadable", async () => {
		await expect(pdf.extract(new TextEncoder().encode("this is not a pdf"), limits)).rejects.toMatchObject({
			code: "pdf_unreadable",
			status: 400,
			details: { name: "InvalidPDFException" }
		});
	});

	test("renders selected pages to base64 PNG", async () => {
		const images = await pdf.render(makePdf(["a", "b", "c"]), [1, 3], { ...limits, scale: 1 });
		expect(images).toHaveLength(2);
		for (const image of images) {
			expect(image.media_type).toBe("image/png");
			expect(Buffer.from(image.data, "base64").subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
		}
	});

	test("render() honours the limits too", async () => {
		await expect(pdf.render(makePdf(["a"]), [1], { ...limits, maxBytes: 1, scale: 1 })).rejects.toMatchObject({ code: "pdf_too_large" });
	});

	test("without canvas, rendering fails clearly but text extraction still works", async () => {
		const real = await import("unpdf");
		const result = await pdf.load(async (name) => {
			if (name === "unpdf") return real;
			throw new Error("no canvas here");
		});
		expect(result).toEqual({ unpdf: true, canvas: false, errors: { canvas: "no canvas here" } });
		expect(pdf.available()).toEqual({ unpdf: true, canvas: false });
		await expect(pdf.render(makePdf(["a"]), [1], { ...limits, scale: 1 })).rejects.toMatchObject({ code: "pdf_unavailable", status: 501 });
		expect((await pdf.extract(makePdf(["still works"]), limits)).pages).toEqual(["still works"]);
	});

	test("without unpdf nothing works and the failure is explicit", async () => {
		const result = await pdf.load(async () => {
			throw new Error("boom");
		});
		expect(result).toEqual({ unpdf: false, canvas: false, errors: { unpdf: "boom", canvas: "boom" } });
		await expect(pdf.extract(makePdf(["a"]), limits)).rejects.toMatchObject({ code: "pdf_unavailable" });
		await expect(pdf.render(makePdf(["a"]), [1], { ...limits, scale: 1 })).rejects.toMatchObject({ code: "pdf_unavailable" });
	});
});

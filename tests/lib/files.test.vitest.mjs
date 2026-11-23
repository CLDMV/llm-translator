/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/files.test.vitest.mjs
 *	@Date: 2026-11-22T12:00:00-08:00 (1795464000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T12:00:00-08:00 (1795464000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { describe, expect, test } from "vitest";
import {
	BETA,
	PURPOSES,
	anthropicFile,
	anthropicList,
	beta,
	expiryOf,
	filenameOf,
	mimeOf,
	missing,
	openaiFile,
	openaiList,
	resolve,
	storeOf
} from "../../src/lib/files.mjs";
import { DEFAULTS, create } from "../../src/lib/filestore.mjs";

const meta = (n, extra = {}) => ({
	id: `file_${String(n).padStart(12, "0")}`,
	filename: `f${n}.pdf`,
	mime_type: "application/pdf",
	size: 100 + n,
	purpose: n % 2 === 0 ? "user_data" : "vision",
	created_at: 1700000000000 + n * 1000,
	expires_at: null,
	...extra
});
/** Newest first, like the store lists them. */
const metas = [5, 4, 3, 2, 1].map((n) => meta(n));
const id = (n) => meta(n).id;
const ids = (list) => list.data.map((entry) => entry.id);

describe("small helpers", () => {
	test("beta reads the anthropic-beta header, one value or many", () => {
		expect(beta(BETA)).toBe(true);
		expect(beta(`other, ${BETA}`)).toBe(true);
		expect(beta(["x", BETA])).toBe(true);
		expect(beta("other")).toBe(false);
		expect(beta(undefined)).toBe(false);
	});

	test("mimeOf takes the declared type, else the extension, else octet-stream", () => {
		expect(mimeOf("Text/Plain; charset=utf-8", "a.pdf")).toBe("text/plain");
		expect(mimeOf(undefined, "a.PDF")).toBe("application/pdf");
		expect(mimeOf(" ", "photo.jpeg")).toBe("image/jpeg");
		expect(mimeOf(undefined, "noext")).toBe("application/octet-stream");
	});

	test("missing words the not found error like the front", () => {
		expect(missing("anthropic", "file_x")).toMatchObject({
			status: 404,
			type: "not_found_error",
			code: "file_not_found",
			message: "File `file_x` not found."
		});
		expect(missing("openai", "file-x").message).toBe("No such File object: file-x");
	});

	test("filenameOf follows Anthropic's rule", () => {
		expect(filenameOf("report 2026.pdf")).toBe("report 2026.pdf");
		for (const bad of ["", "a".repeat(256), "a/b", "a<b", "a:b", 'a"b', "a|b", "a?b", "a*b", "a\\b", "a\u0001b", 5, undefined]) {
			expect(() => filenameOf(bad)).toThrow(expect.objectContaining({ status: 400, code: "invalid_filename" }));
		}
		expect(filenameOf("a".repeat(255))).toHaveLength(255);
	});

	test("expiryOf reads each front's fields and checks the range", () => {
		expect(expiryOf("anthropic", {})).toBeUndefined();
		expect(expiryOf("anthropic", { expires_in_seconds: "3600" })).toBe(3600);
		expect(expiryOf("anthropic", { expires_in_seconds: "7776000" })).toBe(7776000);
		expect(expiryOf("openai", { "expires_after[seconds]": "7200", "expires_after[anchor]": "created_at" })).toBe(7200);
		for (const bad of ["59", "7776001", "abc", "1.5"]) {
			expect(() => expiryOf("anthropic", { expires_in_seconds: bad })).toThrow(expect.objectContaining({ code: "invalid_expiry" }));
		}
		expect(() => expiryOf("openai", { "expires_after[seconds]": "2592001", "expires_after[anchor]": "created_at" })).toThrow(/2592000/);
		expect(() => expiryOf("openai", { "expires_after[seconds]": "3600" })).toThrow(
			expect.objectContaining({ param: "expires_after[anchor]" })
		);
	});

	test("the purposes are OpenAI's", () => {
		expect(PURPOSES).toContain("user_data");
	});
});

describe("file objects", () => {
	test("Anthropic's, current and beta", () => {
		const held = meta(1, { expires_at: 1700003600000 });
		expect(anthropicFile(held)).toEqual({
			id: held.id,
			type: "file",
			filename: "f1.pdf",
			mime_type: "application/pdf",
			size_bytes: 101,
			created_at: "2023-11-14T22:13:21.000Z",
			downloadable: false,
			expires_at: "2023-11-14T23:13:20.000Z"
		});
		expect(anthropicFile(meta(1)).expires_at).toBeNull();
		expect(anthropicFile(held, true)).not.toHaveProperty("expires_at");
	});

	test("OpenAI's", () => {
		expect(openaiFile(meta(1))).toEqual({
			id: id(1),
			object: "file",
			bytes: 101,
			created_at: 1700000001,
			filename: "f1.pdf",
			purpose: "vision",
			status: "processed"
		});
		expect(openaiFile(meta(1, { expires_at: 1700003600500 })).expires_at).toBe(1700003600);
	});
});

describe("Anthropic list", () => {
	test("defaults to 20, newest first, with a page cursor", () => {
		const all = anthropicList(metas, {}, false);
		expect(ids(all)).toEqual([5, 4, 3, 2, 1].map(id));
		expect(all.next_page).toBeNull();
		const first = anthropicList(metas, { limit: "2" }, false);
		expect(ids(first)).toEqual([id(5), id(4)]);
		expect(first.next_page).toBe(id(4));
		const second = anthropicList(metas, { limit: 2, page: first.next_page }, false);
		expect(ids(second)).toEqual([id(3), id(2)]);
		expect(anthropicList(metas, { limit: 2, page: second.next_page }, false)).toMatchObject({ next_page: null, data: [{ id: id(1) }] });
	});

	test("ids looks files up and leaves unknown ones out", () => {
		const out = anthropicList(metas, { ids: [id(2), "file_nope00000000", id(4)] }, false);
		expect(ids(out)).toEqual([id(4), id(2)]);
		expect(out.next_page).toBeNull();
		expect(() => anthropicList(metas, { ids: [id(2)], limit: 5 }, false)).toThrow(expect.objectContaining({ code: "invalid_ids" }));
		expect(() => anthropicList(metas, { ids: [id(2)], page: id(1) }, false)).toThrow(/page or limit/);
		expect(() => anthropicList(metas, { ids: [id(2)] }, true)).toThrow(expect.objectContaining({ code: "invalid_ids" }));
		expect(() => anthropicList(metas, { ids: Array.from({ length: 101 }, (_, n) => `file_${n}`) }, false)).toThrow(/at most 100/);
	});

	test("bad limits and cursors are 400s", () => {
		for (const limit of ["0", "1001", "x", "1.5"]) {
			expect(() => anthropicList(metas, { limit }, false)).toThrow(expect.objectContaining({ code: "invalid_limit", status: 400 }));
		}
		expect(anthropicList(metas, { limit: "1000" }, false).data).toHaveLength(5);
		expect(() => anthropicList(metas, { page: "file_nope00000000" }, false)).toThrow(
			expect.objectContaining({ code: "invalid_cursor", param: "page" })
		);
		expect(() => anthropicList(metas, { after_id: id(3) }, false)).toThrow(/beta/);
		expect(() => anthropicList(metas, { before_id: id(3) }, false)).toThrow(/beta/);
		expect(() => anthropicList(metas, { page: id(3) }, true)).toThrow(expect.objectContaining({ param: "page" }));
		expect(() => anthropicList(metas, { after_id: "file_nope00000000" }, true)).toThrow(expect.objectContaining({ param: "after_id" }));
		expect(() => anthropicList(metas, { before_id: "file_nope00000000" }, true)).toThrow(expect.objectContaining({ param: "before_id" }));
	});

	test("the beta shape pages with after_id and before_id and reports has_more", () => {
		const first = anthropicList(metas, { limit: 2 }, true);
		expect(first).toMatchObject({ has_more: true, first_id: id(5), last_id: id(4) });
		expect(first.data[0]).not.toHaveProperty("expires_at");
		const second = anthropicList(metas, { limit: 2, after_id: first.last_id }, true);
		expect(ids(second)).toEqual([id(3), id(2)]);
		expect(anthropicList(metas, { limit: 2, after_id: second.last_id }, true)).toMatchObject({
			has_more: false,
			first_id: id(1),
			last_id: id(1)
		});
		// before_id: the files newer than it, nearest first as a page.
		expect(ids(anthropicList(metas, { limit: 2, before_id: id(2) }, true))).toEqual([id(4), id(3)]);
		expect(ids(anthropicList(metas, { limit: 10, before_id: id(2) }, true))).toEqual([id(5), id(4), id(3)]);
		expect(anthropicList(metas, { before_id: id(5) }, true)).toEqual({ data: [], has_more: false, first_id: null, last_id: null });
		expect(anthropicList([], {}, true)).toEqual({ data: [], has_more: false, first_id: null, last_id: null });
	});
});

describe("OpenAI list", () => {
	test("returns the whole list newest first with the list shape", () => {
		const out = openaiList(metas, {});
		expect(out).toMatchObject({ object: "list", first_id: id(5), last_id: id(1), has_more: false });
		expect(out.data.map((entry) => entry.id)).toEqual([5, 4, 3, 2, 1].map(id));
		expect(openaiList([], {})).toEqual({ object: "list", data: [], first_id: null, last_id: null, has_more: false });
	});

	test("purpose, order, limit and after", () => {
		expect(openaiList(metas, { purpose: "user_data" }).data.map((entry) => entry.id)).toEqual([id(4), id(2)]);
		expect(openaiList(metas, { order: "asc", limit: "2" })).toMatchObject({ has_more: true, first_id: id(1), last_id: id(2) });
		expect(openaiList(metas, { order: "desc" }).first_id).toBe(id(5));
		expect(openaiList(metas, { after: id(4), limit: 1 })).toMatchObject({ first_id: id(3), has_more: true });
		expect(() => openaiList(metas, { order: "up" })).toThrow(expect.objectContaining({ code: "invalid_order" }));
		expect(() => openaiList(metas, { limit: "0" })).toThrow(expect.objectContaining({ code: "invalid_limit" }));
		expect(() => openaiList(metas, { limit: "10001" })).toThrow(/10000/);
		expect(() => openaiList(metas, { after: "file-nope00000000" })).toThrow(
			expect.objectContaining({ code: "invalid_cursor", param: "after" })
		);
	});
});

describe("storeOf", () => {
	test("is made once from the files setting, and is null when the setting is null", () => {
		const state = { files: undefined };
		const store = storeOf({ settings: {} }, state);
		expect(typeof store.put).toBe("function");
		expect(storeOf({ settings: {} }, state)).toBe(store);
		expect(storeOf({ settings: { files: null } }, { files: undefined })).toBeNull();
		expect(storeOf({ settings: { files: { maxCount: 3 } } }, { files: undefined })).not.toBeNull();
	});
});

describe("resolve", () => {
	const pdf = Buffer.from("%PDF-1.4 test");
	const png = Buffer.from([137, 80, 78, 71]);
	const txt = Buffer.from("plain");
	const setup = async () => {
		const store = create({ ...DEFAULTS });
		const put = (name, mimeType, data) => store.put({ id: `file_${name}`, filename: `${name}.bin`, mimeType, purpose: "user_data", data });
		await put("pdfpdfpdf", "application/pdf", pdf);
		await put("pngpngpng", "image/png", png);
		await put("txttxttxt", "text/plain", txt);
		await put("zipzipzip", "application/zip", Buffer.from("PK"));
		return store;
	};
	const user = (...content) => ({ model: "m", messages: [{ role: "user", content }] });
	const anthropic = (store, body, strict = true) => resolve(body, { front: "anthropic", store, strict });
	const openai = (store, body, strict = true) => resolve(body, { front: "openai", store, strict });
	const file = (file_id) => ({ type: "file", file_id });

	test("bodies without messages, and without references, come back as they are", async () => {
		const store = await setup();
		expect(await anthropic(store, undefined)).toBeUndefined();
		expect(await anthropic(store, { model: "m" })).toEqual({ model: "m" });
		const plain = {
			model: "m",
			messages: [
				{ role: "user", content: "hi" },
				{ role: "user", content: [{ type: "text", text: "x" }, null] }
			]
		};
		expect(await anthropic(store, plain)).toBe(plain);
		expect(await openai(store, plain)).toBe(plain);
	});

	test("Anthropic image and document file sources become base64, whatever the route", async () => {
		const store = await setup();
		const body = user(
			{ type: "text", text: "look" },
			{ type: "document", source: file("file_pdfpdfpdf"), title: "T" },
			{ type: "image", source: file("file_pngpngpng") },
			{ type: "document", source: file("file_txttxttxt") }
		);
		for (const strict of [true, false]) {
			const out = await anthropic(store, body, strict);
			expect(out.messages[0].content).toEqual([
				{ type: "text", text: "look" },
				{ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") }, title: "T" },
				{ type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } },
				{ type: "document", source: { type: "base64", media_type: "text/plain", data: txt.toString("base64") } }
			]);
		}
		expect(body.messages[0].content[1].source.type).toBe("file");
	});

	test("file sources inside a tool result are resolved too, and a file used twice is read once", async () => {
		const store = await setup();
		let reads = 0;
		const counting = { get: async (name) => (reads++, store.get(name)) };
		const body = user(
			{
				type: "tool_result",
				tool_use_id: "t",
				content: [
					{ type: "image", source: file("file_pngpngpng") },
					{ type: "text", text: "x" }
				]
			},
			{ type: "tool_result", tool_use_id: "u", content: "plain text result" },
			{ type: "tool_result", tool_use_id: "v", content: [{ type: "text", text: "no files here" }] },
			{ type: "image", source: file("file_pngpngpng") }
		);
		const out = await anthropic(counting, body);
		expect(out.messages[0].content[0].content[0].source.type).toBe("base64");
		expect(out.messages[0].content[3].source.type).toBe("base64");
		expect(out.messages[0].content[2]).toBe(body.messages[0].content[2]);
		expect(reads).toBe(1);
	});

	test("an unknown Anthropic file id is a 404 not_found_error when strict, and left alone when not", async () => {
		const store = await setup();
		const body = user({ type: "document", source: file("file_unknown0000") });
		await expect(anthropic(store, body)).rejects.toMatchObject({
			status: 404,
			code: "file_not_found",
			message: "File `file_unknown0000` not found."
		});
		expect(await anthropic(store, body, false)).toBe(body);
	});

	test("a file of the wrong kind for its block is a 400", async () => {
		const store = await setup();
		await expect(anthropic(store, user({ type: "image", source: file("file_pdfpdfpdf") }))).rejects.toMatchObject({
			status: 400,
			code: "invalid_file_type",
			message: expect.stringContaining("an image")
		});
		await expect(anthropic(store, user({ type: "document", source: file("file_pngpngpng") }))).rejects.toMatchObject({
			code: "invalid_file_type",
			message: expect.stringContaining("PDF or plain text")
		});
		await expect(anthropic(store, user({ type: "document", source: file("file_zipzipzip") }))).rejects.toMatchObject({
			code: "invalid_file_type"
		});
	});

	test("Anthropic blocks that are not file references are untouched", async () => {
		const store = await setup();
		const body = user(
			{ type: "image", source: { type: "base64", media_type: "image/png", data: "AA" } },
			{ type: "document", source: { type: "url", url: "https://x/y.pdf" } },
			{ type: "text", text: "t" }
		);
		expect(await anthropic(store, body)).toBe(body);
	});

	test("OpenAI file parts and image_url ids become data URLs", async () => {
		const store = await setup();
		const body = user(
			{ type: "text", text: "see" },
			{ type: "file", file: { file_id: "file_pdfpdfpdf" } },
			{ type: "file", file: { file_id: "file_txttxttxt", filename: "mine.txt" } },
			{ type: "image_url", image_url: { url: "file_pngpngpng", detail: "high" } }
		);
		const out = await openai(store, body);
		expect(out.messages[0].content).toEqual([
			{ type: "text", text: "see" },
			{ type: "file", file: { file_data: `data:application/pdf;base64,${pdf.toString("base64")}`, filename: "pdfpdfpdf.bin" } },
			{ type: "file", file: { file_data: `data:text/plain;base64,${txt.toString("base64")}`, filename: "mine.txt" } },
			{ type: "image_url", image_url: { url: `data:image/png;base64,${png.toString("base64")}`, detail: "high" } }
		]);
	});

	test("unknown OpenAI ids are a 404 in the OpenAI wording when strict, and forwarded otherwise", async () => {
		const store = await setup();
		const part = user({ type: "file", file: { file_id: "file-unknown00000" } });
		await expect(openai(store, part)).rejects.toMatchObject({ status: 404, message: "No such File object: file-unknown00000" });
		expect(await openai(store, part, false)).toBe(part);
		const image = user({ type: "image_url", image_url: { url: "file-unknown00000" } });
		await expect(openai(store, image)).rejects.toMatchObject({ code: "file_not_found" });
		expect(await openai(store, image, false)).toBe(image);
	});

	test("OpenAI parts that are not references are untouched; an image_url naming a non-image file is a 400", async () => {
		const store = await setup();
		const body = user(
			{ type: "file", file: { file_data: "data:application/pdf;base64,AA", filename: "x.pdf" } },
			{ type: "file" },
			{ type: "image_url", image_url: { url: "https://x/y.png" } },
			{ type: "image_url", image_url: { url: "data:image/png;base64,AA" } },
			{ type: "image_url" },
			{ type: "text", text: "t" }
		);
		expect(await openai(store, body)).toBe(body);
		await expect(openai(store, user({ type: "image_url", image_url: { url: "file_pdfpdfpdf" } }))).rejects.toMatchObject({
			code: "invalid_file_type"
		});
	});
});

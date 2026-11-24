/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/filestore.test.vitest.mjs
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

import { afterEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DEFAULTS, ID, create, newId, normalize } from "../../src/lib/filestore.mjs";

const dirs = [];
afterEach(() => {
	while (dirs.length > 0) fs.rmSync(dirs.pop(), { recursive: true, force: true });
});
const scratch = () => {
	fs.mkdirSync(path.join(process.cwd(), "tmp"), { recursive: true });
	const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp", "filestore-"));
	dirs.push(dir);
	return dir;
};

const upload = (id, extra = {}) => ({
	id,
	filename: "a.txt",
	mimeType: "text/plain",
	purpose: "user_data",
	data: Buffer.from("hello"),
	...extra
});
const ids = { a: "file_aaaaaaaaaaaa", b: "file_bbbbbbbbbbbb", c: "file_cccccccccccc" };

describe("the files setting", () => {
	test("null turns the Files API off; the defaults are an in-memory store", () => {
		expect(normalize(null)).toBeNull();
		expect(normalize({ ...DEFAULTS })).toEqual(DEFAULTS);
		expect(DEFAULTS).toMatchObject({ store: "memory", dir: null, ttl: 0 });
	});

	test.each([
		["a string", "x"],
		["an array", []],
		["an unknown key", { ...DEFAULTS, size: 1 }],
		["a store that does not exist", { ...DEFAULTS, store: "s3" }],
		["a disk store without a directory", { ...DEFAULTS, store: "disk" }],
		["a dir that is not a string", { ...DEFAULTS, dir: 5 }],
		["a max size of zero", { ...DEFAULTS, maxFileSize: 0 }],
		["a fractional total", { ...DEFAULTS, maxTotalBytes: 1.5 }],
		["a count that is not a number", { ...DEFAULTS, maxCount: "9" }],
		["a negative ttl", { ...DEFAULTS, ttl: -1 }]
	])("%s is invalid_setting", (_name, value) => {
		expect(() => normalize(value)).toThrow(expect.objectContaining({ code: "invalid_setting" }));
	});

	test("a disk store with a directory is valid", () => {
		expect(normalize({ ...DEFAULTS, store: "disk", dir: "/x" }).dir).toBe("/x");
	});
});

describe("ids", () => {
	test("the prefix follows the front and the id matches ID", () => {
		expect(newId("anthropic")).toMatch(/^file_[0-9a-f]{24}$/);
		expect(newId("openai")).toMatch(/^file-[0-9a-f]{24}$/);
		expect(ID.test(newId("openai"))).toBe(true);
		for (const bad of ["", "file", "file_", "file_../x", "../file_aaaaaaaaaaaa", "file_aaaa"]) expect(ID.test(bad)).toBe(false);
	});
});

const backends = [
	["memory", () => ({ ...DEFAULTS })],
	["disk", () => ({ ...DEFAULTS, store: "disk", dir: path.join(scratch(), "files") })]
];

describe.each(backends)("the %s store", (_name, options) => {
	test("stores, reads, lists newest first and deletes", async () => {
		let now = 1000;
		const store = create(options(), () => now);
		const first = await store.put(upload(ids.a));
		now = 2000;
		await store.put(upload(ids.b, { filename: "b.txt", data: Buffer.from("world!") }));
		now = 3000;
		await store.put(upload(ids.c));
		expect(first).toEqual({
			id: ids.a,
			filename: "a.txt",
			mime_type: "text/plain",
			size: 5,
			purpose: "user_data",
			created_at: 1000,
			expires_at: null
		});
		expect((await store.list()).map((meta) => meta.id)).toEqual([ids.c, ids.b, ids.a]);
		const got = await store.get(ids.b);
		expect(got.data.toString()).toBe("world!");
		expect(got.meta.size).toBe(6);
		expect((await store.head(ids.b)).filename).toBe("b.txt");
		expect(await store.remove(ids.b)).toBe(true);
		expect(await store.remove(ids.b)).toBe(false);
		expect(await store.get(ids.b)).toBeNull();
		expect(await store.head(ids.b)).toBeNull();
		expect((await store.list()).map((meta) => meta.id)).toEqual([ids.c, ids.a]);
	});

	test("an id that is not a file id never reaches the backend", async () => {
		const store = create(options());
		expect(await store.get("../../etc/passwd")).toBeNull();
		expect(await store.remove("../x")).toBe(false);
		expect(await store.get(ids.a)).toBeNull();
	});

	test("maxFileSize refuses a big file with 413", async () => {
		const store = create({ ...options(), maxFileSize: 4 });
		await expect(store.put(upload(ids.a))).rejects.toMatchObject({ status: 413, code: "file_too_large" });
		await expect(store.put(upload(ids.a, { data: Buffer.from("1234") }))).resolves.toMatchObject({ size: 4 });
	});

	test("maxCount and maxTotalBytes refuse more with 400 storage_limit_exceeded", async () => {
		const count = create({ ...options(), maxCount: 2 });
		await count.put(upload(ids.a));
		await count.put(upload(ids.b));
		await expect(count.put(upload(ids.c))).rejects.toMatchObject({
			status: 400,
			code: "storage_limit_exceeded",
			message: expect.stringContaining("2 files")
		});
		await count.remove(ids.a);
		await count.put(upload(ids.c));
		const bytes = create({ ...options(), maxTotalBytes: 9 });
		await bytes.put(upload(ids.a));
		await expect(bytes.put(upload(ids.b))).rejects.toMatchObject({
			code: "storage_limit_exceeded",
			message: expect.stringContaining("9 bytes")
		});
	});

	test("ttl and a file's own lifetime expire files, the shorter one winning; expired files are gone everywhere", async () => {
		let now = 0;
		const store = create({ ...options(), ttl: 100 }, () => now);
		const plain = await store.put(upload(ids.a));
		const short = await store.put(upload(ids.b, { expiresIn: 10 }));
		const long = await store.put(upload(ids.c, { expiresIn: 1000 }));
		expect([plain.expires_at, short.expires_at, long.expires_at]).toEqual([100000, 10000, 100000]);
		now = 10000;
		expect(await store.get(ids.b)).toBeNull();
		expect((await store.list()).map((meta) => meta.id).sort()).toEqual([ids.a, ids.c]);
		now = 100000;
		expect(await store.get(ids.a)).toBeNull();
		expect(await store.head(ids.c)).toBeNull();
		expect(await store.list()).toEqual([]);
	});

	test("a file without a lifetime of its own and no ttl never expires, and expiry frees room", async () => {
		let now = 0;
		const store = create({ ...options(), maxCount: 1 }, () => now);
		await store.put(upload(ids.a, { expiresIn: 5 }));
		now = 5000;
		await expect(store.put(upload(ids.b))).resolves.toMatchObject({ expires_at: null });
		now = 10 ** 12;
		expect((await store.get(ids.b)).meta.id).toBe(ids.b);
	});
});

describe("the disk store", () => {
	test("keeps files across stores on the same directory, and the directory is made", async () => {
		const dir = path.join(scratch(), "deep", "files");
		const first = create({ ...DEFAULTS, store: "disk", dir });
		await first.put(upload(ids.a));
		expect(fs.readdirSync(dir).sort()).toEqual([`${ids.a}.bin`, `${ids.a}.json`]);
		const second = create({ ...DEFAULTS, store: "disk", dir });
		expect((await second.get(ids.a)).data.toString()).toBe("hello");
	});

	test("files it did not write are ignored, and a read error other than a missing file is thrown", async () => {
		const dir = path.join(scratch(), "files");
		const store = create({ ...DEFAULTS, store: "disk", dir });
		await store.put(upload(ids.a));
		fs.writeFileSync(path.join(dir, "notes.txt"), "not a file of ours");
		expect((await store.list()).map((meta) => meta.id)).toEqual([ids.a]);
		fs.rmSync(path.join(dir, `${ids.b}.json`), { force: true });
		fs.mkdirSync(path.join(dir, `${ids.b}.json`));
		await expect(store.get(ids.b)).rejects.toMatchObject({ code: "EISDIR" });
	});
});

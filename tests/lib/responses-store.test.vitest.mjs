/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/responses-store.test.vitest.mjs
 *	@Date: 2026-11-23T12:00:00-08:00 (1795550400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-23T12:00:00-08:00 (1795550400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The response store: the `responses` setting, the memory and directory backends, limits, eviction, lifetime and serialized changes.
 */

import { afterEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DEFAULTS, IDS, create, normalize } from "../../src/lib/responses-store.mjs";

const dirs = [];
afterEach(() => {
	while (dirs.length > 0) fs.rmSync(dirs.pop(), { recursive: true, force: true });
});
const scratch = () => {
	fs.mkdirSync(path.join(process.cwd(), "tmp"), { recursive: true });
	const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp", "responses-store-"));
	dirs.push(dir);
	return dir;
};
const ids = { a: "resp_aaaaaaaaaaaa", b: "resp_bbbbbbbbbbbb", c: "resp_cccccccccccc" };
const conv = "conv_aaaaaaaaaaaa";

describe("the responses setting", () => {
	test("null turns stateful responses off; the defaults are an in-memory store", () => {
		expect(normalize(null)).toBeNull();
		expect(normalize({ ...DEFAULTS })).toEqual(DEFAULTS);
		expect(DEFAULTS).toMatchObject({ store: "memory", dir: null, ttl: 0, maxCount: 1000, maxConversations: 1000, maxItems: 10000 });
	});

	test.each([
		["a string", "x"],
		["an array", []],
		["an unknown key", { ...DEFAULTS, size: 1 }],
		["a store that does not exist", { ...DEFAULTS, store: "s3" }],
		["a disk store without a directory", { ...DEFAULTS, store: "disk" }],
		["a dir that is not a string", { ...DEFAULTS, dir: 5 }],
		["a count of zero", { ...DEFAULTS, maxCount: 0 }],
		["a fractional total", { ...DEFAULTS, maxTotalBytes: 1.5 }],
		["a conversation count that is not a number", { ...DEFAULTS, maxConversations: "9" }],
		["no item limit", { ...DEFAULTS, maxItems: 0 }],
		["a negative ttl", { ...DEFAULTS, ttl: -1 }]
	])("%s is invalid_setting", (_name, value) => {
		expect(() => normalize(value)).toThrow(expect.objectContaining({ code: "invalid_setting", status: 500 }));
	});

	test("a disk store with a directory is valid", () => {
		expect(normalize({ ...DEFAULTS, store: "disk", dir: "/x" }).dir).toBe("/x");
	});

	test("ids have the shape of their kind", () => {
		expect(IDS.response.test(ids.a)).toBe(true);
		expect(IDS.response.test(conv)).toBe(false);
		expect(IDS.conversation.test(conv)).toBe(true);
		expect(IDS.conversation.test("conv_../../x")).toBe(false);
	});
});

describe.each([
	["memory", () => ({ ...DEFAULTS })],
	["disk", () => ({ ...DEFAULTS, store: "disk", dir: scratch() })]
])("the %s store", (_name, make) => {
	test("puts, gets, updates and removes records of both kinds", async () => {
		const store = create(make());
		expect(await store.get("response", ids.a)).toBeNull();
		await store.put("response", ids.a, { n: 1 });
		await store.put("conversation", conv, { items: [] });
		expect(await store.get("response", ids.a)).toEqual({ n: 1 });
		expect(await store.get("conversation", conv)).toEqual({ items: [] });
		expect(await store.update("response", ids.a, (current) => ({ n: current.n + 1 }))).toEqual({ n: 2 });
		expect(await store.update("response", ids.a, () => undefined)).toEqual({ n: 2 });
		expect(await store.update("response", ids.b, () => undefined)).toBeNull();
		expect(await store.update("response", ids.b, (current) => ({ was: current }))).toEqual({ was: null });
		expect(await store.remove("response", ids.a)).toBe(true);
		expect(await store.remove("response", ids.a)).toBe(false);
		expect(await store.get("response", ids.a)).toBeNull();
	});

	test("an id of the wrong shape is unknown and never reaches the backend", async () => {
		const store = create(make());
		expect(await store.get("response", "../../etc/passwd")).toBeNull();
		expect(await store.get("response", conv)).toBeNull();
		expect(await store.remove("response", "resp_")).toBe(false);
	});

	test("changes to one record run one after the other", async () => {
		const store = create(make());
		await store.put("conversation", conv, { n: 0 });
		const bump = (current) => new Promise((resolve) => setTimeout(resolve, 5, { n: current.n + 1 }));
		await Promise.all([1, 2, 3].map(() => store.update("conversation", conv, bump)));
		expect(await store.get("conversation", conv)).toEqual({ n: 3 });
		// A change that fails does not block the ones after it.
		await expect(
			store.update("conversation", conv, () => {
				throw new Error("no");
			})
		).rejects.toThrow("no");
		expect(await store.update("conversation", conv, (current) => ({ n: current.n + 1 }))).toEqual({ n: 4 });
	});

	test("evicts the oldest responses over the count, and the oldest conversations over theirs", async () => {
		const store = create({ ...make(), maxCount: 2, maxConversations: 1 });
		for (const id of Object.values(ids)) await store.put("response", id, { id });
		expect(await store.get("response", ids.a)).toBeNull();
		expect(await store.get("response", ids.b)).toEqual({ id: ids.b });
		expect(await store.get("response", ids.c)).toEqual({ id: ids.c });
		// A rewrite makes a record the newest.
		await store.put("response", ids.b, { id: ids.b, again: true });
		await store.put("response", ids.a, { id: ids.a });
		expect(await store.get("response", ids.c)).toBeNull();
		await store.put("conversation", conv, { n: 1 });
		await store.put("conversation", "conv_bbbbbbbbbbbb", { n: 2 });
		expect(await store.get("conversation", conv)).toBeNull();
		expect(await store.get("conversation", "conv_bbbbbbbbbbbb")).toEqual({ n: 2 });
	});

	test("evicts the oldest responses over the byte limit, but keeps the newest even when it alone is over", async () => {
		const store = create({ ...make(), maxTotalBytes: 70 });
		await store.put("response", ids.a, { text: "x".repeat(20) });
		await store.put("response", ids.b, { text: "y".repeat(20) });
		expect(await store.get("response", ids.a)).not.toBeNull();
		await store.put("response", ids.c, { text: "z".repeat(20) });
		expect(await store.get("response", ids.a)).toBeNull();
		expect(await store.get("response", ids.b)).not.toBeNull();
		await store.put("response", ids.a, { text: "w".repeat(200) });
		expect(await store.get("response", ids.a)).toEqual({ text: "w".repeat(200) });
		expect(await store.get("response", ids.b)).toBeNull();
		expect(await store.get("response", ids.c)).toBeNull();
	});

	test("a record past its ttl is gone, and a write sweeps the expired ones", async () => {
		let clock = 1_000_000;
		const store = create({ ...make(), ttl: 10 }, () => clock);
		await store.put("response", ids.a, { n: 1 });
		await store.put("response", ids.b, { n: 2 });
		clock += 9_000;
		expect(await store.get("response", ids.a)).toEqual({ n: 1 });
		clock += 2_000;
		expect(await store.get("response", ids.a)).toBeNull();
		// ids.b expired too: the next write removes it without anyone asking for it.
		await store.put("response", ids.c, { n: 3 });
		expect(await store.remove("response", ids.b)).toBe(false);
		expect(await store.get("response", ids.c)).toEqual({ n: 3 });
	});
});

describe("the disk store", () => {
	test("keeps records across a restart and counts them against the limits", async () => {
		const dir = scratch();
		let clock = 1_000_000;
		const first = create({ ...DEFAULTS, store: "disk", dir }, () => clock);
		await first.put("response", ids.a, { n: 1 });
		await first.put("conversation", conv, { n: 2 });
		expect(fs.readdirSync(path.join(dir, "response"))).toEqual([`${ids.a}.json`]);
		// Files in the directory that are not records are left alone.
		fs.writeFileSync(path.join(dir, "response", "notes.txt"), "x");
		fs.writeFileSync(path.join(dir, "response", "resp_x.json"), "{}");
		const second = create({ ...DEFAULTS, store: "disk", dir, maxCount: 1 });
		expect(await second.get("response", ids.a)).toEqual({ n: 1 });
		expect(await second.get("conversation", conv)).toEqual({ n: 2 });
		expect(await second.get("response", "resp_x")).toBeNull();
		await second.put("response", ids.b, { n: 3 });
		expect(await second.get("response", ids.a)).toBeNull();
		expect(fs.existsSync(path.join(dir, "response", `${ids.a}.json`))).toBe(false);
		expect(fs.existsSync(path.join(dir, "response", "notes.txt"))).toBe(true);
	});

	test("restores the order records were written in", async () => {
		const dir = scratch();
		const first = create({ ...DEFAULTS, store: "disk", dir });
		await first.put("response", ids.a, { n: 1 });
		fs.utimesSync(path.join(dir, "response", `${ids.a}.json`), new Date(1000), new Date(1000));
		await first.put("response", ids.b, { n: 2 });
		const second = create({ ...DEFAULTS, store: "disk", dir, maxCount: 2 });
		await second.put("response", ids.c, { n: 3 });
		expect(await second.get("response", ids.a)).toBeNull();
		expect(await second.get("response", ids.b)).toEqual({ n: 2 });
	});

	test("a record whose file went missing is unknown, and a file that cannot be read is an error", async () => {
		const dir = scratch();
		const store = create({ ...DEFAULTS, store: "disk", dir });
		await store.put("response", ids.a, { n: 1 });
		fs.rmSync(path.join(dir, "response", `${ids.a}.json`));
		expect(await store.get("response", ids.a)).toBeNull();
		fs.mkdirSync(path.join(dir, "response", `${ids.b}.json`));
		const again = create({ ...DEFAULTS, store: "disk", dir });
		await expect(again.get("response", ids.b)).rejects.toMatchObject({ code: "EISDIR" });
	});
});

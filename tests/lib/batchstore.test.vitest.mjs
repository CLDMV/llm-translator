/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/batchstore.test.vitest.mjs
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
import { DEFAULTS, ID, TERMINAL, create, newId, normalize } from "../../src/lib/batchstore.mjs";
import { resolve } from "../../src/lib/settings.mjs";
import { semaphore } from "../../src/lib/batch-run.mjs";

const dirs = [];
afterEach(() => {
	while (dirs.length > 0) fs.rmSync(dirs.pop(), { recursive: true, force: true });
});
const scratch = () => {
	fs.mkdirSync(path.join(process.cwd(), "tmp"), { recursive: true });
	const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp", "batchstore-"));
	dirs.push(dir);
	return dir;
};

const record = (id, extra = {}) => ({ id, state: "completed", created_at: 1000, keep_until: null, ...extra });
const ids = { a: "batch_aaaaaaaaaaaa", b: "batch_bbbbbbbbbbbb", c: "msgbatch_cccccccccccc" };

describe("the batches setting", () => {
	test("null turns both Batch APIs off; the defaults are an in-memory store", () => {
		expect(normalize(null)).toBeNull();
		expect(normalize({ ...DEFAULTS })).toEqual(DEFAULTS);
		expect(DEFAULTS).toMatchObject({ store: "memory", dir: null, concurrency: 4, window: 86400, ttl: 2505600 });
	});

	test("merges key by key through the settings layers, and null turns it off", () => {
		expect(resolve().batches).toEqual(DEFAULTS);
		expect(resolve({ batches: { concurrency: 8 } }, { batches: { ttl: 60 } }).batches).toMatchObject({
			concurrency: 8,
			ttl: 60,
			maxCount: 1000
		});
		expect(resolve({ batches: null }).batches).toBeNull();
		expect(resolve({ batches: null }, { batches: { maxCount: 2 } }).batches).toMatchObject({ store: "memory", maxCount: 2 });
		expect(resolve({ batches: { store: "disk", dir: "/x" } }).batches.dir).toBe("/x");
		expect(() => resolve({ batches: { concurrency: 0 } })).toThrow(/batches.concurrency/);
		expect(DEFAULTS.maxCount).toBe(1000);
	});

	test.each([
		["a string", "x"],
		["an array", []],
		["an unknown key", { ...DEFAULTS, size: 1 }],
		["a store that does not exist", { ...DEFAULTS, store: "s3" }],
		["a disk store without a directory", { ...DEFAULTS, store: "disk" }],
		["a dir that is not a string", { ...DEFAULTS, dir: 5 }],
		["a concurrency of zero", { ...DEFAULTS, concurrency: 0 }],
		["a fractional request limit", { ...DEFAULTS, maxRequests: 1.5 }],
		["a count that is not a number", { ...DEFAULTS, maxCount: "9" }],
		["a window of zero", { ...DEFAULTS, window: 0 }],
		["a negative ttl", { ...DEFAULTS, ttl: -1 }]
	])("%s is invalid_setting", (_name, value) => {
		expect(() => normalize(value)).toThrow(expect.objectContaining({ code: "invalid_setting", status: 500 }));
	});
});

describe("ids", () => {
	test("have the front's prefix and match ID; terminal states are the four that end a batch", () => {
		expect(newId("openai")).toMatch(/^batch_[0-9a-f]{24}$/);
		expect(newId("anthropic")).toMatch(/^msgbatch_[0-9a-f]{24}$/);
		expect(ID.test(newId("openai"))).toBe(true);
		expect(ID.test("file_aaaaaaaaaaaa")).toBe(false);
		expect(TERMINAL).toEqual(["completed", "failed", "expired", "cancelled"]);
	});
});

describe.each([
	["memory", () => ({ ...DEFAULTS })],
	["disk", () => ({ ...DEFAULTS, store: "disk", dir: scratch() })]
])("the %s store", (_kind, options) => {
	test("adds, reads, lists newest first and removes", async () => {
		const store = create(options());
		await store.add(record(ids.a, { created_at: 1 }));
		await store.add(record(ids.b, { created_at: 2 }));
		expect((await store.get(ids.a)).id).toBe(ids.a);
		expect(await store.get("nope")).toBeNull();
		expect(await store.get(ids.c)).toBeNull();
		expect((await store.list()).map((entry) => entry.id)).toEqual([ids.b, ids.a]);
		expect(await store.remove(ids.a)).toBe(true);
		expect(await store.remove(ids.a)).toBe(false);
		expect(await store.remove("../x")).toBe(false);
		expect((await store.list()).map((entry) => entry.id)).toEqual([ids.b]);
	});

	test("hands out the live object of a batch in progress until it is saved as ended", async () => {
		const store = create(options());
		const running = record(ids.a, { state: "in_progress" });
		await store.add(running);
		expect(await store.get(ids.a)).toBe(running);
		expect((await store.list())[0]).toBe(running);
		expect(await store.orphans()).toEqual([]);
		await store.save(running);
		expect(await store.get(ids.a)).toBe(running);
		running.state = "completed";
		await store.save(running);
		expect((await store.get(ids.a)).state).toBe("completed");
	});

	test("drops a finished batch past its retention, and keeps one in progress", async () => {
		let clock = 100;
		const store = create(options(), () => clock);
		await store.add(record(ids.a, { keep_until: 200 }));
		await store.add(record(ids.b, { state: "in_progress", keep_until: 150 }));
		clock = 250;
		expect((await store.list()).map((entry) => entry.id)).toEqual([ids.b]);
		await store.add(record(ids.c, { keep_until: 200 }));
		expect(await store.get(ids.c)).toBeNull();
		expect(await store.get(ids.a)).toBeNull();
	});

	test("makes room with the oldest finished batch, and refuses when all are in progress", async () => {
		const store = create({ ...options(), maxCount: 2 });
		await store.add(record(ids.a, { created_at: 1 }));
		await store.add(record(ids.b, { created_at: 2 }));
		await store.add(record(ids.c, { created_at: 3 }));
		expect((await store.list()).map((entry) => entry.id)).toEqual([ids.c, ids.b]);
		const busy = create({ ...options(), maxCount: 1 });
		await busy.add(record(ids.a, { state: "in_progress" }));
		await expect(busy.add(record(ids.b))).rejects.toMatchObject({ code: "storage_limit_exceeded", status: 400 });
	});
});

describe("the disk store", () => {
	test("keeps what it saved for another store, and finds batches left in progress", async () => {
		const options = { ...DEFAULTS, store: "disk", dir: scratch() };
		const first = create(options);
		await first.add(record(ids.a, { state: "in_progress" }));
		await first.add(record(ids.b));
		fs.writeFileSync(path.join(options.dir, "notes.txt"), "not a batch");
		const second = create(options);
		expect((await second.get(ids.b)).state).toBe("completed");
		expect((await second.orphans()).map((entry) => entry.id)).toEqual([ids.a]);
		await expect(create({ ...options, dir: path.join(options.dir, "no", "such") }).get(ids.a)).resolves.toBeNull();
	});

	test("reports a read that fails for another reason than a missing file", async () => {
		const options = { ...DEFAULTS, store: "disk", dir: scratch() };
		fs.writeFileSync(path.join(options.dir, `${ids.a}.json`), "{not json");
		await expect(create(options).get(ids.a)).rejects.toThrow();
	});
});

describe("the slot semaphore", () => {
	test("hands a released slot to the longest waiter and lets a waiter that is aborted leave", async () => {
		const slots = semaphore(1);
		const live = new AbortController();
		const leaving = new AbortController();
		expect(await slots.acquire(live.signal)).toBe(true);
		const second = slots.acquire(live.signal);
		const third = slots.acquire(leaving.signal);
		const fourth = slots.acquire(live.signal);
		leaving.abort();
		expect(await third).toBe(false);
		slots.release();
		expect(await second).toBe(true);
		slots.release();
		expect(await fourth).toBe(true);
		slots.release();
		expect(await slots.acquire(live.signal)).toBe(true);
	});
});

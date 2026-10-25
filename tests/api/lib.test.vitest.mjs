/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/lib.test.vitest.mjs
 *	@Date: 2026-10-25T12:22:51-07:00 (1792956171)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T14:05:41-07:00 (1792962341)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { describe, expect, it } from "vitest";
import { endpoint, normalize } from "../../src/lib/config.mjs";
import * as http from "../../src/lib/http.mjs";
import { atLeast, noEmptyTools, semver } from "../../src/lib/normalize.mjs";
import { withPings } from "../../src/lib/ping.mjs";
import { pick, serves } from "../../src/lib/route.mjs";
import { warn } from "../../src/lib/warn.mjs";
import { estimate } from "../../src/lib/estimate.mjs";
import { fetchModels } from "../../src/lib/models.mjs";
import { fakeTransport } from "../helpers/translator.mjs";

describe("lib/config", () => {
	it("normalizes endpoints and defaults", () => {
		const config = normalize({ upstreams: ["http://a.test/", { url: "http://b.test", models: ["x"], settings: { topK: false } }] });
		expect(config).toMatchObject({ front: "anthropic", aliases: {}, settings: {}, detect: true, detectTimeout: 5000, silent: false });
		expect(config.endpoints[0]).toMatchObject({
			name: "upstream-0",
			url: "http://a.test",
			backend: "auto",
			models: undefined,
			default: false
		});
		expect(config.endpoints[1]).toMatchObject({ name: "upstream-1", models: ["x"], settings: { topK: false } });
		expect(normalize({ upstreams: ["http://a.test"], detect: false, silent: true, detectTimeout: 10 })).toMatchObject({
			detect: false,
			silent: true,
			detectTimeout: 10
		});
		expect(endpoint("http://z.test", 3).name).toBe("upstream-3");
	});
});

describe("lib/http", () => {
	it("builds auth headers", () => {
		const ep = { headers: { a: "1" }, apiKey: "k" };
		expect(http.headers(ep)).toEqual({ a: "1", authorization: "Bearer k" });
		expect(http.headers(ep, "x-api-key", { b: "2" })).toEqual({ a: "1", "x-api-key": "k", b: "2" });
		expect(http.headers({ headers: {} })).toEqual({});
	});

	it("lowercases Headers objects and plain objects", () => {
		expect(http.plain(new Headers({ "Retry-After": "3" }))).toEqual({ "retry-after": "3" });
		expect(http.plain({ "X-A": 1 })).toEqual({ "x-a": "1" });
		expect(http.plain(undefined)).toEqual({});
	});

	it("never throws from json()", async () => {
		const okay = fakeTransport(() => ({ body: { a: 1 } }));
		expect(await http.json(okay, "http://x.test", { body: { q: 1 }, timeout: 500, signal: new AbortController().signal })).toEqual({
			ok: true,
			status: 200,
			body: { a: 1 }
		});
		const alone = await http.json(okay, "http://x.test", { timeout: 500 });
		expect(alone.ok).toBe(true);
		const text = fakeTransport(() => new Response("hello", { status: 500 }));
		expect(await http.json(text, "http://x.test")).toEqual({ ok: false, status: 500, body: "hello" });
		const empty = fakeTransport(() => new Response("", { status: 200 }));
		expect((await http.json(empty, "http://x.test")).body).toBeNull();
		const fail = await http.json(() => Promise.reject(new Error("net")), "http://x.test");
		expect(fail).toMatchObject({ ok: false, status: 0, body: null });
		expect(fail.error.message).toBe("net");
	});

	it("times out slow requests", async () => {
		const slow = (_url, init) =>
			new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
		const result = await http.json(slow, "http://x.test", { timeout: 20 });
		expect(result.ok).toBe(false);
	});
});

describe("lib/normalize", () => {
	it("parses versions", () => {
		expect(semver("0.19.0rc1")).toEqual([0, 19, 0]);
		expect(semver("v2")).toEqual([2, 0, 0]);
		expect(semver("x")).toBeNull();
		expect(semver(undefined)).toBeNull();
		expect(atLeast("0.19.0", "0.19.0")).toBe(true);
		expect(atLeast("0.18.9", "0.19.0")).toBe(false);
		expect(atLeast("1.0.0", "0.19.0")).toBe(true);
		expect(atLeast("0.19.1", "0.19.0")).toBe(true);
		expect(atLeast(undefined, "9.0.0")).toBe(true);
	});

	it("noEmptyTools keeps non-empty tool lists", () => {
		const body = { tools: [1] };
		expect(noEmptyTools(body)).toBe(body);
		expect(noEmptyTools({ tools: "x", a: 1 })).toEqual({ a: 1 });
	});
});

describe("lib/route", () => {
	const anthropic = { name: "a", protocol: "anthropic.messages", default: false };
	const vllm = { name: "v", protocol: "openai.chat", facts: { models: ["m"] }, default: true };
	const config = { aliases: { alias: "m" } };

	it("serves models", () => {
		expect(serves(vllm, "m")).toBe(true);
		expect(serves(vllm, "claude-x")).toBe(false);
		expect(serves(anthropic, "claude-x")).toBe(true);
		expect(serves({ ...anthropic, models: ["only"] }, "claude-x")).toBe(false);
		expect(serves({ name: "n", protocol: "openai.chat" }, "m")).toBe(false);
	});

	it("picks by alias, model, default, first", () => {
		expect(pick(config, [anthropic, vllm], "alias")).toEqual({ endpoint: vllm, model: "m", unserved: false });
		expect(pick(config, [vllm, anthropic], "claude-1").endpoint).toBe(anthropic);
		expect(pick(config, [anthropic, vllm], "zzz")).toEqual({ endpoint: vllm, model: "m", unserved: false });
		expect(pick(config, [anthropic], "zzz")).toEqual({ endpoint: anthropic, model: "zzz", unserved: true });
		const wide = { name: "w", protocol: "openai.chat", facts: { models: ["a", "b"] } };
		expect(pick(config, [wide], "zzz")).toEqual({ endpoint: wide, model: "zzz", unserved: true });
		const listed = { name: "l", protocol: "openai.chat", models: ["only"] };
		expect(pick(config, [listed], "zzz")).toEqual({ endpoint: listed, model: "only", unserved: false });
	});
});

describe("lib/ping", () => {
	const source = async function* (delays) {
		for (const delay of delays) {
			await new Promise((resolve) => setTimeout(resolve, delay));
			yield delay;
		}
	};

	it("interleaves markers while the source is silent", async () => {
		const out = [];
		for await (const item of withPings(source([60]), 15, "P")) out.push(item);
		expect(out.at(-1)).toBe(60);
		expect(out.filter((item) => item === "P").length).toBeGreaterThanOrEqual(2);
	});

	it("passes items through untouched when pings are off", async () => {
		const out = [];
		for await (const item of withPings(source([1, 1]), 0, "P")) out.push(item);
		expect(out).toEqual([1, 1]);
	});

	it("propagates source errors (closing the failed source is harmless)", async () => {
		let returned = false;
		const failing = {
			[Symbol.asyncIterator]: () => ({
				next: () => Promise.reject(new Error("source failed")),
				return: () => {
					returned = true;
					return Promise.resolve({ done: true });
				}
			})
		};
		await expect(withPings(failing, 10, "P").next()).rejects.toThrow("source failed");
		expect(returned).toBe(true);
	});

	it("swallows a pending read that fails after an early exit", async () => {
		const source = {
			[Symbol.asyncIterator]: () => ({
				next: () => new Promise((_resolve, reject) => setTimeout(() => reject(new Error("late failure")), 40)),
				return: () => Promise.resolve({ done: true })
			})
		};
		for await (const item of withPings(source, 10, "P")) {
			expect(item).toBe("P");
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 80));
	});

	it("closes the source on early exit, even when its return() fails or is missing", async () => {
		let closed = 0;
		const make = (hasReturn, rejects) => ({
			[Symbol.asyncIterator]: () => ({
				next: () => new Promise((resolve) => setTimeout(() => resolve({ done: false, value: 1 }), 5)),
				...(hasReturn
					? {
							return: () => {
								closed += 1;
								return rejects ? Promise.reject(new Error("x")) : Promise.resolve({ done: true });
							}
						}
					: {})
			})
		});
		for (const [hasReturn, rejects] of [
			[true, false],
			[true, true],
			[false, false]
		]) {
			for await (const item of withPings(make(hasReturn, rejects), 0, "P")) {
				expect(item).toBe(1);
				break;
			}
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(closed).toBe(2);
	});
});

describe("misc lib", () => {
	it("warns once", () => {
		const state = { warned: new Set() };
		const lines = [];
		const original = console.warn;
		console.warn = (line) => lines.push(line);
		try {
			expect(warn({ silent: false }, state, "x")).toBe(true);
			expect(warn({ silent: false }, state, "x")).toBe(false);
			expect(warn({ silent: true }, state, "y")).toBe(false);
		} finally {
			console.warn = original;
		}
		expect(lines).toEqual(["[llm-translator] x"]);
	});

	it("estimates", () => {
		expect(estimate({ system: "abcd", messages: [], tools: undefined })).toBe(Math.ceil('["abcd",[],null]'.length / 4));
	});

	it("fetchModels filters malformed entries and reports failures as null", async () => {
		const transport = fakeTransport(() => ({ body: { data: [{ id: "a" }, { id: 1 }, null] } }));
		expect(await fetchModels({ endpoint: { url: "http://x.test", headers: {} }, transport, auth: "bearer" })).toEqual([{ id: "a" }]);
		const bad = fakeTransport(() => ({ status: 500, body: {} }));
		expect(await fetchModels({ endpoint: { url: "http://x.test", headers: {} }, transport: bad })).toBeNull();
	});
});

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/pool.test.vitest.mjs
 *	@Date: 2026-10-26T06:00:20-07:00 (1793019620)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-26T15:38:55-07:00 (1793054335)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { completion, fakeVllm, json, textChunks } from "../helpers/fake-server.mjs";
import * as pool from "../../src/lib/pool.mjs";

afterEach(async () => {
	vi.useRealTimers();
	await closeAll();
});

const hello = { model: "m", max_tokens: 16, messages: [{ role: "user", content: "hi" }] };
const host = (url) => new URL(url).hostname.replace(".test", "");
const answer = (text) => ({ body: completion(text) });
const text = (reply) => reply.body.content[0].text;
const refusal = (message, status = 400) => ({ status, body: { error: { message, type: "BadRequestError", code: status } } });

/**
 * A translator over fake endpoints `names` that all serve `models`; `handlers[name](init, url)` answers (or throws) for each.
 * @param {Record<string, Function>} handlers - Per-endpoint handlers.
 * @param {object} [config] - Extra translator config.
 * @param {string[]} [models] - Models every endpoint serves.
 * @returns {Promise<{api: any, transport: any, calls: (name: string) => number}>} Translator, transport and a call counter.
 */
async function farm(handlers, config = {}, models = ["m"]) {
	const transport = fakeTransport((url, init) => handlers[host(url)](init, url));
	const api = await make({
		upstreams: Object.keys(handlers).map((name) => ({ name, url: `http://${name}.test`, backend: "vllm", models })),
		transport,
		detect: false,
		...config
	});
	const calls = (name) => transport.calls.filter((entry) => host(entry.url) === name).length;
	return { api, transport, calls };
}

const down = () => {
	throw new TypeError("fetch failed");
};

describe("pool config", () => {
	it("defaults to ordered failover with a 1s to 60s backoff", async () => {
		const { api } = await farm({ a: () => answer("a") });
		expect(api.endpoint.status()).toMatchObject({ strategy: "failover", backoff: { base: 1000, max: 60000 }, models: {} });
	});

	it("accepts a strategy, a backoff and per-model strategies", async () => {
		const { api } = await farm(
			{ a: () => answer("a") },
			{ pool: { strategy: "least_busy", backoff: { base: 5, max: 50 }, models: { m: "round_robin" } } }
		);
		expect(api.endpoint.status()).toMatchObject({ strategy: "least_busy", backoff: { base: 5, max: 50 }, models: { m: "round_robin" } });
	});

	it.each([
		[{ strategy: "random" }, /pool: strategy must be one of/],
		[{ models: { m: "nope" } }, /pool: models\.m must be one of/],
		[{ backoff: { base: 0 } }, /backoff\.base/],
		[{ backoff: { base: 100, max: 50 } }, /backoff\.max/],
		[{ backoff: { base: "1s" } }, /backoff\.base/],
		["failover", /pool: must be an object/],
		[null, /pool: must be an object/]
	])("rejects %j", async (config, message) => {
		await expect(farm({ a: () => answer("a") }, { pool: config })).rejects.toThrow(message);
	});
});

describe("ordered failover", () => {
	it("keeps using the first endpoint while nothing fails", async () => {
		const { api, calls } = await farm({ a: () => answer("a"), b: () => answer("b") });
		for (let n = 0; n < 3; n++) expect(text(await api.send(hello))).toBe("a");
		expect(calls("b")).toBe(0);
	});

	it("moves on after a connection error and reports the endpoint that answered", async () => {
		const { api, calls } = await farm({ a: down, b: () => answer("b") });
		const seen = [];
		const reply = await api.send(hello, { onUsage: (report) => seen.push(report) });
		expect(reply.status).toBe(200);
		expect(text(reply)).toBe("b");
		const report = await reply.usage;
		expect(report).toMatchObject({ upstream: "b", reason: "done", complete: true, input_tokens: 12, output_tokens: 4 });
		expect(seen).toEqual([report]);
		// a is now skipped while it backs off.
		await api.send(hello);
		expect(calls("a")).toBe(1);
		expect(calls("b")).toBe(2);
	});

	it.each([500, 502, 503, 529])("moves on after a %i before the first byte, streaming or not", async (status) => {
		const { api, calls } = await farm({ a: () => refusal("overloaded", status), b: () => answer("b") });
		expect(text(await api.send(hello))).toBe("b");
		const streamed = await farm({
			a: () => refusal("overloaded", status),
			b: () => ({
				body: textChunks(["x"])
					.map((frame) => `data: ${typeof frame === "string" ? frame : JSON.stringify(frame)}\n\n`)
					.join(""),
				headers: { "content-type": "text/event-stream" }
			})
		});
		const reply = await streamed.api.send({ ...hello, stream: true });
		const events = await collect(reply.stream);
		expect(events.at(-1).event).toBe("message_stop");
		expect((await reply.usage).upstream).toBe("b");
		expect(calls("b")).toBe(1);
		expect(streamed.calls("a")).toBe(1);
	});

	it.each([400, 401, 404, 422, 429])("never fails over on a %i", async (status) => {
		const { api, calls } = await farm({ a: () => refusal("no", status), b: () => answer("b") });
		const reply = await api.send(hello);
		expect(reply.status).toBe(status);
		expect((await reply.usage).upstream).toBe("a");
		expect(calls("b")).toBe(0);
		expect(api.endpoint.status().endpoints[0]).toMatchObject({ healthy: true, failures: 0, errors: 0 });
	});

	it("returns the last endpoint's failure when every endpoint fails, and still tries them all next time", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(0);
		const { api, calls } = await farm({ a: () => refusal("a broke", 500), b: () => refusal("b broke", 502) });
		const first = await api.send(hello);
		expect(first.status).toBe(502);
		expect(first.body.error.message).toBe("b broke");
		expect(await first.usage).toMatchObject({ upstream: "b", reason: "upstream_error" });
		expect([calls("a"), calls("b")]).toEqual([1, 1]);
		vi.setSystemTime(10);
		// Both are backing off; the one that recovers first (a) is tried first, then b.
		expect((await api.send(hello)).body.error.message).toBe("b broke");
		expect([calls("a"), calls("b")]).toEqual([2, 2]);
	});

	it("returns the connection error when the last endpoint cannot be reached", async () => {
		const { api } = await farm({ a: () => refusal("a broke", 500), b: down });
		const reply = await api.send(hello);
		expect(reply.status).toBe(502);
		expect(reply.body.error.message).toMatch(/Could not reach the upstream \(b\)/);
		expect(await reply.usage).toMatchObject({ upstream: "b", reason: "error", complete: false });
	});

	it("does not move on when only one endpoint serves the model", async () => {
		const { api, calls } = await farm({ a: () => refusal("a broke", 500) });
		expect((await api.send(hello)).status).toBe(500);
		expect((await api.send(hello)).status).toBe(500);
		expect(calls("a")).toBe(2);
	});

	it("only pools endpoints that serve the model", async () => {
		const transport = fakeTransport((url) => (host(url) === "a" ? refusal("a broke", 500) : answer(host(url))));
		const api = await make({
			upstreams: [
				{ name: "a", url: "http://a.test", backend: "vllm", models: ["m"] },
				{ name: "other", url: "http://other.test", backend: "vllm", models: ["x"] },
				{ name: "c", url: "http://c.test", backend: "vllm", models: ["m"] }
			],
			transport,
			detect: false
		});
		expect(text(await api.send(hello))).toBe("c");
		expect(transport.calls.map((entry) => host(entry.url))).toEqual(["a", "c"]);
	});

	it("resolves aliases before pooling", async () => {
		const { api } = await farm({ a: down, b: () => answer("b") }, { aliases: { sonnet: "m" } });
		expect(text(await api.send({ ...hello, model: "sonnet" }))).toBe("b");
		expect(api.route({ model: "sonnet" })).toMatchObject({ upstream: "b", pool: ["b", "a"], model: "m", requested: "sonnet" });
	});
});

describe("abort and partial replies", () => {
	it("does not move on when the caller aborted during the call", async () => {
		const controller = new AbortController();
		const { api, calls } = await farm({
			a: (init) =>
				new Promise((_resolve, reject) => {
					init.signal.addEventListener("abort", () => reject(new Error("aborted")));
					setTimeout(() => controller.abort(), 5);
				}),
			b: () => answer("b")
		});
		await expect(api.send(hello, { signal: controller.signal })).rejects.toThrow("aborted");
		expect(calls("b")).toBe(0);
		expect(api.endpoint.status().endpoints[0]).toMatchObject({ healthy: true, errors: 0, inflight: 0 });
	});

	it("does not move on after a 5xx when the caller has already aborted", async () => {
		const controller = new AbortController();
		const { api, calls } = await farm({
			a: () => (controller.abort(), refusal("a broke", 503)),
			b: () => answer("b")
		});
		const reply = await api.send(hello, { signal: controller.signal });
		expect(reply.status).toBe(503);
		expect(calls("b")).toBe(0);
	});

	it("never replays a stream that failed after its first bytes", async () => {
		const encoder = new TextEncoder();
		const frames = textChunks(["Hel", "lo"]).map((frame) => `data: ${typeof frame === "string" ? frame : JSON.stringify(frame)}\n\n`);
		const { api, calls } = await farm({
			a: () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(encoder.encode(frames[0]));
							controller.enqueue(encoder.encode(frames[1]));
						},
						pull() {
							throw new Error("connection reset");
						}
					}),
					{ status: 200, headers: { "content-type": "text/event-stream" } }
				),
			b: () => answer("b")
		});
		const reply = await api.send({ ...hello, stream: true });
		expect(reply.status).toBe(200);
		const events = await collect(reply.stream).catch((error) => [{ event: "thrown", error }]);
		expect(events[0].event).toBe("message_start");
		expect(["error", "thrown"]).toContain(events.at(-1).event);
		expect(calls("b")).toBe(0);
		expect(calls("a")).toBe(1);
		const report = await reply.usage;
		expect(report).toMatchObject({ upstream: "a", complete: false });
		expect(api.endpoint.status().endpoints[0].inflight).toBe(0);
	});
});

describe("retries on one endpoint and failover together", () => {
	const TOOLS = '"auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set';
	const withTools = { ...hello, tools: [{ name: "t", description: "d", input_schema: { type: "object", properties: {} } }] };

	it("retries a tool refusal on the same endpoint, not on the next one", async () => {
		const { api, calls, transport } = await farm(
			{ a: (init) => (JSON.parse(init.body).tools ? refusal(TOOLS) : answer("a")), b: () => answer("b") },
			{ settings: { toolFallback: true } }
		);
		const reply = await api.send(withTools);
		expect(text(reply)).toBe("a");
		expect(calls("a")).toBe(2);
		expect(calls("b")).toBe(0);
		expect(JSON.parse(transport.calls[1].init.body).tools).toBeUndefined();
	});

	it("fails over after the retried request itself fails with a 5xx, and the next endpoint starts with the full request", async () => {
		const { api, transport } = await farm(
			{ a: (init) => (JSON.parse(init.body).tools ? refusal(TOOLS) : refusal("a broke", 503)), b: () => answer("b") },
			{ settings: { toolFallback: true } }
		);
		const reply = await api.send(withTools);
		expect(text(reply)).toBe("b");
		expect(transport.calls.map((entry) => host(entry.url))).toEqual(["a", "a", "b"]);
		expect(JSON.parse(transport.calls[2].init.body).tools).toHaveLength(1);
		expect((await reply.usage).upstream).toBe("b");
	});

	it("does not fail over on a 400 that is not retried", async () => {
		const { api, calls } = await farm({ a: () => refusal("bad tool schema"), b: () => answer("b") }, { settings: { toolFallback: true } });
		expect((await api.send(withTools)).status).toBe(400);
		expect(calls("b")).toBe(0);
	});
});

describe("usage reporting across endpoints", () => {
	it("reads native Anthropic usage after a converted endpoint failed first", async () => {
		const transport = fakeTransport((url) =>
			host(url) === "a"
				? refusal("a broke", 500)
				: {
						body: {
							id: "msg_1",
							type: "message",
							role: "assistant",
							model: "m",
							content: [{ type: "text", text: "native" }],
							stop_reason: "end_turn",
							stop_sequence: null,
							usage: { input_tokens: 5, output_tokens: 6 }
						}
					}
		);
		const api = await make({
			upstreams: [
				{ name: "a", url: "http://a.test", backend: "vllm", models: ["m"] },
				{ name: "b", url: "http://b.test", backend: "anthropic", models: ["m"] }
			],
			transport,
			detect: false
		});
		const reply = await api.send(hello);
		expect(text(reply)).toBe("native");
		expect(await reply.usage).toMatchObject({ upstream: "b", input_tokens: 5, output_tokens: 6, estimated: null });
	});

	it("reports a failed pool's last endpoint through onUsage once", async () => {
		const { api } = await farm({ a: () => refusal("x", 500), b: () => refusal("y", 500) });
		const seen = [];
		await api.send(hello, { onUsage: (report) => seen.push(report) });
		expect(seen).toHaveLength(1);
		expect(seen[0].upstream).toBe("b");
	});
});

describe("health and backoff", () => {
	it("skips a failing endpoint for an exponentially growing backoff capped at max, then resets on success", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(1_000_000);
		let broken = true;
		const { api, calls } = await farm(
			{ a: () => (broken ? refusal("a broke", 500) : answer("a")), b: () => answer("b") },
			{ pool: { backoff: { base: 100, max: 250 } } }
		);
		const health = () => api.endpoint.status().endpoints[0];
		await api.send(hello);
		expect(health()).toMatchObject({
			healthy: false,
			failures: 1,
			errors: 1,
			lastError: "HTTP 500",
			retryAt: new Date(1_000_100).toISOString()
		});
		// Within the backoff a is skipped.
		vi.setSystemTime(1_000_099);
		await api.send(hello);
		expect(calls("a")).toBe(1);
		// After it a is tried first again; the failure doubles the wait (200), then it is capped (250).
		vi.setSystemTime(1_000_100);
		await api.send(hello);
		expect(calls("a")).toBe(2);
		expect(health()).toMatchObject({ failures: 2, retryAt: new Date(1_000_300).toISOString() });
		vi.setSystemTime(1_000_300);
		await api.send(hello);
		expect(health()).toMatchObject({ failures: 3, retryAt: new Date(1_000_550).toISOString() });
		vi.setSystemTime(1_000_550);
		await api.send(hello);
		expect(health()).toMatchObject({ failures: 4, retryAt: new Date(1_000_800).toISOString() });
		// A success resets everything.
		broken = false;
		vi.setSystemTime(1_000_800);
		expect(text(await api.send(hello))).toBe("a");
		expect(health()).toMatchObject({
			healthy: true,
			failures: 0,
			retryAt: null,
			errors: 4,
			lastSuccess: new Date(1_000_800).toISOString()
		});
		expect(health().lastFailure).toBe(new Date(1_000_550).toISOString());
	});

	it("cancels the body of a 5xx it fails over from, including an empty one", async () => {
		const { api } = await farm({ a: () => new Response(null, { status: 503 }), b: () => answer("b") });
		expect(text(await api.send(hello))).toBe("b");
	});

	it("shows health in status() and endpoint.status() without secrets", async () => {
		const { api } = await farm({ a: down, b: () => answer("b") });
		await api.send(hello);
		const found = api.endpoint.status();
		expect(found.endpoints.map((entry) => entry.name)).toEqual(["a", "b"]);
		expect(found.endpoints[0]).toMatchObject({
			name: "a",
			url: "http://a.test",
			models: ["m"],
			healthy: false,
			requests: 1,
			errors: 1,
			inflight: 0
		});
		expect(found.endpoints[0].lastError).toMatch(/Could not reach the upstream \(a\)/);
		expect(found.endpoints[1]).toMatchObject({ healthy: true, requests: 1, errors: 0, lastError: null, lastFailure: null });
		expect(api.status().upstreams[0].health).toMatchObject({ healthy: false });
		expect(JSON.stringify(found)).not.toContain("apiKey");
	});

	it("lists the models an endpoint serves from its configuration or from detection, and none when unknown", async () => {
		const server = await fakeVllm({ models: ["qwen3-coder"] });
		try {
			const api = await make({
				upstreams: [
					{ name: "detected", url: server.url, settings: { images: true } },
					{ name: "bare", url: "http://bare.test", backend: "vllm" }
				]
			});
			expect(api.endpoint.status().endpoints.map((entry) => entry.models)).toEqual([["qwen3-coder"], []]);
		} finally {
			await server.close();
		}
	});

	it("describes a never-used endpoint", () => {
		expect(pool.describe({ health: pool.health() }, 5)).toMatchObject({ healthy: true, lastSuccess: null, lastFailure: null, requests: 0 });
	});
});

describe("strategies", () => {
	it("round robin rotates through the healthy endpoints and skips a backing-off one", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(0);
		let broken = false;
		const { api } = await farm(
			{ a: () => answer("a"), b: () => (broken ? refusal("b broke", 500) : answer("b")), c: () => answer("c") },
			{ pool: { strategy: "round_robin" } }
		);
		const got = [];
		for (let n = 0; n < 4; n++) got.push(text(await api.send(hello)));
		expect(got).toEqual(["a", "b", "c", "a"]);
		broken = true;
		// Cursor is at 4: b is next, fails and the request moves on to c; from then on b is skipped.
		expect(text(await api.send(hello))).toBe("c");
		const after = [];
		for (let n = 0; n < 4; n++) after.push(text(await api.send(hello)));
		expect(after.every((entry) => entry === "a" || entry === "c")).toBe(true);
		expect(new Set(after).size).toBe(2);
	});

	it("keeps each model's own round robin position and takes a per-model strategy", async () => {
		const { api } = await farm(
			{ a: () => answer("a"), b: () => answer("b") },
			{ pool: { strategy: "failover", models: { m2: "round_robin" } } },
			["m", "m2"]
		);
		const got = [];
		for (let n = 0; n < 3; n++) got.push(text(await api.send({ ...hello, model: "m2" })));
		expect(got).toEqual(["a", "b", "a"]);
		// m keeps ordered failover.
		expect(text(await api.send(hello))).toBe("a");
		expect(text(await api.send(hello))).toBe("a");
	});

	it("least busy sends to the endpoint with fewer requests in flight and releases the slot when the reply ends", async () => {
		let release;
		const gate = new Promise((resolve) => (release = resolve));
		const { api, calls } = await farm(
			{
				a: async () => (await gate, answer("a")),
				b: () => answer("b"),
				c: () => answer("c")
			},
			{ pool: { strategy: "least_busy" } }
		);
		const slow = api.send(hello);
		await vi.waitFor(() => expect(calls("a")).toBe(1));
		expect(api.endpoint.status().endpoints[0].inflight).toBe(1);
		// a is busy: b and c share the next ones (ties keep configuration order).
		expect(text(await api.send(hello))).toBe("b");
		expect(text(await api.send(hello))).toBe("b");
		release();
		expect(text(await slow)).toBe("a");
		await (
			await slow
		).usage;
		expect(api.endpoint.status().endpoints.map((entry) => entry.inflight)).toEqual([0, 0, 0]);
		// Nothing in flight: configuration order again.
		expect(text(await api.send(hello))).toBe("a");
	});

	it("holds the in-flight slot of a stream until it ends", async () => {
		const frames = textChunks(["x"])
			.map((frame) => `data: ${typeof frame === "string" ? frame : JSON.stringify(frame)}\n\n`)
			.join("");
		const { api } = await farm({ a: () => ({ body: frames, headers: { "content-type": "text/event-stream" } }) });
		const reply = await api.send({ ...hello, stream: true });
		expect(api.endpoint.status().endpoints[0].inflight).toBe(1);
		await collect(reply.stream);
		await reply.usage;
		expect(api.endpoint.status().endpoints[0].inflight).toBe(0);
	});

	it("tries an all-unhealthy pool best first, soonest recovery first", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(0);
		const { api, calls } = await farm(
			{
				a: down,
				b: () => (vi.setSystemTime(30), refusal("b broke", 500))
			},
			{ pool: { backoff: { base: 100, max: 1000 } } }
		);
		await api.send(hello);
		// a retries at 100, b at 130: both are backing off at 40 and a recovers first.
		vi.setSystemTime(40);
		expect(api.route(hello).pool).toEqual(["a", "b"]);
		const again = await api.send(hello);
		expect(again.status).toBe(500);
		expect([calls("a"), calls("b")]).toEqual([2, 2]);
	});
});

describe("route()", () => {
	it("lists the pool in try order and does not move the round robin", async () => {
		const { api } = await farm({ a: () => answer("a"), b: () => answer("b") }, { pool: { strategy: "round_robin" } });
		expect(api.route(hello)).toMatchObject({ upstream: "a", pool: ["a", "b"], unserved: false });
		expect(api.route(hello).upstream).toBe("a");
		expect(text(await api.send(hello))).toBe("a");
		expect(api.route(hello)).toMatchObject({ upstream: "b", pool: ["b", "a"] });
	});

	it("reports a single-member pool for an unserved model", async () => {
		const { api } = await farm({ a: () => answer("a"), b: () => answer("b") }, {}, ["m", "m3"]);
		expect(api.route({ ...hello, model: "unknown" })).toMatchObject({ upstream: "a", pool: ["a"], unserved: true });
	});

	it("request() picks the first member and can be forced to another", async () => {
		const { api } = await farm({ a: () => answer("a"), b: () => answer("b") });
		const first = await api.request(hello);
		expect(first).toMatchObject({ upstream: "a", pool: ["a", "b"] });
		expect(await api.request(hello, { endpoint: "b" })).toMatchObject({
			upstream: "b",
			pool: ["b"],
			url: "http://b.test/v1/chat/completions"
		});
	});
});

describe("server", () => {
	it("runs authorize once per request, whatever the failover does", async () => {
		const broken = await fakeVllm({
			chat: (_req, _body, res) => json(res, 503, { error: { message: "down", type: "ServiceUnavailable", code: 503 } })
		});
		const good = await fakeVllm();
		try {
			const api = await make({
				upstreams: [
					{ name: "a", url: broken.url, models: ["qwen3-coder"], settings: { images: true } },
					{ name: "b", url: good.url, models: ["qwen3-coder"], settings: { images: true } }
				]
			});
			let seen = 0;
			const server = await api.server.start({ port: 0, authorize: () => (seen++, true) });
			const reply = await fetch(`${server.url}/v1/messages`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ model: "qwen3-coder", max_tokens: 8, messages: [{ role: "user", content: "hi" }] })
			});
			expect(reply.status).toBe(200);
			expect((await reply.json()).content[0].text).toBe("Hello world");
			expect(seen).toBe(1);
			expect(broken.requests.filter((entry) => entry.url === "/v1/chat/completions")).toHaveLength(1);
		} finally {
			await broken.close();
			await good.close();
		}
	});

	it("reports an unreachable first endpoint and answers from the second", async () => {
		const good = await fakeVllm();
		try {
			const api = await make({
				upstreams: [
					{ name: "dead", url: "http://127.0.0.1:1", backend: "vllm", models: ["qwen3-coder"] },
					{ name: "b", url: good.url, models: ["qwen3-coder"], settings: { images: true } }
				],
				detect: false
			});
			const reply = await api.send({ model: "qwen3-coder", max_tokens: 8, messages: [{ role: "user", content: "hi" }] });
			expect(reply.status).toBe(200);
			expect((await reply.usage).upstream).toBe("b");
		} finally {
			await good.close();
		}
	});
});

describe("pools across detected drivers", () => {
	const PROPS = { default_generation_settings: { n_ctx: 8192 }, total_slots: 1, build_info: "b6000-abcdef", modalities: { vision: false } };
	const JINJA = { error: { message: "tools param requires --jinja flag", type: "invalid_request_error", code: 400 } };
	const withTools = { ...hello, tools: [{ name: "t", description: "d", input_schema: { type: "object", properties: {} } }] };

	/** A llama.cpp-looking host (`/props` and `/v1/models`) whose chat endpoint is `chat`, and a vLLM-looking host (`/version`). */
	const transportFor = (chat) =>
		fakeTransport((url, init) => {
			const path = new URL(url).pathname;
			const name = host(url);
			if (path === "/v1/chat/completions") return chat[name](init);
			if (name === "llama" && path === "/props") return { body: PROPS };
			if (path === "/v1/models")
				return {
					body: {
						object: "list",
						data: [{ id: "m", object: "model", owned_by: name === "llama" ? "llamacpp" : "vllm", max_model_len: 4096 }]
					}
				};
			if (name === "gpu" && path === "/version") return { body: { version: "0.19.0" } };
			return { status: 404, body: { error: "not found" } };
		});

	it("pools endpoints bound to different drivers by the models their detection found", async () => {
		const transport = transportFor({ llama: () => refusal("llama broke", 500), gpu: () => answer("gpu") });
		const api = await make({ upstreams: ["http://llama.test", { url: "http://gpu.test", settings: { images: true } }], transport });
		expect(api.status().upstreams.map((entry) => [entry.name, entry.driver])).toEqual([
			["upstream-0", "llamacpp"],
			["upstream-1", "vllm"]
		]);
		expect(api.route(hello)).toMatchObject({ upstream: "upstream-0", pool: ["upstream-0", "upstream-1"] });
		const reply = await api.send(hello);
		expect(text(reply)).toBe("gpu");
		expect((await reply.usage).upstream).toBe("upstream-1");
		expect(api.route(hello)).toMatchObject({ upstream: "upstream-1", pool: ["upstream-1", "upstream-0"] });
		expect(api.endpoint.status().endpoints.map((entry) => [entry.healthy, entry.models])).toEqual([
			[false, ["m"]],
			[true, ["m"]]
		]);
	});

	it("retries a llama.cpp --jinja refusal on the same endpoint with toolFallback, and fails over only if that retry fails", async () => {
		const bodies = [];
		const transport = transportFor({
			llama: (init) => {
				const body = JSON.parse(init.body);
				bodies.push(body);
				return body.tools ? { status: 400, body: JINJA } : refusal("llama broke", 500);
			},
			gpu: () => answer("gpu")
		});
		const api = await make({
			upstreams: ["http://llama.test", { url: "http://gpu.test", settings: { images: true } }],
			transport,
			settings: { toolFallback: true }
		});
		const reply = await api.send(withTools);
		expect(text(reply)).toBe("gpu");
		expect(bodies.map((body) => body.tools !== undefined)).toEqual([true, false]);
		const gpu = transport.calls.filter((entry) => host(entry.url) === "gpu" && entry.url.endsWith("/chat/completions"));
		expect(JSON.parse(gpu[0].init.body).tools).toHaveLength(1);
		expect((await reply.usage).upstream).toBe("upstream-1");
	});

	it("does not fail over from a --jinja refusal when toolFallback is off, and hints with the setting", async () => {
		const transport = transportFor({ llama: () => ({ status: 400, body: JINJA }), gpu: () => answer("gpu") });
		const api = await make({ upstreams: ["http://llama.test", { url: "http://gpu.test", settings: { images: true } }], transport });
		const reply = await api.send(withTools);
		expect(reply.status).toBe(400);
		expect(reply.body.error.message).toContain("started without --jinja");
		expect(reply.body.error.message).toContain("toolFallback");
		expect((await reply.usage).upstream).toBe("upstream-0");
		expect(api.endpoint.status().endpoints[0]).toMatchObject({ healthy: true, errors: 0 });
	});
});

describe("review fixes", () => {
	it("least busy spreads concurrent requests: the slot is taken when the endpoint is picked", async () => {
		let release;
		const gate = new Promise((resolve) => (release = resolve));
		const { api, calls } = await farm(
			{
				a: async () => (await gate, answer("a")),
				b: async () => (await gate, answer("b"))
			},
			{ pool: { strategy: "least_busy" } }
		);
		const sends = [1, 2, 3, 4].map(() => api.send(hello));
		await vi.waitFor(() => expect(calls("a") + calls("b")).toBe(4));
		expect([calls("a"), calls("b")]).toEqual([2, 2]);
		expect(api.endpoint.status().endpoints.map((entry) => entry.inflight)).toEqual([2, 2]);
		release();
		const replies = await Promise.all(sends);
		await Promise.all(replies.map((reply) => reply.usage));
		expect(api.endpoint.status().endpoints.map((entry) => entry.inflight)).toEqual([0, 0]);
	});

	it("moves the slot to the next endpoint on failover and gives it back when the request cannot be built", async () => {
		let release;
		const gate = new Promise((resolve) => (release = resolve));
		const { api } = await farm(
			{ a: () => refusal("a broke", 500), b: async () => (await gate, answer("b")) },
			{ pool: { strategy: "least_busy" }, settings: { unknownFields: "error" } }
		);
		const sending = api.send(hello);
		await vi.waitFor(() => expect(api.endpoint.status().endpoints[1].inflight).toBe(1));
		expect(api.endpoint.status().endpoints[0].inflight).toBe(0);
		release();
		await (
			await sending
		).usage;
		expect(api.endpoint.status().endpoints.map((entry) => entry.inflight)).toEqual([0, 0]);
		// A body the converter rejects fails inside request(); the slot taken at the pick is returned.
		const bad = await api.send({ ...hello, mystery_field: 1 });
		expect(bad.status).toBe(400);
		expect(api.endpoint.status().endpoints.map((entry) => entry.inflight)).toEqual([0, 0]);
	});

	it("advances a round robin only in send: request(), token.count() and route() leave it alone", async () => {
		const { api } = await farm({ a: () => answer("a"), b: () => answer("b") }, { pool: { strategy: "round_robin" } });
		await api.request(hello);
		await api.token.count(hello);
		api.route(hello);
		expect(api.route(hello).upstream).toBe("a");
		expect(text(await api.send(hello))).toBe("a");
		expect(text(await api.send(hello))).toBe("b");
	});

	describe("timeouts", () => {
		const frozen = () => vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
		const hang = (init) =>
			new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("socket hang up")), { once: true }));

		it("defaults to a 10s connect timeout and no headers timeout, only for endpoints with pool mates", async () => {
			const pooled = await farm({ a: () => answer("a"), b: () => answer("b") });
			await pooled.api.send(hello);
			expect(pooled.transport.calls[0].init.connectTimeout).toBe(10000);
			expect(pooled.transport.calls[0].init.signal).toBeUndefined();
			const lone = await farm({ a: () => answer("a") });
			await lone.api.send(hello);
			expect(lone.transport.calls[0].init).not.toHaveProperty("connectTimeout");
			expect(lone.transport.calls[0].init.signal).toBeUndefined();
			const off = await farm({ a: () => answer("a"), b: () => answer("b") }, { pool: { connectTimeout: 0 } });
			await off.api.send(hello);
			expect(off.transport.calls[0].init).not.toHaveProperty("connectTimeout");
		});

		it("fails over from an endpoint that accepts the connection and never answers", async () => {
			frozen();
			const { api, calls } = await farm({ a: hang, b: () => answer("b") }, { pool: { headersTimeout: 5000 } });
			const sending = api.send(hello);
			await vi.advanceTimersByTimeAsync(4999);
			expect(calls("b")).toBe(0);
			await vi.advanceTimersByTimeAsync(1);
			const reply = await sending;
			expect(text(reply)).toBe("b");
			expect((await reply.usage).upstream).toBe("b");
			const first = api.endpoint.status().endpoints[0];
			expect(first).toMatchObject({ healthy: false, failures: 1 });
			expect(first.lastError).toBe("Could not reach the upstream (a): no response headers within 5000 ms");
		});

		it("fails over from a hung endpoint when the caller also passed a signal, but not when the caller aborts", async () => {
			frozen();
			const { api, calls } = await farm({ a: hang, b: () => answer("b") }, { pool: { headersTimeout: 1000 } });
			const sending = api.send(hello, { signal: new AbortController().signal });
			await vi.advanceTimersByTimeAsync(1000);
			expect(text(await sending)).toBe("b");
			const aborting = new AbortController();
			const { api: second, calls: secondCalls } = await farm({ a: hang, b: () => answer("b") }, { pool: { headersTimeout: 1000 } });
			const pending = second.send(hello, { signal: aborting.signal });
			const rejected = expect(pending).rejects.toThrow("socket hang up");
			await vi.advanceTimersByTimeAsync(10);
			aborting.abort();
			await rejected;
			expect(secondCalls("b")).toBe(0);
			expect(calls("b")).toBe(1);
		});

		it("does not apply the headers timeout to the last endpoint left to try", async () => {
			frozen();
			let signal = "unset";
			const { api, calls } = await farm(
				{
					a: hang,
					b: (init) => ((signal = init.signal), new Promise((resolve) => setTimeout(() => resolve(answer("b")), 5000)))
				},
				{ pool: { headersTimeout: 1000 } }
			);
			const sending = api.send(hello);
			await vi.advanceTimersByTimeAsync(1000);
			expect(calls("b")).toBe(1);
			await vi.advanceTimersByTimeAsync(5000);
			const reply = await sending;
			expect(reply.status).toBe(200);
			expect(text(reply)).toBe("b");
			expect(signal).toBeUndefined();
			// The connect timeout still applies there.
			expect(api.endpoint.status().endpoints[1]).toMatchObject({ healthy: true });
		});

		it("does not cap a reply once its headers have arrived", async () => {
			frozen();
			let signal;
			const { api } = await farm(
				{
					a: (init) => (
						(signal = init.signal),
						new Response(new ReadableStream({ start() {} }), { status: 200, headers: { "content-type": "text/event-stream" } })
					),
					b: () => answer("b")
				},
				{ pool: { headersTimeout: 1000 } }
			);
			await api.send({ ...hello, stream: true });
			await vi.advanceTimersByTimeAsync(600_000);
			expect(signal.aborted).toBe(false);
			expect(api.endpoint.status().endpoints[0]).toMatchObject({ healthy: true, inflight: 1 });
		});

		it("rejects bad timeouts", async () => {
			await expect(farm({ a: () => answer("a") }, { pool: { connectTimeout: -1 } })).rejects.toThrow(/connectTimeout must be a number/);
			await expect(farm({ a: () => answer("a") }, { pool: { headersTimeout: "1s" } })).rejects.toThrow(/headersTimeout must be a number/);
			const { api } = await farm({ a: () => answer("a") }, { pool: { connectTimeout: 5, headersTimeout: 6 } });
			expect(api.endpoint.status()).toMatchObject({ connectTimeout: 5, headersTimeout: 6 });
		});
	});

	describe("failover against odd bodies and a changing pool", () => {
		it("goes on when the failed reply's body has no cancel, or cannot be cancelled", async () => {
			const plain = { ok: false, status: 503, headers: new Headers(), body: {} };
			const throwing = { ok: false, status: 503, headers: new Headers(), body: { cancel: () => Promise.reject(new Error("locked")) } };
			for (const failed of [plain, throwing]) {
				const { api } = await farm({ a: () => failed, b: () => answer("b") });
				expect(text(await api.send(hello))).toBe("b");
			}
		});

		it("skips pool members that dropped out meanwhile and returns the last failure when none is left", async () => {
			const gone = new Set();
			/** Three auto-detected endpoints; `a` fails after making the endpoints in `drop` stop serving `m` and re-running detection. */
			const trio = async (drop) => {
				let api;
				const transport = fakeTransport(async (url) => {
					const name = host(url);
					if (new URL(url).pathname === "/v1/models") {
						return { body: { object: "list", data: gone.has(name) ? [] : [{ id: "m", object: "model" }] } };
					}
					if (new URL(url).pathname !== "/v1/chat/completions") return { status: 404, body: { error: "not found" } };
					if (name === "a") {
						for (const other of drop) gone.add(other);
						await api.detect();
						return refusal("a broke", 503);
					}
					return answer(name);
				});
				api = await make({ upstreams: ["a", "b", "c"].map((name) => ({ name, url: `http://${name}.test` })), transport });
				return { api, transport };
			};
			const chats = (transport) => transport.calls.filter((entry) => entry.url.includes("chat")).map((entry) => host(entry.url));
			const first = await trio(["b"]);
			expect(text(await first.api.send(hello))).toBe("c");
			expect(chats(first.transport)).toEqual(["a", "c"]);
			gone.clear();
			const second = await trio(["b", "c"]);
			const reply = await second.api.send(hello);
			expect(reply.status).toBe(503);
			expect(reply.body.error.message).toBe("a broke");
			expect(chats(second.transport)).toEqual(["a"]);
		});

		it("returns the error when the next endpoint cannot be built for, and gives every slot back", async () => {
			const transport = fakeTransport((url) => (host(url) === "a" ? refusal("a broke", 503) : answer("b")));
			const api = await make({
				upstreams: [
					{ name: "a", url: "http://a.test", backend: "vllm", models: ["m"] },
					{ name: "b", url: "http://b.test", backend: "vllm", models: ["m"], settings: { unknownFields: "error" } }
				],
				transport,
				detect: false
			});
			const reply = await api.send({ ...hello, mystery_field: 1 });
			expect(reply.status).toBe(400);
			expect(reply.body.error.message).toMatch(/mystery_field/);
			expect(api.endpoint.status().endpoints.map((entry) => entry.inflight)).toEqual([0, 0]);
		});

		it("request() refuses a forced endpoint that does not serve the model", async () => {
			const { api } = await farm({ a: () => answer("a"), b: () => answer("b") });
			await expect(api.request(hello, { endpoint: "zzz" })).rejects.toMatchObject({ code: "endpoint_not_in_pool" });
		});
	});
});

describe("pools across drivers with different passthrough fields and stream flushing", () => {
	const chat = { model: "m", max_tokens: 8, messages: [{ role: "user", content: "hi" }], min_p: 0.1 };
	const frame = (delta, finish = null) => ({
		id: "c",
		object: "chat.completion.chunk",
		created: 1,
		model: "m",
		choices: [{ index: 0, delta, finish_reason: finish }]
	});
	const sse = (frames) =>
		new Response(frames.map((entry) => `data: ${typeof entry === "string" ? entry : JSON.stringify(entry)}\n\n`).join(""), {
			status: 200,
			headers: { "content-type": "text/event-stream" }
		});

	it("filters the forwarded body per endpoint: the failover target gets the fields its own driver allows", async () => {
		const transport = fakeTransport((url) => (host(url) === "a" ? refusal("a broke", 503) : answer("b")));
		const api = await make({
			front: "openai",
			upstreams: [
				{ name: "a", url: "http://a.test", backend: "vllm", models: ["m"] },
				{ name: "b", url: "http://b.test", backend: "openai", models: ["m"] }
			],
			transport,
			detect: false,
			settings: { passthroughFilter: true }
		});
		const reply = await api.send(chat);
		expect(reply.status).toBe(200);
		const bodies = transport.calls.map((entry) => JSON.parse(entry.init.body));
		expect(bodies[0].min_p).toBe(0.1);
		expect(bodies[1]).not.toHaveProperty("min_p");
		expect((await reply.usage).upstream).toBe("b");
	});

	it("flushes the failover target's held text at the end of its stream and reports it as complete", async () => {
		const transport = fakeTransport((url) =>
			host(url) === "a" ? refusal("a broke", 503) : sse([frame({ reasoning_content: "r1" }), frame({ content: "<thi" }), frame({}, "stop")])
		);
		const api = await make({
			front: "openai",
			upstreams: [
				{ name: "a", url: "http://a.test", backend: "vllm", models: ["m"] },
				{ name: "b", url: "http://b.test", backend: "llamacpp", models: ["m"] }
			],
			transport,
			detect: false
		});
		const reply = await api.send({ ...chat, stream: true });
		const events = await collect(reply.stream);
		expect(events.map((event) => event.data?.choices?.[0]?.delta?.content ?? "").join("")).toBe("<thi");
		expect(await reply.usage).toMatchObject({ upstream: "b", stream: true, front: "openai" });
		expect(api.endpoint.status().endpoints.map((entry) => entry.inflight)).toEqual([0, 0]);
	});
});

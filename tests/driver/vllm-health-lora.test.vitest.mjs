/**
 * @fileoverview vLLM readiness gating (`/health` before routing to a pool) and LoRA adapters in the model lists.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeAll, fakeTransport, make } from "../helpers/translator.mjs";
import * as pool from "../../src/lib/pool.mjs";
import * as models from "../../src/lib/models.mjs";

afterEach(() => {
	vi.restoreAllMocks();
	return closeAll();
});

const user = [{ role: "user", content: "hi" }];
const chat = (text) => ({
	body: {
		id: "c",
		object: "chat.completion",
		model: "m",
		choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
		usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
	}
});
const two = (extra = {}) => ({
	upstreams: [
		{ name: "a", url: "http://a.test", backend: "vllm", models: ["m"] },
		{ name: "b", url: "http://b.test", backend: "vllm", models: ["m"] }
	],
	...extra
});

/** A fleet of vLLM fakes: `health[name]` is the status (or an Error to throw) `/health` answers with. */
const fleet = (health = {}) => {
	const transport = fakeTransport((u) => {
		const url = new URL(u);
		const name = url.hostname.split(".")[0];
		if (url.pathname === "/health") {
			const answer = health[name] ?? 200;
			if (answer instanceof Error) throw answer;
			return { status: answer, body: "" };
		}
		return chat(name);
	});
	return Object.assign(transport, { health });
};
const calls = (transport) => transport.calls.map((call) => `${call.init.method} ${new URL(call.url).host}${new URL(call.url).pathname}`);
const ask = { model: "m", max_tokens: 8, messages: user };

describe("pool health record and config", () => {
	it("normalizes the probe config", () => {
		expect(pool.normalize()).toMatchObject({ healthInterval: 10000, healthTimeout: 2000 });
		expect(pool.normalize({ healthInterval: 0, healthTimeout: 50 })).toMatchObject({ healthInterval: 0, healthTimeout: 50 });
		expect(() => pool.normalize({ healthInterval: -1 })).toThrow(/healthInterval must be a number of ms/);
		expect(() => pool.normalize({ healthTimeout: "x" })).toThrow(/healthTimeout/);
	});

	it("a not ready endpoint is ordered after the ready ones and described as unhealthy", () => {
		const config = { pool: pool.normalize() };
		const [a, b] = [{ health: pool.health() }, { health: pool.health() }];
		a.health.ready = false;
		a.health.readyReason = "HTTP 503";
		expect(pool.order(config, { cursors: new Map() }, [a, b], "m", false, 5)).toEqual([b, a]);
		expect(pool.describe(a, 5)).toMatchObject({ healthy: false, ready: false, readyReason: "HTTP 503", checkedAt: null });
		expect(pool.describe(b, 5)).toMatchObject({ healthy: true, ready: null, readyReason: null });
		a.health.checkedAt = 1000;
		expect(pool.describe(a, 5).checkedAt).toBe(new Date(1000).toISOString());
	});

	it("an answered request shows the endpoint is ready again", () => {
		const endpoint = { health: pool.health() };
		endpoint.health.ready = false;
		pool.succeeded(endpoint, 10);
		expect(endpoint.health.ready).toBe(true);
		const fresh = { health: pool.health() };
		pool.succeeded(fresh, 10);
		expect(fresh.health.ready).toBeNull();
	});
});

describe("readiness gating", () => {
	it("skips an endpoint whose /health says no when another serves the model, and shows it in status", async () => {
		const transport = fleet({ a: 503 });
		const api = await make(two({ transport, detect: false }));
		const events = [];
		api.events.on("health", (event) => events.push(event));
		const reply = await api.send(ask);
		expect(reply.body.content[0].text).toBe("b");
		expect(calls(transport).filter((line) => line.includes("chat"))).toEqual(["POST b.test/v1/chat/completions"]);
		expect(
			calls(transport)
				.filter((line) => line.includes("health"))
				.sort()
		).toEqual(["GET a.test/health", "GET b.test/health"]);
		const found = api.endpoint.status().endpoints;
		expect(found[0]).toMatchObject({ name: "a", healthy: false, ready: false, readyReason: "HTTP 503" });
		expect(found[1]).toMatchObject({ name: "b", healthy: true, ready: true });
		expect(api.status().upstreams[0].health.ready).toBe(false);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ kind: "down", level: "warn", endpoint: "a", reason: "HTTP 503" });
	});

	it("trusts a verdict for the interval, then asks again and takes the endpoint back when it is ready", async () => {
		let now = 1_000_000;
		vi.spyOn(Date, "now").mockImplementation(() => now);
		const transport = fleet({ a: 503 });
		const api = await make(two({ transport, detect: false }));
		const events = [];
		api.events.on("health", (event) => events.push(event));
		await api.send(ask);
		const probes = () => calls(transport).filter((line) => line.includes("health")).length;
		expect(probes()).toBe(2);
		now += 5000;
		await api.send(ask);
		expect(probes()).toBe(2);
		now += 6000;
		transport.health.a = 200;
		const reply = await api.send(ask);
		expect(probes()).toBe(3);
		expect(reply.body.content[0].text).toBe("a");
		expect(api.endpoint.status().endpoints[0]).toMatchObject({ healthy: true, ready: true, readyReason: null });
		expect(events.map((event) => event.kind)).toEqual(["down", "up"]);
		// Still ready: asked again later, no new event.
		now += 11_000;
		await api.send(ask);
		expect(events).toHaveLength(2);
	});

	it("does not ask an endpoint that has just answered a request", async () => {
		let now = 1_000_000;
		vi.spyOn(Date, "now").mockImplementation(() => now);
		const transport = fleet();
		const api = await make(two({ transport, detect: false }));
		await api.send(ask);
		const probes = () => calls(transport).filter((line) => line.includes("health")).length;
		expect(probes()).toBe(2);
		now += 9000;
		await api.send(ask);
		expect(probes()).toBe(2);
		now += 2000;
		await api.send(ask);
		expect(probes()).toBe(3);
	});

	it("still tries a lone endpoint, and never asks it", async () => {
		const transport = fleet({ a: 503 });
		const api = await make({ upstreams: [{ name: "a", url: "http://a.test", backend: "vllm", models: ["m"] }], transport, detect: false });
		const reply = await api.send(ask);
		expect(reply.status).toBe(200);
		expect(calls(transport)).toEqual(["POST a.test/v1/chat/completions"]);
		expect(api.endpoint.status().endpoints[0]).toMatchObject({ healthy: true, ready: null });
	});

	it("tries a pool in which nothing is ready, in configuration order", async () => {
		const transport = fleet({ a: 503, b: 503 });
		const api = await make(two({ transport, detect: false }));
		const reply = await api.send(ask);
		expect(reply.body.content[0].text).toBe("a");
	});

	it("an answered request marks a not ready endpoint ready again", async () => {
		const transport = fleet({ a: 503, b: 503 });
		const api = await make(two({ transport, detect: false }));
		await api.send(ask);
		expect(api.endpoint.status().endpoints[0]).toMatchObject({ ready: true, healthy: true });
		expect(api.endpoint.status().endpoints[1]).toMatchObject({ ready: false });
	});

	it("a refused connection or a timeout is not ready, with the reason", async () => {
		const transport = fleet({ a: new Error("connect ECONNREFUSED") });
		const api = await make(two({ transport, detect: false }));
		await api.send(ask);
		expect(api.endpoint.status().endpoints[0]).toMatchObject({ ready: false, readyReason: "connect ECONNREFUSED" });
		const slow = fakeTransport((u, init) =>
			u.endsWith("/health")
				? new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("timed out"))))
				: chat("x")
		);
		const timed = await make(two({ transport: slow, detect: false, pool: { healthTimeout: 20 } }));
		expect((await timed.health.check()).endpoints.map((entry) => [entry.ready, entry.readyReason])).toEqual([
			[false, "timed out"],
			[false, "timed out"]
		]);
		const stranger = fakeTransport((u) => {
			if (u.endsWith("/health")) throw Object.assign(new Error(""), { message: undefined });
			return chat("x");
		});
		const odd = await make(two({ transport: stranger, detect: false }));
		expect((await odd.health.check()).endpoints[0].readyReason).toBe("no answer");
	});

	it("a server without /health (a 4xx) is never asked again until the next detection", async () => {
		let now = 1_000_000;
		vi.spyOn(Date, "now").mockImplementation(() => now);
		const transport = fleet({ a: 404 });
		const api = await make(two({ transport, detect: false }));
		await api.send(ask);
		expect(api.endpoint.status().endpoints[0]).toMatchObject({ ready: null, healthy: true });
		now += 60_000;
		await api.send(ask);
		expect(calls(transport).filter((line) => line.includes("a.test/health"))).toHaveLength(1);
		await api.detect({ network: false });
		now += 60_000;
		await api.send(ask);
		expect(calls(transport).filter((line) => line.includes("a.test/health"))).toHaveLength(2);
	});

	it("healthInterval 0 turns the probes off", async () => {
		const transport = fleet({ a: 503 });
		const api = await make(two({ transport, detect: false, pool: { healthInterval: 0 } }));
		const reply = await api.send(ask);
		expect(reply.body.content[0].text).toBe("a");
		expect(calls(transport).some((line) => line.includes("/health"))).toBe(false);
	});

	it("concurrent requests share one probe per endpoint", async () => {
		const transport = fleet();
		const api = await make(two({ transport, detect: false }));
		await Promise.all([api.send(ask), api.send(ask), api.send(ask)]);
		expect(calls(transport).filter((line) => line.includes("a.test/health"))).toHaveLength(1);
	});

	it("an abort during a probe records nothing", async () => {
		const controller = new AbortController();
		const transport = fakeTransport((u) => {
			if (u.endsWith("/health")) {
				controller.abort();
				throw new Error("aborted");
			}
			return chat("x");
		});
		const api = await make(two({ transport, detect: false }));
		await api.send(ask, { signal: controller.signal });
		expect(api.endpoint.status().endpoints.map((entry) => entry.ready)).toEqual([null, null]);
	});

	it("other drivers have no health path and are never probed", async () => {
		const transport = fakeTransport(() => chat("x"));
		const api = await make({
			upstreams: [
				{ name: "a", url: "http://a.test", backend: "openai", models: ["m"] },
				{ name: "b", url: "http://b.test", backend: "openai", models: ["m"] }
			],
			transport,
			detect: false
		});
		await api.send(ask);
		expect(calls(transport)).toEqual(["POST a.test/v1/chat/completions"]);
	});

	it("a body that is not an object is left to request to reject", async () => {
		const api = await make(two({ transport: fleet(), detect: false }));
		expect((await api.send(null)).status).toBe(400);
	});

	it("routes a body without a model like request does, and reports no model", async () => {
		const transport = fleet();
		const api = await make({
			upstreams: [
				{ name: "a", url: "http://a.test", backend: "vllm", models: ["m", "n"] },
				{ name: "b", url: "http://b.test", backend: "vllm", models: ["m", "n"] }
			],
			transport,
			detect: false
		});
		const reply = await api.send({ max_tokens: 8, messages: user });
		expect(reply.status).toBe(200);
		expect(await reply.usage).toMatchObject({ model: null, requested: null });
		expect(calls(transport)).toEqual(["POST a.test/v1/chat/completions"]);
	});

	it("embeddings are gated the same way", async () => {
		const transport = fakeTransport((u) => {
			const url = new URL(u);
			if (url.pathname === "/health") return { status: url.hostname === "a.test" ? 503 : 200, body: "" };
			return {
				body: {
					object: "list",
					data: [{ object: "embedding", index: 0, embedding: [url.hostname === "a.test" ? 1 : 2] }],
					model: "m",
					usage: { prompt_tokens: 1, total_tokens: 1 }
				}
			};
		});
		const api = await make(two({ transport, detect: false }));
		const reply = await api.embeddings.send({ model: "m", input: "x" });
		expect(reply.body.data[0].embedding).toEqual([2]);
	});
});

describe("health.check", () => {
	it("probes every upstream now, a lone one and one that has no /health included, and returns the pool status", async () => {
		const transport = fleet({ a: 503 });
		const api = await make({
			upstreams: [
				{ name: "a", url: "http://a.test", backend: "vllm", models: ["m"] },
				{ name: "c", url: "http://c.test", backend: "openai", models: ["o"] }
			],
			transport,
			detect: false
		});
		const found = await api.health.check();
		expect(found.endpoints.map((entry) => [entry.name, entry.ready])).toEqual([
			["a", false],
			["c", null]
		]);
		expect(calls(transport)).toEqual(["GET a.test/health"]);
		transport.health.a = 200;
		expect((await api.health.check()).endpoints[0]).toMatchObject({ ready: true, healthy: true });
		expect(calls(transport)).toHaveLength(2);
		transport.health.a = 404;
		await api.health.check();
		transport.health.a = 200;
		expect((await api.health.check()).endpoints[0].ready).toBe(true);
		const off = await make({
			upstreams: [{ name: "a", url: "http://a.test", backend: "vllm", models: ["m"] }],
			transport,
			detect: false,
			pool: { healthInterval: 0 }
		});
		expect((await off.health.check({ signal: new AbortController().signal })).endpoints[0].ready).toBe(true);
	});
});

describe("LoRA adapters", () => {
	const listing = {
		object: "list",
		data: [
			{ id: "base", object: "model", owned_by: "vllm", root: "/models/base", parent: null, max_model_len: 4096 },
			{ id: "sql", object: "model", owned_by: "vllm", root: "/lora/sql", parent: "base" },
			{ id: "odd", object: "model", owned_by: "vllm", parent: "" }
		]
	};
	const server = (state = { data: listing }) =>
		fakeTransport((u) => {
			const path = new URL(u).pathname;
			if (path === "/version") return { body: { version: "0.12.0" } };
			if (path === "/v1/models") return { body: state.data };
			if (path === "/v1/chat/completions") return chat("chat");
			return { status: 404, body: {} };
		});

	it("detection keeps the adapters apart from the base models", async () => {
		const api = await make({ upstreams: ["http://gpu.test"], transport: server() });
		const facts = api.status().upstreams[0].facts;
		expect(api.status().upstreams[0].driver).toBe("vllm");
		expect(facts.models).toEqual(["base", "sql", "odd"]);
		expect(facts.adapters).toEqual([{ id: "sql", parent: "base" }]);
		expect(models.baseModels(api.status().upstreams[0].facts ? { facts } : {})).toEqual(["base", "odd"]);
		expect(models.baseModels({ models: ["x"] })).toEqual(["x"]);
		expect(models.baseModels({})).toEqual([]);
	});

	it("tags an adapter with its parent on the OpenAI front, from the live list", async () => {
		const api = await make({ upstreams: ["http://gpu.test"], transport: server(), front: "openai" });
		const { data } = await api.model.list();
		expect(data.find((entry) => entry.id === "sql")).toMatchObject({ id: "sql", object: "model", parent: "base" });
		expect(data.find((entry) => entry.id === "base")).not.toHaveProperty("parent");
		expect(data.find((entry) => entry.id === "odd")).not.toHaveProperty("parent");
		expect((await api.model.get("sql")).parent).toBe("base");
	});

	it("tags an adapter with its parent on the Anthropic front, and an alias of it too", async () => {
		const api = await make({ upstreams: ["http://gpu.test"], transport: server(), aliases: { mine: "sql" } });
		const { data } = await api.model.list();
		expect(data.find((entry) => entry.id === "sql")).toMatchObject({ type: "model", display_name: "sql", parent: "base" });
		expect(data.find((entry) => entry.id === "base")).not.toHaveProperty("parent");
		expect(data.find((entry) => entry.id === "mine")).toMatchObject({ alias_of: "sql", parent: "base" });
	});

	it("lists an adapter known from detection when the server cannot be asked", async () => {
		const transport = fakeTransport((u) => {
			if (new URL(u).pathname === "/v1/models" && transport.calls.length > 2) return { status: 500, body: {} };
			return server()(u);
		});
		const api = await make({ upstreams: ["http://gpu.test"], transport: server() });
		const entries = models.knownModels(api.status().upstreams[0]);
		expect(entries).toEqual([{ id: "base" }, { id: "sql", parent: "base" }, { id: "odd" }]);
		expect(models.knownModels({ models: ["x"] })).toEqual([{ id: "x" }]);
		expect(models.knownModels({})).toEqual([]);
		expect(transport.calls).toHaveLength(0);
	});

	it("an adapter loaded later becomes routable once the list shows it, and an unloaded one stops", async () => {
		const state = { data: { object: "list", data: [listing.data[0]] } };
		const transport = server(state);
		const api = await make({ upstreams: ["http://gpu.test"], transport });
		const sent = async (model) => (await api.request({ model, max_tokens: 8, messages: user })).body.model;
		expect(await sent("late")).toBe("base");
		state.data = listing;
		await api.model.list();
		expect(api.status().upstreams[0].facts.adapters).toEqual([{ id: "sql", parent: "base" }]);
		expect(await sent("sql")).toBe("sql");
		expect(api.route({ model: "sql", messages: user })).toMatchObject({ unserved: false, model: "sql" });
		state.data = { object: "list", data: [listing.data[0]] };
		await api.model.list();
		expect(api.route({ model: "sql", messages: user }).model).toBe("base");
	});

	it("keeps the configured model list, and the facts when the server does not answer", async () => {
		const state = { data: listing };
		const api = await make({ upstreams: [{ url: "http://gpu.test", models: ["base"] }], transport: server(state) });
		await api.model.list();
		expect(api.status().upstreams[0].models).toEqual(["base"]);
		const before = api.status().upstreams[0].facts;
		state.data = "nope";
		const { data } = await api.model.list();
		expect(data.map((entry) => entry.id)).toEqual(["base"]);
		expect(api.status().upstreams[0].facts).toEqual(before);
	});

	it("one base model with adapters is still the single model unknown names fall back to", async () => {
		const api = await make({
			upstreams: ["http://gpu.test"],
			transport: server({ data: { object: "list", data: [listing.data[0], listing.data[1]] } })
		});
		expect(api.route({ model: "claude-sonnet-5", messages: user })).toMatchObject({ model: "base", unserved: false });
	});

	it("a fact-less endpoint lists what the server says without touching facts", async () => {
		const api = await make({ upstreams: [{ url: "http://gpu.test", backend: "vllm" }], transport: server(), detect: false });
		expect(
			(await api.driver.vllm.model.list({ endpoint: { url: "http://gpu.test", facts: null }, transport: server(), timeout: 1000 })).map(
				(entry) => entry.id
			)
		).toEqual(["base", "sql", "odd"]);
	});
});

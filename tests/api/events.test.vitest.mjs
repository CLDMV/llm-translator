/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/events.test.vitest.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:02-07:00 (1792958342)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Events and logging: every source, the general and specific events together, `on` / `off` / `"*"` / `onEvent`,
 * `events: false`, each `logs` mode, the `silent` alias and listeners that fail.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeAll, fakeTransport, make } from "../helpers/translator.mjs";
import { completion } from "../helpers/fake-server.mjs";
import { createTranslator } from "../../src/index.mjs";
import { create, emit, off, on, open } from "../../src/lib/events.mjs";

const scratch = path.resolve("tmp/agents/sub2/events-test");
let spy;

beforeEach(() => {
	rmSync(scratch, { recursive: true, force: true });
	mkdirSync(scratch, { recursive: true });
	spy = { warn: vi.spyOn(console, "warn").mockImplementation(() => {}), error: vi.spyOn(console, "error").mockImplementation(() => {}) };
});

afterEach(async () => {
	spy.warn.mockRestore();
	spy.error.mockRestore();
	vi.restoreAllMocks();
	await closeAll();
	rmSync(scratch, { recursive: true, force: true });
});

const hello = { model: "m", max_tokens: 16, messages: [{ role: "user", content: "hi" }] };
const answer = () => ({ body: completion("ok") });
const refuse = (message, status = 400) => ({ status, body: { error: { message, type: "BadRequestError", code: status } } });

/** Collect every event a translator emits (through `"*"`, which sees each occurrence once). */
function watch(api) {
	const seen = [];
	api.events.on("*", (event) => seen.push(event));
	return seen;
}

/** A translator over one fake vLLM endpoint answering with `handler`. */
const vllm = (handler, config = {}, endpoint = {}) =>
	make({
		upstreams: [{ name: "a", url: "http://a.test", backend: "vllm", settings: { topK: false }, ...endpoint }],
		transport: fakeTransport(handler),
		detect: false,
		...config
	});

describe("the emitter", () => {
	const ctx = (config = {}) => ({ config, state: { warned: new Set(), events: create() } });

	it("fires the specific event, then warning or error, then log, then *, all with one payload", () => {
		const c = ctx();
		const order = [];
		for (const name of ["fallback", "warning", "error", "log", "*"]) on(c.state.events, name, (event) => order.push([name, event]));
		const event = emit(c, { type: "fallback", kind: "images", level: "warn", message: "m", status: 400 });
		expect(order.map(([name]) => name)).toEqual(["fallback", "warning", "log", "*"]);
		for (const [, seen] of order) expect(seen).toBe(event);
		expect(event).toEqual({ type: "fallback", kind: "images", level: "warn", message: "m", time: event.time, status: 400 });
		expect(Object.keys(event).slice(0, 3)).toEqual(["type", "kind", "level"]);
		order.length = 0;
		emit(c, { type: "error", level: "error", message: "boom" });
		expect(order.map(([name]) => name)).toEqual(["error", "log", "*"]);
		order.length = 0;
		const plain = emit(c, { type: "dropped", level: "debug", message: "d" });
		expect(order.map(([name]) => name)).toEqual(["log", "*"]);
		expect(plain).not.toHaveProperty("kind");
		order.length = 0;
		emit(c, { type: "log", message: "plain" });
		expect(order.map(([name]) => name)).toEqual(["log", "*"]);
		expect(order[0][1].level).toBe("info");
	});

	it("subscribes, unsubscribes and removes", () => {
		const c = ctx();
		const fn = vi.fn();
		const stop = on(c.state.events, "log", fn);
		emit(c, { type: "log", message: "1" });
		stop();
		emit(c, { type: "log", message: "2" });
		expect(fn).toHaveBeenCalledTimes(1);
		on(c.state.events, "log", fn);
		off(c.state.events, "log", fn);
		off(c.state.events, "unknown", fn);
		emit(c, { type: "log", message: "3" });
		expect(fn).toHaveBeenCalledTimes(1);
		expect(() => on(c.state.events, "log", "nope")).toThrow(TypeError);
		expect(() => on(c.state.events, 5, () => {})).toThrow(TypeError);
	});

	it("emits nothing to listeners when events are off", () => {
		const c = ctx({ events: false });
		const fn = vi.fn();
		on(c.state.events, "*", fn);
		emit(c, { type: "log", message: "x" });
		expect(fn).not.toHaveBeenCalled();
	});

	it("contains a throwing or rejecting listener and reports it once, never as an event", async () => {
		const c = ctx();
		open(c.state.events, true);
		const seen = [];
		on(c.state.events, "log", () => {
			throw new Error("bad listener");
		});
		on(c.state.events, "warning", async () => Promise.reject(new Error("async bad")));
		on(c.state.events, "*", (event) => seen.push(event));
		emit(c, { type: "log", message: "a" });
		emit(c, { type: "log", message: "b" });
		emit(c, { type: "warning", level: "warn", message: "w" });
		emit(c, { type: "warning", level: "warn", message: "w2" });
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(seen.map((event) => event.type)).toEqual(["log", "log", "warning", "warning"]);
		const lines = spy.warn.mock.calls.map((call) => call[0]);
		expect(lines.filter((line) => line.includes('Event listener for "log" failed: bad listener'))).toHaveLength(1);
		expect(lines.filter((line) => line.includes('Event listener for "warning" failed: async bad'))).toHaveLength(1);
		const quiet = ctx();
		on(quiet.state.events, "log", () => {
			throw "a string";
		});
		expect(() => emit(quiet, { type: "log", message: "x" })).not.toThrow();
	});
});

describe("logging modes", () => {
	const detectDown = () => {
		throw new Error("connection refused");
	};
	const down = (config) => make({ upstreams: ["http://down.test"], transport: fakeTransport(detectDown), ...config });

	it("logs: false (the default) writes nothing anywhere", async () => {
		const api = await down({});
		await api.detect();
		expect(spy.warn).not.toHaveBeenCalled();
		expect(spy.error).not.toHaveBeenCalled();
		expect(existsSync(path.join(scratch, "x.log"))).toBe(false);
	});

	it("logs: true prints warnings once per message while every occurrence is an event", async () => {
		const api = await down({ logs: true });
		const seen = watch(api);
		await api.detect();
		await api.detect();
		expect(spy.warn).toHaveBeenCalledTimes(1);
		expect(spy.warn.mock.calls[0][0]).toMatch(/^\[llm-translator\] Upstream upstream-0 \(http:\/\/down\.test\) did not answer detection/);
		expect(seen.filter((event) => event.kind === "unreachable")).toHaveLength(2);
	});

	it("logs: true prints errors on the console too, once", async () => {
		const api = await vllm(() => ({ status: 500, body: {} }), { logs: true });
		await api.send(hello);
		await api.send(hello);
		expect(spy.error).toHaveBeenCalledTimes(1);
		expect(spy.error.mock.calls[0][0]).toBe("[llm-translator] Upstream a answered HTTP 500");
	});

	it("logs: <relative path> appends JSON lines for every level, resolved against the working directory", async () => {
		vi.spyOn(process, "cwd").mockReturnValue(scratch);
		const api = await vllm(() => answer(), { logs: path.join("deep", "dir", "run.log") }, {});
		await api.send({ ...hello, top_k: 5 });
		const lines = readFileSync(path.join(scratch, "deep", "dir", "run.log"), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(lines.some((line) => line.type === "dropped" && line.level === "debug")).toBe(true);
		expect(lines.every((line) => typeof line.time === "number" && typeof line.message === "string")).toBe(true);
		expect(spy.warn).not.toHaveBeenCalled();
	});

	it("logs: <absolute path> appends, including repeated occurrences, and keeps events working with events: false", async () => {
		const file = path.join(scratch, "abs.log");
		writeFileSync(file, '{"old":true}\n');
		const api = await down({ logs: file, events: false });
		const fn = vi.fn();
		api.events.on("*", fn);
		await api.detect();
		await api.detect();
		const lines = readFileSync(file, "utf8").trim().split("\n");
		expect(JSON.parse(lines[0])).toEqual({ old: true });
		expect(
			lines
				.slice(1)
				.map((line) => JSON.parse(line))
				.filter((line) => line.kind === "unreachable")
		).toHaveLength(3);
		expect(fn).not.toHaveBeenCalled();
		expect(spy.warn).not.toHaveBeenCalled();
	});

	it("an unwritable path prints one notice, switches logging off and never throws from createTranslator", async () => {
		const blocker = path.join(scratch, "blocker");
		writeFileSync(blocker, "a file, not a directory");
		const api = await down({ logs: path.join(blocker, "run.log") });
		await api.detect();
		await api.detect();
		expect(spy.warn).toHaveBeenCalledTimes(1);
		expect(spy.warn.mock.calls[0][0]).toMatch(/could not open the log file .*run\.log .*logging is off/);
		expect(existsSync(path.join(blocker, "run.log"))).toBe(false);
	});

	it("a log file that fails later is reported once and file logging stops", async () => {
		const file = path.join(scratch, "later.log");
		const api = await down({ logs: file });
		unlinkSync(file);
		mkdirSync(file);
		await api.detect();
		await api.detect();
		expect(spy.warn.mock.calls.filter((call) => /could not write the log file/.test(call[0]))).toHaveLength(1);
		rmdirSync(file);
		await api.detect();
		expect(existsSync(file)).toBe(false);
	});

	it("silent: true is an alias for logs: false, and logs wins when both are given", async () => {
		const quiet = await down({ silent: true });
		await quiet.detect();
		expect(spy.warn).not.toHaveBeenCalled();
		const both = await down({ silent: true, logs: true });
		await both.detect();
		expect(spy.warn).toHaveBeenCalledTimes(1);
	});

	it("rejects a logs or onEvent value of the wrong type", async () => {
		await expect(createTranslator({ upstreams: ["http://a.test"], logs: 5, detect: false })).rejects.toMatchObject({
			code: "INVALID_CONFIG"
		});
		await expect(createTranslator({ upstreams: ["http://a.test"], logs: "", detect: false })).rejects.toMatchObject({
			code: "INVALID_CONFIG"
		});
		await expect(createTranslator({ upstreams: ["http://a.test"], onEvent: "x", detect: false })).rejects.toMatchObject({
			code: "INVALID_CONFIG"
		});
	});
});

describe("startup events", () => {
	it("onEvent sees the detection events that fire before createTranslator returns", async () => {
		const seen = [];
		await make({
			upstreams: ["http://down.test"],
			transport: fakeTransport(() => {
				throw new Error("connection refused");
			}),
			onEvent: (event) => seen.push(event)
		});
		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({
			type: "detect",
			kind: "unreachable",
			level: "warn",
			endpoint: "upstream-0",
			url: "http://down.test",
			driver: "compatible"
		});
	});

	it("reports a bound driver at info level, and the PDF libraries that failed to load as detect events", async () => {
		const api = await vllm(() => answer(), {}, { backend: "auto" });
		const seen = watch(api);
		await api.detect({ network: false });
		expect(seen.find((event) => event.kind === "driver")).toMatchObject({
			type: "detect",
			level: "info",
			endpoint: "a",
			driver: "compatible"
		});
		vi.resetModules();
		vi.doMock("../../src/lib/pdf.mjs", () => ({
			load: async () => ({ unpdf: false, canvas: false, errors: { canvas: "no canvas", unpdf: "no unpdf" } })
		}));
		try {
			const startup = [];
			const { createTranslator: fresh } = await import("../../src/index.mjs");
			const pdf = await fresh({
				upstreams: ["http://a.test"],
				detect: false,
				onEvent: (event) => startup.push(event),
				slothlet: { import: (url) => import(url) }
			});
			expect(startup.map((event) => [event.type, event.kind, event.reason])).toEqual([
				["detect", "canvas", "no canvas"],
				["detect", "unpdf", "no unpdf"],
				["detect", "driver", undefined]
			]);
			await pdf.slothlet.shutdown();
		} finally {
			vi.doUnmock("../../src/lib/pdf.mjs");
			vi.resetModules();
		}
	});
});

describe("events.on and events.off", () => {
	it("returns an unsubscribe function, and off removes a listener", async () => {
		const api = await vllm(() => ({ status: 500, body: {} }));
		const fn = vi.fn();
		const stop = api.events.on("error", fn);
		await api.send(hello);
		expect(fn).toHaveBeenCalledTimes(1);
		stop();
		await api.send(hello);
		expect(fn).toHaveBeenCalledTimes(1);
		api.events.on("error", fn);
		api.events.off("error", fn);
		await api.send(hello);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("events: false stops emitting entirely", async () => {
		const api = await vllm(() => ({ status: 500, body: {} }), { events: false });
		const fn = vi.fn();
		api.events.on("*", fn);
		await api.send(hello);
		expect(fn).not.toHaveBeenCalled();
	});

	it("a listener that throws never affects the request", async () => {
		const api = await vllm(() => answer(), { logs: true });
		api.events.on("log", () => {
			throw new Error("listener bug");
		});
		const reply = await api.send({ ...hello, top_k: 5 });
		expect(reply.status).toBe(200);
		expect(reply.body.content[0].text).toBe("ok");
		expect(spy.warn.mock.calls.filter((call) => /listener bug/.test(call[0]))).toHaveLength(1);
	});
});

describe("event sources", () => {
	it("dropped: one debug event per request listing the fields", async () => {
		const api = await vllm(() => answer());
		const seen = watch(api);
		await api.send({ ...hello, top_k: 5 });
		const dropped = seen.filter((event) => event.type === "dropped");
		expect(dropped).toHaveLength(1);
		expect(dropped[0]).toMatchObject({ level: "debug", endpoint: "a", model: "m", fields: ["top_k"] });
		expect(dropped[0].message).toBe("Upstream a: dropped top_k");
	});

	it("effort: snapping fires effort, warning and log together", async () => {
		const api = await vllm(() => answer(), { efforts: { m: ["low", "high"] } });
		const names = [];
		for (const name of ["effort", "warning", "log", "error"]) api.events.on(name, (event) => names.push([name, event]));
		await api.request({ ...hello, output_config: { effort: "medium" } });
		expect(names.map(([name]) => name)).toEqual(["effort", "warning", "log"]);
		expect(names[0][1]).toMatchObject({
			type: "effort",
			level: "warn",
			endpoint: "a",
			model: "m",
			requested: "medium",
			used: "high",
			levels: ["low", "high"]
		});
		expect(names[0][1]).toBe(names[1][1]);
	});

	it("usage: onUsage throwing or rejecting", async () => {
		const api = await vllm(() => answer());
		const seen = watch(api);
		await api.send(hello, {
			onUsage: () => {
				throw new Error("meter down");
			}
		});
		await api.send(hello, { onUsage: async () => Promise.reject(new Error("db down")) });
		await new Promise((resolve) => setTimeout(resolve, 5));
		const usage = seen.filter((event) => event.type === "usage");
		expect(usage.map((event) => [event.kind, event.message])).toEqual([
			["threw", "onUsage threw: meter down"],
			["rejected", "onUsage rejected: db down"]
		]);
		expect(usage[0].level).toBe("warn");
	});

	it("fallback: images, with the endpoint, model, status and the upstream's message", async () => {
		const api = await vllm(
			(_url, init) => (JSON.stringify(JSON.parse(init.body)).includes("image_url") ? refuse("a is not a multimodal model") : answer()),
			{},
			{ settings: { topK: false, images: true } }
		);
		const seen = [];
		for (const name of ["fallback", "warning", "log"]) api.events.on(name, (event) => seen.push(name + ":" + event.kind));
		const reply = await api.send({
			...hello,
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "x" },
						{ type: "image", source: { type: "url", url: "https://x/y.png" } }
					]
				}
			]
		});
		expect(reply.status).toBe(200);
		expect(seen).toEqual(["fallback:images", "warning:images", "log:images"]);
	});

	it("fallback: images and tools carry the status and the upstream's own words", async () => {
		const api = await vllm(
			(_url, init) => {
				const body = JSON.parse(init.body);
				if (JSON.stringify(body).includes("image_url")) return refuse("a is not a multimodal model");
				if (body.tools) return refuse('"auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set');
				return answer();
			},
			{},
			{ settings: { topK: false, images: true, toolFallback: true } }
		);
		const fallbacks = [];
		api.events.on("fallback", (event) => fallbacks.push(event));
		await api.send({
			...hello,
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "x" },
						{ type: "image", source: { type: "url", url: "https://x/y.png" } }
					]
				}
			]
		});
		await api.send({ ...hello, tools: [{ name: "w", description: "d", input_schema: { type: "object", properties: {} } }] });
		expect(fallbacks).toHaveLength(2);
		expect(fallbacks[0]).toMatchObject({
			kind: "images",
			level: "warn",
			endpoint: "a",
			model: "m",
			status: 400,
			reason: "a is not a multimodal model",
			action: "text-only"
		});
		expect(fallbacks[0].message).toContain("refused images");
		expect(fallbacks[1]).toMatchObject({ kind: "tools", status: 400, action: "without-tools" });
		expect(fallbacks[1].reason).toContain("--enable-auto-tool-choice");
	});

	it("fallback: json_object fires once the retry worked, and carries the upstream's message", async () => {
		const handler = (_url, init) => {
			const body = JSON.parse(init.body);
			if (body.output_config?.format) return refuse("output_config.format: Extra inputs are not permitted");
			return {
				body: {
					id: "msg_1",
					type: "message",
					role: "assistant",
					model: "m",
					content: [{ type: "text", text: "{}" }],
					stop_reason: "end_turn",
					stop_sequence: null,
					usage: { input_tokens: 1, output_tokens: 1 }
				}
			};
		};
		const api = await make({
			front: "openai",
			upstreams: [{ name: "a", url: "http://a.test", backend: "anthropic" }],
			transport: fakeTransport(handler),
			detect: false
		});
		const seen = [];
		for (const name of ["fallback", "warning", "log", "*"]) api.events.on(name, (event) => seen.push([name, event]));
		await api.send({ model: "m", max_tokens: 8, messages: [{ role: "user", content: "hi" }], response_format: { type: "json_object" } });
		expect(seen.map(([name]) => name)).toEqual(["fallback", "warning", "log", "*"]);
		expect(seen[0][1]).toMatchObject({
			type: "fallback",
			kind: "json_object",
			level: "warn",
			endpoint: "a",
			model: "m",
			status: 400,
			reason: "output_config.format: Extra inputs are not permitted",
			action: "instruction"
		});
	});

	it("failover and error: a 5xx and a connection failure move on to the next endpoint", async () => {
		const handlers = {
			a: () => ({ status: 503, body: { error: { message: "overloaded" } } }),
			b: () => {
				throw new TypeError("fetch failed");
			},
			c: () => answer()
		};
		const api = await make({
			upstreams: ["a", "b", "c"].map((name) => ({ name, url: `http://${name}.test`, backend: "vllm", models: ["m"] })),
			transport: fakeTransport((url, init) => handlers[new URL(url).hostname.replace(".test", "")](init)),
			detect: false
		});
		const seen = watch(api);
		const reply = await api.send(hello);
		expect(reply.status).toBe(200);
		const errors = seen.filter((event) => event.type === "error");
		expect(errors).toHaveLength(2);
		expect(errors[0]).toMatchObject({ kind: "upstream", level: "error", endpoint: "a", model: "m", status: 503 });
		expect(errors[1]).toMatchObject({ kind: "transport", endpoint: "b" });
		expect(errors[1].message).toContain("Could not reach the upstream (b)");
		const failovers = seen.filter((event) => event.type === "failover");
		expect(failovers.map((event) => [event.from, event.to, event.reason])).toEqual([
			["a", "b", "HTTP 503"],
			["b", "c", errors[1].message]
		]);
		expect(failovers[0]).toMatchObject({ level: "warn", model: "m" });
	});

	it("error: a 5xx upstream error names the upstream's message when it was read, and a body that is not JSON is a 502", async () => {
		const api = await vllm(() => ({ status: 200, body: "not json at all", headers: { "content-type": "text/plain" } }));
		const errors = [];
		api.events.on("error", (event) => errors.push(event));
		const reply = await api.send(hello);
		expect(reply.status).toBe(502);
		expect(errors[0]).toMatchObject({ kind: "upstream", endpoint: "a", status: 502 });
	});

	it("error: an exception while building the request is an error event, an abort is not", async () => {
		const api = await make({
			upstreams: [{ name: "a", url: "http://crash.test" }],
			transport: fakeTransport(() => answer()),
			detect: false
		});
		await api.slothlet.api.add(["driver", "crash"], new URL("../fixtures/driver/crash", import.meta.url).pathname);
		await api.detect();
		const errors = [];
		api.events.on("error", (event) => errors.push(event));
		await expect(api.send(hello)).rejects.toThrow("crash");
		expect(errors).toEqual([expect.objectContaining({ kind: "exception", level: "error", message: "crash" })]);
		const controller = new AbortController();
		controller.abort();
		await expect(api.send(hello, { signal: controller.signal })).rejects.toThrow("crash");
		expect(errors).toHaveLength(1);
	});
});

describe("the server", () => {
	it("sends events to the Fastify logger as structured lines, and route errors also emit an error event", async () => {
		const api = await make({
			upstreams: [{ name: "crash", url: "http://crash.test" }],
			transport: fakeTransport(() => ({ status: 500, body: {} })),
			detect: false
		});
		await api.slothlet.api.add(["driver", "crash"], new URL("../fixtures/driver/crash", import.meta.url).pathname);
		await api.detect();
		const lines = [];
		const app = Fastify({ logger: { level: "debug", stream: { write: (line) => lines.push(JSON.parse(line)) } } });
		await app.register(api.server.plugin);
		const errors = [];
		api.events.on("error", (event) => errors.push(event));
		const reply = await app.inject({ method: "POST", url: "/v1/messages", payload: hello });
		expect(reply.statusCode).toBe(500);
		expect(errors.map((event) => event.kind)).toEqual(["exception", "route"]);
		const logged = lines.filter((line) => line.event?.type === "error");
		// The request's logger carries the event of the request (with its request id); the route error is already logged by Fastify itself.
		expect(logged).toHaveLength(1);
		expect(logged[0]).toMatchObject({ level: 50, msg: "crash", event: { kind: "exception" } });
		expect(logged[0].reqId).toBeDefined();
		await app.close();
		// After close the logger is released: nothing reaches it any more.
		const before = lines.length;
		await api.detect();
		expect(lines).toHaveLength(before);
	});

	it("uses the app logger for events outside a request", async () => {
		const api = await make({
			upstreams: [{ name: "a", url: "http://a.test", backend: "vllm" }],
			transport: fakeTransport(() => answer()),
			detect: false
		});
		const lines = [];
		const app = Fastify({ logger: { level: "debug", stream: { write: (line) => lines.push(JSON.parse(line)) } } });
		await app.register(api.server.plugin);
		await api.detect({ network: false });
		expect(lines.some((line) => line.event?.type === "detect" && line.event.kind === "driver" && line.level === 30)).toBe(true);
		await app.close();
	});

	it("emits a route error for a stream that breaks after it was committed, whatever was thrown", async () => {
		const api = await make({
			upstreams: [{ url: "http://latestring.test" }],
			transport: async () => new Response("{}"),
			settings: { pingInterval: 30 }
		});
		await api.slothlet.api.add(["driver", "latestring"], new URL("../fixtures/driver/latestring", import.meta.url).pathname);
		await api.detect();
		const errors = [];
		api.events.on("error", (event) => errors.push(event));
		const app = Fastify({ logger: false });
		await app.register(api.server.plugin);
		const reply = await app.inject({ method: "POST", url: "/v1/messages", payload: { ...hello, stream: true } });
		expect(reply.body).toContain("event: error");
		expect(errors.map((event) => [event.kind, event.message])).toEqual([
			["exception", "late string"],
			["route", "late string"]
		]);
		await app.close();
	});

	it("emits a route error for an authorize hook that throws", async () => {
		const api = await make({
			upstreams: [{ name: "a", url: "http://a.test", backend: "vllm" }],
			transport: fakeTransport(() => answer()),
			detect: false
		});
		const errors = [];
		api.events.on("error", (event) => errors.push(event));
		const app = Fastify({ logger: false });
		await app.register(api.server.plugin, {
			authorize: () => {
				throw new Error("hook down");
			}
		});
		const reply = await app.inject({ method: "POST", url: "/v1/messages", payload: hello });
		expect(reply.statusCode).toBe(401);
		expect(errors).toEqual([expect.objectContaining({ kind: "route", message: "hook down" })]);
		await app.close();
	});
});

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/hardening.test.vitest.mjs
 *	@Date: 2026-10-25T12:56:54-07:00 (1792958214)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:02-07:00 (1792958342)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { afterEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { closeAll, fakeTransport, make } from "../helpers/translator.mjs";
import { completion, fakeVllm, json } from "../helpers/fake-server.mjs";
import { filterChatBody } from "../../src/lib/passthrough.mjs";
import { isLoopback } from "../../src/lib/http.mjs";
import { merge } from "../../src/lib/cli.mjs";
import * as upstreamError from "../../src/lib/upstream-error.mjs";

afterEach(closeAll);

const hello = { model: "claude-haiku-4-5", max_tokens: 16, messages: [{ role: "user", content: "hi" }] };
const post = (url, body, headers = {}) =>
	fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("unserved models", () => {
	it("sends the only known model of the fallback endpoint and restores the client's name", async () => {
		const server = await fakeVllm();
		try {
			const api = await make({ upstreams: [server.url] });
			const prepared = await api.request(hello);
			expect(prepared.body.model).toBe("qwen3-coder");
			expect(prepared.state).toMatchObject({ model: "claude-haiku-4-5", unserved: false });
			const reply = await api.send(hello);
			expect(reply.body.model).toBe("claude-haiku-4-5");
			expect(server.requests.at(-1).body.model).toBe("qwen3-coder");
		} finally {
			await server.close();
		}
	});

	it("keeps the model when several are served and names it in the 404 with a hint about aliases", async () => {
		const server = await fakeVllm({
			models: ["a", "b"],
			chat: (_req, body, res) =>
				json(res, 404, { error: { message: `The model \`${body.model}\` does not exist.`, type: "NotFoundError", code: 404 } })
		});
		try {
			const api = await make({ upstreams: [server.url] });
			const reply = await api.send(hello);
			expect(server.requests.at(-1).body.model).toBe("claude-haiku-4-5");
			expect(reply.status).toBe(404);
			expect(reply.body.error.message).toContain("claude-haiku-4-5");
			expect(reply.body.error.message).toContain('map it to a served model with "aliases"');
		} finally {
			await server.close();
		}
	});

	it("adds the hint only to 404s of unserved models", async () => {
		const transport = fakeTransport(() => ({ status: 400, body: { error: { message: "bad" } } }));
		const api = await make({ upstreams: [{ url: "http://a.test", backend: "vllm" }], transport, detect: false });
		expect((await api.send(hello)).body.error.message).toBe("bad");
		const served = await make({
			upstreams: [{ url: "http://a.test", backend: "vllm", models: ["claude-haiku-4-5", "x"] }],
			transport: fakeTransport(() => ({ status: 404, body: { error: { message: "nf" } } })),
			detect: false
		});
		expect((await served.send(hello)).body.error.message).toBe("nf");
	});
});

describe("native Anthropic forwarding", () => {
	it("forwards only allow-listed client headers, never authentication", async () => {
		const transport = fakeTransport(() => ({
			body: {
				id: "msg_1",
				type: "message",
				role: "assistant",
				model: "claude-sonnet-5-5",
				content: [{ type: "text", text: "ok" }],
				stop_reason: "end_turn",
				usage: { input_tokens: 1, output_tokens: 1 }
			}
		}));
		const api = await make({ upstreams: [{ url: "https://api.anthropic.com", apiKey: "upstream-key" }], transport, detect: true });
		transport.calls.length = 0;
		const server = await api.server.start({ port: 0 });
		const reply = await post(
			`${server.url}/v1/messages`,
			{ ...hello, model: "claude-sonnet-5-5" },
			{
				"anthropic-beta": "tools-2025",
				"anthropic-version": "2024-01-01",
				"x-claude-code-session-id": "s1",
				"x-api-key": "client-secret",
				authorization: "Bearer client-secret",
				cookie: "c=1"
			}
		);
		expect(reply.status).toBe(200);
		const headers = transport.calls.at(-1).init.headers;
		expect(headers).toMatchObject({
			"anthropic-beta": "tools-2025",
			"anthropic-version": "2024-01-01",
			"x-claude-code-session-id": "s1",
			"x-api-key": "upstream-key"
		});
		expect(JSON.stringify(headers)).not.toContain("client-secret");
		expect(headers.cookie).toBeUndefined();
	});

	it("does not send client headers to an OpenAI-protocol upstream", async () => {
		const transport = fakeTransport(() => ({ body: completion("x") }));
		const api = await make({ upstreams: [{ url: "http://a.test", backend: "vllm" }], transport, detect: false });
		await api.send(hello, { clientHeaders: { "anthropic-beta": "x" } });
		expect(transport.calls.at(-1).init.headers["anthropic-beta"]).toBeUndefined();
	});
});

describe("upstream URL normalization", () => {
	it.each(["http://a.test/v1", "http://a.test/v1/", "http://a.test//", "http://a.test"])("%s", async (url) => {
		const api = await make({ upstreams: [{ url, backend: "vllm" }], detect: false });
		expect((await api.request(hello)).url).toBe("http://a.test/v1/chat/completions");
	});
});

describe("binding without authentication", () => {
	it("recognizes loopback addresses", () => {
		for (const host of ["localhost", "::1", "127.0.0.1", "127.9.9.9"]) expect(isLoopback(host)).toBe(true);
		for (const host of ["0.0.0.0", "::", "192.168.1.5", "myhost"]) expect(isLoopback(host)).toBe(false);
	});

	it("refuses a non-loopback bind without an apiKey unless opted in", async () => {
		const api = await make({ upstreams: [{ url: "http://a.test", backend: "vllm" }], detect: false });
		await expect(api.server.start({ host: "0.0.0.0", port: 0 })).rejects.toMatchObject({ code: "unauthenticated_bind" });
		await expect(api.server.start({ host: "0.0.0.0", port: 0, apiKey: "" })).rejects.toMatchObject({ code: "unauthenticated_bind" });
		const keyed = await api.server.start({ host: "0.0.0.0", port: 0, apiKey: "k" });
		expect(keyed.host).toBe("0.0.0.0");
		const open = await api.server.start({ host: "0.0.0.0", port: 0, allowUnauthenticated: true });
		expect(open.port).toBeGreaterThan(0);
	});

	it("the CLI maps --allow-unauthenticated and its environment variable", () => {
		expect(merge({ "allow-unauthenticated": true }, {}, {}).server).toEqual({ allowUnauthenticated: true });
		expect(merge({}, { LLM_TRANSLATOR_ALLOW_UNAUTHENTICATED: "1" }, {}).server).toEqual({ allowUnauthenticated: true });
		expect(merge({}, { LLM_TRANSLATOR_ALLOW_UNAUTHENTICATED: "0" }, {}).server).toEqual({});
	});

	it("the CLI rejects --model without alias=target", () => {
		expect(() => merge({ model: ["nope"] }, {}, {})).toThrow(/alias=target/);
		expect(() => merge({ model: ["=x"] }, {}, {})).toThrow(/alias=target/);
	});
});

describe("vLLM reasoning effort and thinking budget", () => {
	it("clamps xhigh and max to high unless passthrough is on", async () => {
		const api = await make({ upstreams: [{ url: "http://a.test", backend: "vllm" }], detect: false });
		const clamp = (effort, settings) => api.driver.vllm.request({ model: "m", reasoning_effort: effort }, { settings });
		expect(clamp("xhigh", {}).reasoning_effort).toBe("high");
		expect(clamp("max", {}).reasoning_effort).toBe("high");
		expect(clamp("medium", {}).reasoning_effort).toBe("medium");
		expect(clamp("max", { effortPassthrough: true }).reasoning_effort).toBe("max");
		expect(api.driver.vllm.request({ model: "m", reasoning_effort: "max" }).reasoning_effort).toBe("high");
		expect(api.driver.vllm.request({ model: "m", reasoning_effort: "max" }, {}).reasoning_effort).toBe("high");
		const sent = await make({ upstreams: [{ url: "http://a.test", backend: "vllm", version: "0.30.0" }], detect: false });
		const prepared = await sent.request({ ...hello, output_config: { effort: "max" } });
		expect(prepared.body.reasoning_effort).toBe("high");
		const raw = await make({
			upstreams: [{ url: "http://a.test", backend: "vllm", version: "0.30.0", settings: { effortPassthrough: true } }],
			detect: false
		});
		expect((await raw.request({ ...hello, output_config: { effort: "max" } })).body.reasoning_effort).toBe("max");
	});
});

describe("redirects", () => {
	it("never follows redirects from the upstream", async () => {
		const transport = fakeTransport(() => ({ body: completion("x") }));
		const api = await make({ upstreams: [{ url: "http://a.test", backend: "vllm" }], transport, detect: false });
		await api.send(hello);
		expect(transport.calls.at(-1).init.redirect).toBe("error");
		const probe = await make({ upstreams: ["http://b.test"], transport });
		expect(transport.calls.some((call) => call.url.includes("b.test") && call.init.redirect === "error")).toBe(true);
		const server = await fakeVllm({ handler: (_req, _body, res) => (res.writeHead(302, { location: "http://127.0.0.1:1/" }).end(), true) });
		try {
			const real = await make({ upstreams: [{ url: server.url, backend: "vllm" }], detect: false });
			expect((await real.send(hello)).status).toBe(502);
		} finally {
			await server.close();
		}
		expect(probe.status().upstreams).toHaveLength(1);
	});
});

describe("FastAPI style errors", () => {
	it("reads detail as a string or a list of messages", () => {
		expect(upstreamError.parse({ detail: "Not Found" }, 404).message).toBe("Not Found");
		expect(upstreamError.parse({ detail: [{ msg: "field required" }, { msg: "bad" }, {}] }, 422).message).toBe("field required; bad");
		expect(upstreamError.parse({ detail: [{}] }, 422).message).toBe("upstream returned HTTP 422");
		expect(upstreamError.parse({ detail: [] }, 500).message).toBe("upstream returned HTTP 500");
		expect(upstreamError.parse({ detail: 5 }, 500).message).toBe("upstream returned HTTP 500");
		expect(upstreamError.parse({ detail: "" }, 500).message).toBe("upstream returned HTTP 500");
	});
});

describe("server behavior", () => {
	it("never starts the upstream call when the client left before the handler ran", async () => {
		const upstream = await fakeVllm();
		try {
			const api = await make({ upstreams: [upstream.url] });
			const before = upstream.requests.length;
			const app = Fastify();
			app.addHook("preHandler", async () => pause(150));
			await app.register(api.server.plugin);
			await app.listen({ port: 0, host: "127.0.0.1" });
			const url = `http://127.0.0.1:${app.server.address().port}/v1/messages`;
			const controller = new AbortController();
			const pending = post(url, hello, {}).catch(() => {});
			const aborted = fetch(url, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(hello),
				signal: controller.signal
			}).catch((error) => error);
			await pause(40);
			controller.abort();
			await aborted;
			await pending;
			await pause(300);
			const chatCalls = upstream.requests.slice(before).filter((entry) => entry.url === "/v1/chat/completions");
			expect(chatCalls).toHaveLength(1);
			await app.close();
		} finally {
			await upstream.close();
		}
	});

	it("hides internal error details from clients and logs them", async () => {
		const api = await make({ upstreams: [{ url: "http://crash.test" }], transport: async () => new Response("{}", { status: 500 }) });
		await api.slothlet.api.add(["driver", "crash"], new URL("../fixtures/driver/crash", import.meta.url).pathname);
		await api.detect();
		const lines = [];
		const app = Fastify({ logger: { level: "error", stream: { write: (line) => lines.push(line) } } });
		await app.register(api.server.plugin);
		const reply = await app.inject({ method: "POST", url: "/v1/messages", payload: hello });
		expect(reply.statusCode).toBe(500);
		expect(reply.json().error.message).toBe("Internal server error");
		expect(lines.join("")).toContain("crash");
		await app.close();
	});

	it("reports a failure that happens after the stream was committed as an in-band error event", async () => {
		for (const [host, driver, expected] of [
			["latecrash.test", "latecrash", { type: "api_error", message: "Internal server error" }],
			["lateknown.test", "lateknown", { type: "invalid_request_error", message: "late translator error" }]
		]) {
			const api = await make({
				upstreams: [{ url: `http://${host}` }],
				transport: async () => new Response("{}"),
				settings: { pingInterval: 30 }
			});
			await api.slothlet.api.add(["driver", driver], new URL(`../fixtures/driver/${driver}`, import.meta.url).pathname);
			await api.detect();
			const app = Fastify({ logger: false });
			await app.register(api.server.plugin);
			const reply = await app.inject({ method: "POST", url: "/v1/messages", payload: { ...hello, stream: true } });
			expect(reply.statusCode).toBe(200);
			const last = reply.body.trim().split("\n\n").at(-1);
			expect(last.startsWith("event: error")).toBe(true);
			expect(JSON.parse(last.split("data: ")[1]).error).toMatchObject(expected);
			await app.close();
		}
	});

	it("accepts a valid Bearer key next to an empty x-api-key", async () => {
		const upstream = await fakeVllm();
		try {
			const api = await make({ upstreams: [upstream.url] });
			const server = await api.server.start({ port: 0, apiKey: "k" });
			expect(
				(await post(`${server.url}/v1/messages`, { ...hello, model: "qwen3-coder" }, { "x-api-key": "", authorization: "Bearer k" })).status
			).toBe(200);
			expect((await post(`${server.url}/v1/messages`, hello, { "x-api-key": "" })).status).toBe(401);
		} finally {
			await upstream.close();
		}
	});

	it("two servers on one translator keep their own fronts", async () => {
		const upstream = await fakeVllm();
		try {
			const api = await make({ upstreams: [upstream.url] });
			const anthropic = await api.server.start({ port: 0, front: "anthropic" });
			const openai = await api.server.start({ port: 0, front: "openai" });
			const a = await post(`${anthropic.url}/v1/messages`, { ...hello, model: "qwen3-coder" });
			expect((await a.json()).type).toBe("message");
			const o = await post(`${openai.url}/v1/chat/completions`, { model: "qwen3-coder", messages: hello.messages });
			expect((await o.json()).object).toBe("chat.completion");
			const bad = await post(`${openai.url}/v1/chat/completions`, "x");
			expect((await bad.json()).error).toBeTypeOf("object");
			const models = await (await fetch(`${anthropic.url}/v1/models`)).json();
			expect(models.data[0].type).toBe("model");
			const count = await post(`${anthropic.url}/v1/messages/count_tokens`, { ...hello, model: "qwen3-coder" });
			expect((await count.json()).input_tokens).toBeTypeOf("number");
			expect(api.status().front).toBe("anthropic");
		} finally {
			await upstream.close();
		}
	});
});

describe("pass-through body filter", () => {
	const body = {
		model: "m",
		messages: [],
		stream: true,
		stream_options: { include_usage: true, continuous_usage_stats: true, evil: 1 },
		top_k: 5,
		chat_template_kwargs: { enable_thinking: false },
		kv_transfer_params: { x: 1 },
		vllm_xargs: { y: 1 },
		chat_template: "{{ pwn }}",
		cache_salt: "s",
		priority: 99
	};

	it("keeps standard and documented vLLM fields and drops server controls", () => {
		const out = filterChatBody(body);
		expect(Object.keys(out).sort()).toEqual(["chat_template_kwargs", "messages", "model", "stream", "stream_options", "top_k"]);
		expect(out.stream_options).toEqual({ include_usage: true, continuous_usage_stats: true });
		expect(filterChatBody({ model: "m", stream_options: { evil: 1 } })).toEqual({ model: "m" });
		expect(filterChatBody({ model: "m", stream_options: null })).toEqual({ model: "m" });
	});

	it("applies by default on the server and can be switched off; the library default is off", async () => {
		const transport = fakeTransport(() => ({ body: completion("x") }));
		const config = { front: "openai", upstreams: [{ url: "http://a.test", backend: "vllm" }], transport, detect: false };
		const api = await make(config);
		expect((await api.request(body)).body.kv_transfer_params).toEqual({ x: 1 });
		expect((await api.request(body, { filter: true })).body.kv_transfer_params).toBeUndefined();
		const server = await api.server.start({ port: 0 });
		await post(`${server.url}/v1/chat/completions`, { ...body, stream: false, stream_options: undefined });
		expect(JSON.parse(transport.calls.at(-1).init.body).kv_transfer_params).toBeUndefined();
		const open = await make({ ...config, settings: { passthroughFilter: false } });
		const openServer = await open.server.start({ port: 0 });
		await post(`${openServer.url}/v1/chat/completions`, { ...body, stream: false });
		expect(JSON.parse(transport.calls.at(-1).init.body).kv_transfer_params).toEqual({ x: 1 });
		const configured = await make({ ...config, settings: { passthroughFilter: true } });
		expect((await configured.request(body)).body.kv_transfer_params).toBeUndefined();
	});
});

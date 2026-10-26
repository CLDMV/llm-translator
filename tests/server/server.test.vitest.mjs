/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/server/server.test.vitest.mjs
 *	@Date: 2026-10-25T12:53:10-07:00 (1792957990)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T13:31:33-07:00 (1792960293)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { afterEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { closeAll, make } from "../helpers/translator.mjs";
import { completion, fakeVllm, json, sse, textChunks } from "../helpers/fake-server.mjs";

afterEach(closeAll);

/** Startup asks every vLLM-like upstream whether it accepts images; tests that hang on purpose answer that probe at once. */
const probed = (body, res) => (JSON.stringify(body).includes("image_url") ? (json(res, 200, completion("ok")), true) : false);
const hello = { model: "qwen3-coder", max_tokens: 64, messages: [{ role: "user", content: "hi" }] };
const post = (url, body, headers = {}, signal) =>
	fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Parse an SSE body into `{event, data}` frames (data JSON-decoded when possible).
 * @param {string} text - SSE text.
 * @returns {{event?: string, data?: any, comment?: string}[]} Frames.
 */
function frames(text) {
	return text
		.split("\n\n")
		.filter(Boolean)
		.map((block) => {
			const out = {};
			for (const line of block.split("\n")) {
				if (line.startsWith(":")) out.comment = line.slice(2);
				else if (line.startsWith("event: ")) out.event = line.slice(7);
				else if (line.startsWith("data: ")) {
					const raw = line.slice(6);
					try {
						out.data = JSON.parse(raw);
					} catch {
						out.data = raw;
					}
				}
			}
			return out;
		});
}

describe("server (anthropic front)", () => {
	it("serves the health probes, models and a non-streaming message", async () => {
		const upstream = await fakeVllm();
		try {
			const api = await make({ upstreams: [upstream.url] });
			const server = await api.server.start({ port: 0 });
			expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
			expect((await fetch(`${server.url}/`)).status).toBe(200);
			expect((await fetch(`${server.url}/api/hello`, { method: "HEAD" })).status).toBe(200);
			expect((await fetch(`${server.url}/`, { method: "HEAD" })).status).toBe(200);
			const models = await (await fetch(`${server.url}/v1/models?limit=1000`)).json();
			expect(models.data[0]).toMatchObject({ type: "model", id: "qwen3-coder" });
			const reply = await post(`${server.url}/v1/messages?beta=true`, hello, { "anthropic-version": "2023-06-01", "anthropic-beta": "x" });
			expect(reply.status).toBe(200);
			expect(await reply.json()).toMatchObject({ type: "message", content: [{ type: "text", text: "Hello world" }] });
			const count = await post(`${server.url}/v1/messages/count_tokens`, hello);
			expect(await count.json()).toEqual({ input_tokens: 42 });
			const missing = await fetch(`${server.url}/nope`);
			expect(missing.status).toBe(404);
			expect((await missing.json()).error.type).toBe("not_found_error");
		} finally {
			await upstream.close();
		}
	});

	it("streams Anthropic SSE ending in message_stop and sends pings while the upstream is silent", async () => {
		const upstream = await fakeVllm({
			chat: (_req, _body, res) => sse(res, textChunks(["Hi", "!"], { reasoning: ["think"] }), { stallFirst: 150 })
		});
		try {
			const api = await make({ upstreams: [upstream.url], settings: { pingInterval: 30 } });
			const server = await api.server.start({ port: 0 });
			const reply = await post(`${server.url}/v1/messages`, { ...hello, stream: true });
			expect(reply.status).toBe(200);
			expect(reply.headers.get("content-type")).toMatch(/^text\/event-stream/);
			const out = frames(await reply.text());
			const names = out.map((frame) => frame.event);
			// message_start and an empty thinking block are sent as soon as the reply is committed (before any token); the
			// keep-alives while the upstream is silent are empty thinking deltas (Claude Code ignores `ping` events).
			expect(names[0]).toBe("message_start");
			expect(names.filter((name) => name === "message_start")).toHaveLength(1);
			expect(out[0].data.message.model).toBe(hello.model);
			expect(out[1].data).toMatchObject({ index: 0, content_block: { type: "thinking" } });
			const keepAlives = out.filter(
				(frame) => frame.event === "content_block_delta" && frame.data.index === 0 && frame.data.delta.type === "thinking_delta"
			);
			expect(keepAlives.length).toBeGreaterThanOrEqual(2);
			expect(keepAlives.filter((frame) => frame.data.delta.thinking === "").length).toBeGreaterThanOrEqual(2);
			expect(keepAlives.some((frame) => frame.data.delta.thinking === "think")).toBe(true);
			expect(names.filter((name) => name === "ping")).toHaveLength(0);
			// The upstream's own blocks follow, shifted by one index.
			const first = out.find((frame, position) => position > 1 && frame.event === "content_block_start");
			expect(first.data.index).toBe(1);
			expect(names.at(-2)).toBe("message_delta");
			expect(names.at(-1)).toBe("message_stop");
			expect(out.find((frame) => frame.event === "message_delta").data.delta.stop_reason).toBe("end_turn");
		} finally {
			await upstream.close();
		}
	});

	it("closes the early thinking block and shifts the upstream blocks when the answer starts with text", async () => {
		const upstream = await fakeVllm({
			chat: (_req, _body, res) => sse(res, textChunks(["Hi", "!"]), { stallFirst: 150 })
		});
		try {
			const api = await make({ upstreams: [upstream.url], settings: { pingInterval: 30 } });
			const server = await api.server.start({ port: 0 });
			const out = frames(await (await post(`${server.url}/v1/messages`, { ...hello, stream: true })).text());
			const names = out.map((frame) => frame.event);
			const closed = out.findIndex((frame) => frame.event === "content_block_stop" && frame.data.index === 0);
			expect(out[closed - 1].data.delta.type).toBe("signature_delta");
			expect(out[closed + 1]).toMatchObject({ event: "content_block_start", data: { index: 1, content_block: { type: "text" } } });
			expect(names.filter((name) => name === "message_start")).toHaveLength(1);
			expect(out.filter((frame) => frame.event === "content_block_stop").map((frame) => frame.data.index)).toEqual([0, 1]);
		} finally {
			await upstream.close();
		}
	});

	it("keeps pinging while a buffered tool call produces upstream chunks but no client events", async () => {
		const base = { id: "chatcmpl-1", object: "chat.completion.chunk", created: 1, model: "qwen3-coder" };
		const chunk = (delta, finish = null) => ({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] });
		const fragments = Array.from({ length: 10 }, (_, index) =>
			chunk({ tool_calls: [{ index: 0, function: { arguments: index === 0 ? '{"content":"' : "x".repeat(20) } }] })
		);
		const upstream = await fakeVllm({
			chat: (_req, _body, res) =>
				sse(
					res,
					[
						chunk({ role: "assistant", content: "" }),
						chunk({ tool_calls: [{ index: 0, id: "chatcmpl-tool-1", type: "function", function: { name: "Write", arguments: "" } }] }),
						...fragments,
						chunk({ tool_calls: [{ index: 0, function: { arguments: '"}' } }] }),
						chunk({}, "tool_calls"),
						"[DONE]"
					],
					{ delay: 40 }
				)
		});
		try {
			const api = await make({ upstreams: [upstream.url], settings: { pingInterval: 50, toolStreaming: "buffer" } });
			const server = await api.server.start({ port: 0 });
			const out = frames(await (await post(`${server.url}/v1/messages`, { ...hello, stream: true })).text());
			const names = out.map((frame) => frame.event);
			const start = out.findIndex((frame) => frame.event === "content_block_start" && frame.data.content_block.type === "tool_use");
			// While the tool call is buffered the client must still see keep-alives (a ping, or an empty delta on the early block).
			const emptyDelta = (frame) =>
				frame.event === "content_block_delta" &&
				[frame.data.delta.text, frame.data.delta.thinking, frame.data.delta.partial_json].includes("");
			expect(out.slice(0, start).filter((frame) => frame.event === "ping" || emptyDelta(frame)).length).toBeGreaterThanOrEqual(3);
			expect(names.at(-1)).toBe("message_stop");
			expect(out.find((frame) => frame.event === "message_delta").data.delta.stop_reason).toBe("tool_use");
		} finally {
			await upstream.close();
		}
	});

	it("aborts the upstream request when the client disconnects mid-stream", async () => {
		let upstreamClosed;
		const closed = new Promise((resolve) => (upstreamClosed = resolve));
		const upstream = await fakeVllm({
			chat: (_req, body, res) => {
				if (probed(body, res)) return;
				res.on("close", upstreamClosed);
				res.writeHead(200, { "content-type": "text/event-stream" });
				res.write(`data: ${JSON.stringify(textChunks(["a"])[0])}\n\n`);
			}
		});
		try {
			const api = await make({ upstreams: [upstream.url], settings: { pingInterval: 20 } });
			const server = await api.server.start({ port: 0 });
			const controller = new AbortController();
			const reply = await post(`${server.url}/v1/messages`, { ...hello, stream: true }, {}, controller.signal);
			const reader = reply.body.getReader();
			await reader.read();
			controller.abort();
			await Promise.race([closed, pause(3000).then(() => Promise.reject(new Error("upstream was not aborted")))]);
		} finally {
			await upstream.close();
		}
	});

	it("aborts while still waiting for the upstream to answer", async () => {
		let upstreamClosed;
		const closed = new Promise((resolve) => (upstreamClosed = resolve));
		// Startup probes the model with an image; only the real request is left hanging.
		const upstream = await fakeVllm({
			chat: (_req, body, res) =>
				JSON.stringify(body).includes("image_url") ? json(res, 200, completion("ok")) : void res.on("close", upstreamClosed)
		});
		try {
			const api = await make({ upstreams: [upstream.url] });
			const server = await api.server.start({ port: 0 });
			const controller = new AbortController();
			const pending = post(`${server.url}/v1/messages`, hello, {}, controller.signal).catch((error) => error);
			await pause(100);
			controller.abort();
			expect((await pending).name).toBe("AbortError");
			await Promise.race([closed, pause(3000).then(() => Promise.reject(new Error("upstream was not aborted")))]);
		} finally {
			await upstream.close();
		}
	});

	it("stays silent when the client leaves while the stream is committed but the upstream has not answered", async () => {
		let upstreamClosed;
		const closed = new Promise((resolve) => (upstreamClosed = resolve));
		const upstream = await fakeVllm({ chat: (_req, body, res) => void (probed(body, res) || res.on("close", upstreamClosed)) });
		try {
			const api = await make({ upstreams: [upstream.url], settings: { pingInterval: 30 } });
			const server = await api.server.start({ port: 0 });
			const controller = new AbortController();
			const reply = await post(`${server.url}/v1/messages`, { ...hello, stream: true }, {}, controller.signal);
			const reader = reply.body.getReader();
			await reader.read();
			controller.abort();
			await Promise.race([closed, pause(3000).then(() => Promise.reject(new Error("upstream was not aborted")))]);
		} finally {
			await upstream.close();
		}
	});

	it("drops a streaming request quietly when the client leaves before the ping interval", async () => {
		let upstreamClosed;
		const closed = new Promise((resolve) => (upstreamClosed = resolve));
		const upstream = await fakeVllm({ chat: (_req, body, res) => void (probed(body, res) || res.on("close", upstreamClosed)) });
		try {
			const api = await make({ upstreams: [upstream.url], settings: { pingInterval: 60000 } });
			const server = await api.server.start({ port: 0 });
			const controller = new AbortController();
			const pending = post(`${server.url}/v1/messages`, { ...hello, stream: true }, {}, controller.signal).catch((error) => error);
			await pause(100);
			controller.abort();
			expect((await pending).name).toBe("AbortError");
			await Promise.race([closed, pause(3000).then(() => Promise.reject(new Error("upstream was not aborted")))]);
		} finally {
			await upstream.close();
		}
	});

	it("writes an error event when the upstream stream breaks mid-way", async () => {
		const upstream = await fakeVllm({
			chat: async (_req, _body, res) => {
				res.writeHead(200, { "content-type": "text/event-stream" });
				res.write(`data: ${JSON.stringify(textChunks(["a"])[0])}\n\n`);
				res.write("data: {not json}\n\n");
				res.end();
			}
		});
		try {
			const api = await make({ upstreams: [upstream.url] });
			const server = await api.server.start({ port: 0 });
			const out = frames(await (await post(`${server.url}/v1/messages`, { ...hello, stream: true })).text());
			const last = out.at(-1);
			expect(last.event).toBe("error");
			expect(last.data).toMatchObject({ type: "error", error: { type: "api_error" } });
		} finally {
			await upstream.close();
		}
	});

	it("writes a 502 error event when the connection to the upstream drops", async () => {
		const upstream = await fakeVllm({
			chat: async (_req, _body, res) => {
				res.writeHead(200, { "content-type": "text/event-stream" });
				res.write(`data: ${JSON.stringify(textChunks(["a"])[0])}\n\n`);
				await pause(30);
				res.socket.destroy();
			}
		});
		try {
			const api = await make({ upstreams: [upstream.url] });
			const server = await api.server.start({ port: 0 });
			const out = frames(await (await post(`${server.url}/v1/messages`, { ...hello, stream: true })).text());
			expect(out.at(-1)).toMatchObject({ event: "error", data: { type: "error", error: { type: "api_error" } } });
		} finally {
			await upstream.close();
		}
	});

	it("commits to the stream and reports a late upstream error in-band (anthropic)", async () => {
		const upstream = await fakeVllm({
			chat: async (_req, _body, res) => {
				await pause(120);
				json(res, 400, {
					error: {
						message:
							"This model's maximum context length is 100 tokens. However, your prompt contains 150 input tokens, which exceeds this limit even without any output tokens."
					}
				});
			}
		});
		try {
			const api = await make({ upstreams: [upstream.url], settings: { pingInterval: 30 } });
			const server = await api.server.start({ port: 0 });
			const reply = await post(`${server.url}/v1/messages`, { ...hello, stream: true });
			expect(reply.status).toBe(200);
			const out = frames(await reply.text());
			expect(out.filter((frame) => frame.event === "content_block_delta").length).toBeGreaterThanOrEqual(1);
			expect(out.at(-1)).toEqual({
				event: "error",
				data: { type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 150 tokens > 100 maximum" } }
			});
		} finally {
			await upstream.close();
		}
	});

	it("commits to the stream and reports a late upstream error in-band (openai)", async () => {
		const upstream = await fakeVllm({
			chat: async (_req, _body, res) => {
				await pause(120);
				json(res, 503, { error: { message: "busy" } });
			}
		});
		try {
			const api = await make({ front: "openai", upstreams: [upstream.url], settings: { pingInterval: 30 } });
			const server = await api.server.start({ port: 0 });
			const out = frames(
				await (await post(`${server.url}/v1/chat/completions`, { model: "qwen3-coder", messages: hello.messages, stream: true })).text()
			);
			expect(out.at(-2).data.error).toMatchObject({ message: "busy", type: "server_error" });
			expect(out.at(-1).data).toBe("[DONE]");
		} finally {
			await upstream.close();
		}
	});

	it("keeps real HTTP errors and never sends early pings when pings are disabled", async () => {
		const upstream = await fakeVllm({
			chat: async (_req, _body, res) => {
				await pause(80);
				json(res, 429, { error: { message: "slow down" } }, { "retry-after": "2" });
			}
		});
		try {
			const api = await make({ upstreams: [upstream.url], settings: { pingInterval: 0 } });
			const server = await api.server.start({ port: 0 });
			const reply = await post(`${server.url}/v1/messages`, { ...hello, stream: true });
			expect(reply.status).toBe(429);
			expect(reply.headers.get("retry-after")).toBe("2");
		} finally {
			await upstream.close();
		}
	});

	it("passes upstream errors through in Anthropic shape", async () => {
		const upstream = await fakeVllm({
			chat: (_req, _body, res) => json(res, 400, { error: { message: "bad input", type: "BadRequestError", code: 400 } })
		});
		try {
			const api = await make({ upstreams: [upstream.url] });
			const server = await api.server.start({ port: 0 });
			const reply = await post(`${server.url}/v1/messages`, hello);
			expect(reply.status).toBe(400);
			expect(await reply.json()).toEqual({ type: "error", error: { type: "invalid_request_error", message: "bad input" } });
		} finally {
			await upstream.close();
		}
	});

	it("answers malformed JSON with a 400 and unexpected failures with a 500", async () => {
		const api = await make({ upstreams: [{ url: "http://crash.test" }], transport: async () => new Response("{}", { status: 500 }) });
		await api.slothlet.api.add(["driver", "crash"], new URL("../fixtures/driver/crash", import.meta.url).pathname);
		await api.detect();
		const server = await api.server.start({ port: 0 });
		const bad = await fetch(`${server.url}/v1/messages`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{oops"
		});
		expect(bad.status).toBe(400);
		expect((await bad.json()).type).toBe("error");
		const boom = await post(`${server.url}/v1/messages`, hello);
		expect(boom.status).toBe(500);
		expect((await boom.json()).error.message).toBe("Internal server error");
	});

	it("reports translation errors from count_tokens", async () => {
		const api = await make({ upstreams: [{ url: "http://a.test", backend: "vllm" }], detect: false });
		const server = await api.server.start({ port: 0 });
		const reply = await fetch(`${server.url}/v1/messages/count_tokens`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "[1,2]"
		});
		expect(reply.status).toBe(400);
		expect((await reply.json()).error.message).toBe("The request body must be a JSON object");
	});

	it("requires the configured api key (x-api-key or Bearer) on API routes only", async () => {
		const upstream = await fakeVllm();
		try {
			const api = await make({ upstreams: [upstream.url] });
			const server = await api.server.start({ port: 0, apiKey: ["secret-1", "secret-2"] });
			expect((await fetch(`${server.url}/api/hello`)).status).toBe(200);
			const anonymous = await post(`${server.url}/v1/messages`, hello);
			expect(anonymous.status).toBe(401);
			expect(await anonymous.json()).toEqual({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });
			expect((await post(`${server.url}/v1/messages`, hello, { "x-api-key": "wrong" })).status).toBe(401);
			expect((await post(`${server.url}/v1/messages`, hello, { "x-api-key": "secret-2" })).status).toBe(200);
			expect((await post(`${server.url}/v1/messages`, hello, { authorization: "Bearer secret-1" })).status).toBe(200);
			expect((await post(`${server.url}/v1/messages`, hello, { authorization: "Basic abc" })).status).toBe(401);
			expect((await fetch(`${server.url}/v1/models`)).status).toBe(401);
		} finally {
			await upstream.close();
		}
	});
});

describe("server (openai front)", () => {
	it("serves chat completions, streaming with [DONE], models and rejects anthropic-only routes", async () => {
		const upstream = await fakeVllm();
		try {
			const api = await make({ front: "openai", upstreams: [upstream.url] });
			const server = await api.server.start({ port: 0 });
			const reply = await post(`${server.url}/v1/chat/completions`, { model: "qwen3-coder", messages: hello.messages });
			expect((await reply.json()).choices[0].message.content).toBe("Hello world");
			const streamed = frames(
				await (await post(`${server.url}/v1/chat/completions`, { model: "qwen3-coder", messages: hello.messages, stream: true })).text()
			);
			expect(streamed.at(-1).data).toBe("[DONE]");
			expect(streamed[0].data.object).toBe("chat.completion.chunk");
			const models = await (await fetch(`${server.url}/v1/models`)).json();
			expect(models).toMatchObject({ object: "list", data: [{ id: "qwen3-coder", object: "model" }] });
			expect((await post(`${server.url}/v1/messages`, hello)).status).toBe(404);
			expect((await post(`${server.url}/v1/messages/count_tokens`, hello)).status).toBe(404);
			const unauthorized = await (
				await api.server.start({ port: 0, apiKey: "k" }).then((handle) => post(`${handle.url}/v1/chat/completions`, hello))
			).json();
			expect(unauthorized).toEqual({ error: { message: "invalid x-api-key", type: "authentication_error", param: null, code: null } });
		} finally {
			await upstream.close();
		}
	});

	it("writes an OpenAI-shaped error then [DONE] when the stream breaks, and keeps pings as comments", async () => {
		const upstream = await fakeVllm({
			chat: async (_req, _body, res) => {
				res.writeHead(200, { "content-type": "text/event-stream" });
				await pause(120);
				res.write(`data: ${JSON.stringify(textChunks(["a"])[0])}\n\n`);
				res.write("data: {broken\n\n");
				res.end();
			}
		});
		try {
			const api = await make({ front: "openai", upstreams: [upstream.url], settings: { pingInterval: 30 } });
			const server = await api.server.start({ port: 0 });
			const text = await (
				await post(`${server.url}/v1/chat/completions`, { model: "qwen3-coder", messages: hello.messages, stream: true })
			).text();
			expect(text).toContain(": ping\n\n");
			const out = frames(text);
			expect(out.at(-2).data.error.type).toBe("server_error");
			expect(out.at(-1).data).toBe("[DONE]");
		} finally {
			await upstream.close();
		}
	});
});

describe("server lifecycle and plugin", () => {
	it("start/stop manage handles, honor options.front and listen on IPv6 with a bracketed url", async () => {
		const api = await make({ upstreams: [{ url: "http://a.test", backend: "vllm" }], detect: false });
		const first = await api.server.start({ port: 0, front: "openai" });
		expect(api.status().front).toBe("anthropic");
		expect((await (await fetch(`${first.url}/v1/models`)).json()).object).toBe("list");
		const second = await api.server.start({ port: 0, host: "::1", logger: false, bodyLimit: 1024 });
		expect(second.url).toMatch(/^http:\/\/\[::1\]:\d+$/);
		expect((await fetch(`${second.url}/`)).status).toBe(200);
		await first.close();
		expect((await fetch(`${second.url}/`)).status).toBe(200);
		await api.server.stop();
		await expect(fetch(`${second.url}/`)).rejects.toThrow();
		await api.server.stop();
	});

	it("falls back to port 8787 when no port is given", async () => {
		const api = await make({ upstreams: [{ url: "http://a.test", backend: "vllm" }], detect: false });
		try {
			const handle = await api.server.start({});
			expect(handle.port).toBe(8787);
		} catch (error) {
			// The default port may be taken on this machine; the default was still applied.
			expect(error.code).toBe("EADDRINUSE");
		}
	});

	it("rejects an invalid front", async () => {
		const api = await make({ upstreams: [{ url: "http://a.test", backend: "vllm" }], detect: false });
		await expect(api.server.start({ port: 0, front: "gemini" })).rejects.toMatchObject({ code: "invalid_config" });
	});

	it("registers as a plugin inside the consumer's own Fastify app", async () => {
		const upstream = await fakeVllm();
		try {
			const api = await make({ upstreams: [upstream.url] });
			const app = Fastify();
			app.get("/mine", async () => ({ mine: true }));
			await app.register(api.server.plugin, { prefix: "/llm", apiKey: "k" });
			await app.ready();
			const own = await app.inject({ method: "GET", url: "/mine" });
			expect(own.json()).toEqual({ mine: true });
			const denied = await app.inject({ method: "POST", url: "/llm/v1/messages", payload: hello });
			expect(denied.statusCode).toBe(401);
			const ok = await app.inject({ method: "POST", url: "/llm/v1/messages", payload: hello, headers: { "x-api-key": "k" } });
			expect(ok.statusCode).toBe(200);
			expect(ok.json().type).toBe("message");
			await app.close();
		} finally {
			await upstream.close();
		}
	});

	it("the plugin works without options", async () => {
		const api = await make({ upstreams: [{ url: "http://a.test", backend: "vllm" }], detect: false });
		const app = Fastify();
		await app.register(api.server.plugin);
		expect((await app.inject({ method: "GET", url: "/api/hello" })).statusCode).toBe(200);
		await app.close();
	});

	it("the plugin switches the front and rejects an invalid one", async () => {
		const api = await make({ upstreams: [{ url: "http://a.test", backend: "vllm" }], detect: false });
		const app = Fastify();
		await app.register(api.server.plugin, { front: "openai" });
		expect((await app.inject({ method: "GET", url: "/v1/models" })).json().object).toBe("list");
		await app.close();
		const bad = Fastify();
		await expect(bad.register(api.server.plugin, { front: "nope" })).rejects.toMatchObject({ code: "invalid_config" });
	});
});

describe("end to end: Claude Code shaped traffic through the server to a fake vLLM", () => {
	it("translates a captured-style request (billing header, inline system messages, thinking, deferred tools) into a valid Anthropic stream", async () => {
		const upstream = await fakeVllm({
			tokenizeRejectsInlineSystem: true,
			chat: (_req, _body, res) =>
				sse(res, textChunks(["Reading", " the file."], { reasoning: ["Need to look at it."] }), { stallFirst: 120 })
		});
		try {
			const api = await make({
				upstreams: [upstream.url],
				aliases: { "claude-opus-5-5": "qwen3-coder" },
				settings: { pingInterval: 30 }
			});
			const server = await api.server.start({ port: 0 });
			const body = {
				model: "claude-opus-5-5",
				max_tokens: 128000,
				stream: true,
				metadata: { user_id: JSON.stringify({ device_id: "d", account_uuid: "", session_id: "s" }) },
				thinking: { type: "adaptive", display: "omitted" },
				output_config: { effort: "medium" },
				context_management: { edits: [{ type: "clear_thinking_20251015", keep: "all" }] },
				system: [
					{ type: "text", text: "x-anthropic-billing-header: cc_version=2.1.310; cc_entrypoint=sdk-cli;" },
					{ type: "text", text: "You are a Claude agent, built on Anthropic's Claude Agent SDK.", cache_control: { type: "ephemeral" } },
					{ type: "text", text: "Be helpful.", cache_control: { type: "ephemeral" } }
				],
				tools: [
					{
						name: "Read",
						description: "Read a file",
						input_schema: {
							$schema: "https://json-schema.org/draft/2020-12/schema",
							type: "object",
							properties: { file_path: { type: "string" }, offset: { type: "integer", maximum: 9007199254740991 } },
							required: ["file_path"]
						}
					},
					{
						name: "DeferredToolPlaceholder",
						description: "placeholder",
						input_schema: { type: "object", properties: {} },
						defer_loading: true
					}
				],
				messages: [
					{
						role: "user",
						content: [
							{ type: "text", text: "<system-reminder>context</system-reminder>" },
							{ type: "text", text: "read /tmp/a.txt" }
						]
					},
					{ role: "system", content: "<system-reminder>total_tokens: 1000</system-reminder>" },
					{
						role: "assistant",
						content: [
							{ type: "thinking", thinking: "plan", signature: "SIGFAKE" },
							{ type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "/tmp/a.txt" } }
						]
					},
					{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "1\thello" }] },
					{ role: "system", content: [{ type: "text", text: "<total_tokens>900</total_tokens>", cache_control: { type: "ephemeral" } }] }
				]
			};
			const reply = await post(`${server.url}/v1/messages?beta=true`, body, { "x-api-key": "anything", "anthropic-version": "2023-06-01" });
			expect(reply.status).toBe(200);
			const out = frames(await reply.text());
			const names = out.map((frame) => frame.event);
			const keepAliveEnd = out.findIndex((frame) => frame.event === "content_block_stop" && frame.data.index === 0);
			expect(names.slice(0, 2)).toEqual(["message_start", "content_block_start"]);
			// The model's thinking took over the early block, so only its text block follows.
			expect(names.slice(keepAliveEnd + 1)).toEqual([
				"content_block_start",
				"content_block_delta",
				"content_block_delta",
				"content_block_stop",
				"message_delta",
				"message_stop"
			]);
			expect(out.find((frame) => frame.event === "message_start").data.message.model).toBe("claude-opus-5-5");
			expect(out.find((frame) => frame.event === "message_delta").data.delta.stop_reason).toBe("end_turn");

			const sent = upstream.requests.findLast((entry) => entry.url === "/v1/chat/completions").body;
			expect(sent.model).toBe("qwen3-coder");
			expect(sent.messages[0].role).toBe("system");
			expect(JSON.stringify(sent)).not.toContain("x-anthropic-billing-header");
			expect(sent.messages.filter((message) => message.role === "system")).toHaveLength(1);
			expect(sent.tools.map((tool) => tool.function.name)).toContain("Read");
			expect(sent.stream_options).toMatchObject({ include_usage: true });
		} finally {
			await upstream.close();
		}
	});
});

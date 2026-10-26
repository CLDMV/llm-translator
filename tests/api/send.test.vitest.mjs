/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/send.test.vitest.mjs
 *	@Date: 2026-10-25T12:20:21-07:00 (1792956021)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T13:31:31-07:00 (1792960291)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { completion, fakeVllm, json, sse, textChunks } from "../helpers/fake-server.mjs";

afterEach(closeAll);

const hello = { model: "qwen3-coder", max_tokens: 64, messages: [{ role: "user", content: "hi" }] };

describe("send against a local fake vLLM server", () => {
	it("round-trips a non-streaming request", async () => {
		const server = await fakeVllm();
		try {
			const api = await make({ upstreams: [{ url: server.url, apiKey: "sk-1" }] });
			const reply = await api.send(hello);
			expect(reply.status).toBe(200);
			expect(reply.headers["content-type"]).toBe("application/json");
			expect(reply.body).toMatchObject({ type: "message", content: [{ type: "text", text: "Hello world" }] });
			const call = server.requests.find((entry) => entry.url === "/v1/chat/completions");
			expect(call.headers.authorization).toBe("Bearer sk-1");
			expect(call.body.stream).toBeUndefined();
		} finally {
			await server.close();
		}
	});

	it("round-trips a streaming request into Anthropic events", async () => {
		const server = await fakeVllm();
		try {
			const api = await make({ upstreams: [server.url] });
			const reply = await api.send({ ...hello, stream: true });
			expect(reply.status).toBe(200);
			expect(reply.headers["content-type"]).toMatch(/^text\/event-stream/);
			const events = await collect(reply.stream);
			expect(events[0].event).toBe("message_start");
			expect(events.at(-1).event).toBe("message_stop");
		} finally {
			await server.close();
		}
	});

	it("rewrites a vLLM context overflow into Anthropic's prompt-too-long wording", async () => {
		const server = await fakeVllm({
			chat: (_req, _body, res) =>
				json(res, 400, {
					error: {
						message:
							"This model's maximum context length is 32768 tokens. However, your prompt contains 40000 input tokens, which exceeds this limit even without any output tokens.",
						type: "BadRequestError",
						param: "input_tokens",
						code: 400
					}
				})
		});
		try {
			const api = await make({ upstreams: [server.url] });
			const reply = await api.send(hello);
			expect(reply.status).toBe(400);
			expect(reply.body).toEqual({
				type: "error",
				error: { type: "invalid_request_error", message: "prompt is too long: 40000 tokens > 32768 maximum" }
			});
		} finally {
			await server.close();
		}
	});

	it("keeps status and retry-after on a 429", async () => {
		const server = await fakeVllm({
			chat: (_req, _body, res) =>
				json(res, 429, { error: { message: "slow down", type: "Too Many Requests", code: 429 } }, { "retry-after": "7" })
		});
		try {
			const api = await make({ upstreams: [server.url] });
			const reply = await api.send(hello);
			expect(reply).toMatchObject({
				status: 429,
				headers: { "retry-after": "7" },
				body: { type: "error", error: { type: "rate_limit_error", message: "slow down" } }
			});
		} finally {
			await server.close();
		}
	});

	it("returns a 502 reply when the upstream cannot be reached", async () => {
		const api = await make({ upstreams: [{ url: "http://127.0.0.1:1", backend: "vllm" }], detect: false });
		const reply = await api.send(hello);
		expect(reply.status).toBe(502);
		expect(reply.body.error).toMatchObject({ type: "api_error" });
		expect(reply.body.error.message).toMatch(/Could not reach the upstream \(upstream-0\)/);
	});

	it("throws the abort error instead of a reply when the caller aborted", async () => {
		const server = await fakeVllm({ chat: () => new Promise(() => {}) });
		try {
			const api = await make({ upstreams: [{ url: server.url, backend: "vllm" }], detect: false });
			const controller = new AbortController();
			const pending = api.send(hello, { signal: controller.signal });
			setTimeout(() => controller.abort(), 50);
			await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		} finally {
			await server.close();
		}
	});

	it("reports an unreachable upstream as 502 even when a signal was passed but not aborted", async () => {
		const api = await make({ upstreams: [{ url: "http://127.0.0.1:1", backend: "vllm" }], detect: false });
		const reply = await api.send(hello, { signal: new AbortController().signal });
		expect(reply.status).toBe(502);
	});

	it("replies with a client-shaped error for conversion failures", async () => {
		const server = await fakeVllm();
		try {
			const api = await make({ upstreams: [server.url] });
			const reply = await api.send("nope");
			expect(reply).toMatchObject({ status: 400, body: { type: "error", error: { type: "invalid_request_error" } } });
		} finally {
			await server.close();
		}
	});

	it("rethrows unexpected failures", async () => {
		const api = await make({ upstreams: ["http://crash.test"], transport: fakeTransport(() => ({ status: 500 })) });
		await api.slothlet.api.add(["driver", "crash"], new URL("../fixtures/driver/crash", import.meta.url).pathname);
		await api.detect();
		await expect(api.send(hello)).rejects.toThrow(/crash/);
	});
});

describe("send with a fake transport", () => {
	it("answers 502 when a 200 body is not JSON", async () => {
		const transport = fakeTransport(() => ({ status: 200, body: "<html>", headers: { "content-type": "text/html" } }));
		const api = await make({ upstreams: [{ url: "http://a.test", backend: "vllm" }], transport, detect: false });
		const reply = await api.send(hello);
		expect(reply).toMatchObject({ status: 502, body: { error: { message: "The upstream returned a body that is not JSON" } } });
		const empty = await make({
			upstreams: [{ url: "http://a.test", backend: "vllm" }],
			transport: fakeTransport(() => new Response("", { status: 200 })),
			detect: false
		});
		expect((await empty.send(hello)).status).toBe(502);
	});

	it("turns a plain-text error body into an error message", async () => {
		const transport = fakeTransport(() => new Response("bad gateway text", { status: 502 }));
		const api = await make({ upstreams: [{ url: "http://a.test", backend: "vllm" }], transport, detect: false });
		expect((await api.send(hello)).body.error.message).toBe("bad gateway text");
	});

	it("passes extra headers and the abort signal to the transport", async () => {
		const transport = fakeTransport(() => ({ body: completion("ok") }));
		const api = await make({ upstreams: [{ url: "http://a.test", backend: "vllm" }], transport, detect: false });
		const controller = new AbortController();
		await api.send(hello, { headers: { "x-trace": "t" }, signal: controller.signal });
		expect(transport.calls[0].init.headers["x-trace"]).toBe("t");
		expect(transport.calls[0].init.signal).toBe(controller.signal);
	});

	it("uses the global fetch when no transport is configured", async () => {
		const server = await fakeVllm();
		try {
			const api = await make({ upstreams: [{ url: server.url, backend: "vllm" }], detect: false });
			expect((await api.send(hello)).status).toBe(200);
		} finally {
			await server.close();
		}
	});

	it("streams chunks that arrive slowly", async () => {
		const server = await fakeVllm({ chat: (_req, _body, res) => sse(res, textChunks(["a", "b"]), { delay: 5 }) });
		try {
			const api = await make({ upstreams: [{ url: server.url, backend: "vllm" }], detect: false });
			const reply = await api.send({ ...hello, stream: true });
			expect((await collect(reply.stream)).filter((event) => event.event === "content_block_delta")).toHaveLength(2);
		} finally {
			await server.close();
		}
	});
});

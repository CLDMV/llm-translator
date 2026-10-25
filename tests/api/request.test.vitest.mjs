/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/request.test.vitest.mjs
 *	@Date: 2026-10-25T12:19:29-07:00 (1792955969)
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
import { closeAll, fakeTransport, make } from "../helpers/translator.mjs";

afterEach(closeAll);

const hello = { model: "qwen3-coder", max_tokens: 64, messages: [{ role: "user", content: "hi" }] };
const quiet = () => fakeTransport(() => ({ status: 500 }));

describe("request: anthropic front to an OpenAI-protocol upstream", () => {
	it("routes, converts and builds the upstream call", async () => {
		const api = await make({ upstreams: [{ url: "http://vllm.test", apiKey: "sk-1", backend: "vllm" }], detect: false });
		const result = await api.request({ ...hello, stream: true });
		expect(result).toMatchObject({
			upstream: "upstream-0",
			method: "POST",
			url: "http://vllm.test/v1/chat/completions",
			path: "/v1/chat/completions",
			headers: { "content-type": "application/json", accept: "text/event-stream", authorization: "Bearer sk-1" },
			body: { model: "qwen3-coder", stream: true, max_completion_tokens: 64 },
			state: { v: 1, upstream: "upstream-0", front: "anthropic", native: false, model: "qwen3-coder", stream: true }
		});
		expect(result.state.convert).toBeTypeOf("object");
	});

	it("asks for JSON when the client does not stream, and merges extra headers last", async () => {
		const api = await make({ upstreams: [{ url: "http://vllm.test", backend: "vllm" }], detect: false });
		const result = await api.request(hello, { headers: { "x-request-id": "r1" } });
		expect(result.headers).toMatchObject({ accept: "application/json", "x-request-id": "r1" });
		expect(result.headers.authorization).toBeUndefined();
		expect(result.state.stream).toBe(false);
	});

	it("applies settings in order: endpoint > global > probed > driver > defaults", async () => {
		const api = await make({
			upstreams: [{ url: "http://vllm.test", backend: "vllm", version: "0.12.0", settings: { maxTokensField: "max_tokens" } }],
			settings: { maxTokensField: "max_completion_tokens", topK: false },
			detect: false
		});
		const result = await api.request({ ...hello, top_k: 5 });
		expect(result.body.max_tokens).toBe(64);
		expect(result.body.max_completion_tokens).toBeUndefined();
		expect(result.body.top_k).toBeUndefined();
	});

	it("keeps the client model name in state and sends the alias target upstream", async () => {
		const api = await make({
			upstreams: [{ url: "http://vllm.test", backend: "vllm" }],
			aliases: { "claude-haiku-5-5": "qwen3-coder" },
			detect: false
		});
		const result = await api.request({ ...hello, model: "claude-haiku-5-5" });
		expect(result.body.model).toBe("qwen3-coder");
		expect(result.state.model).toBe("claude-haiku-5-5");
		expect(result.state.convert.model).toBe("claude-haiku-5-5");
	});

	it("removes tool fields the vLLM driver rejects when there are no tools", async () => {
		const api = await make({ upstreams: [{ url: "http://vllm.test", backend: "vllm" }], detect: false });
		const none = await api.request({ ...hello, tools: [], tool_choice: { type: "auto" } });
		expect(none.body.tools).toBeUndefined();
		expect(none.body.tool_choice).toBeUndefined();
		const some = await api.request({
			...hello,
			tools: [{ name: "get_time", description: "time", input_schema: { type: "object", properties: {} } }],
			tool_choice: { type: "auto" }
		});
		expect(some.body.tools).toHaveLength(1);
		expect(some.body.tool_choice).toBe("auto");
	});

	it("rejects a body that is not an object", async () => {
		const api = await make({ upstreams: ["http://vllm.test"], transport: quiet(), detect: false });
		await expect(api.request(null)).rejects.toMatchObject({ code: "invalid_body", status: 400 });
		await expect(api.request([])).rejects.toMatchObject({ code: "invalid_body" });
		await expect(api.request("x")).rejects.toMatchObject({ code: "invalid_body" });
	});
});

describe("request: routing between upstreams", () => {
	const upstreams = [
		{ name: "first", url: "http://one.test", backend: "vllm", models: ["qwen3-coder"] },
		{ name: "second", url: "http://two.test", backend: "compatible", models: ["llama"], default: true },
		{ name: "claude", url: "https://api.anthropic.com", backend: "anthropic" }
	];

	it("picks the endpoint that serves the model", async () => {
		const api = await make({ upstreams, detect: false });
		expect((await api.request({ ...hello, model: "llama" })).upstream).toBe("second");
		expect((await api.request({ ...hello, model: "qwen3-coder" })).upstream).toBe("first");
	});

	it("routes claude-* ids to a native Anthropic upstream", async () => {
		const api = await make({ upstreams, detect: false });
		const result = await api.request({ ...hello, model: "claude-sonnet-5-5" });
		expect(result).toMatchObject({
			upstream: "claude",
			url: "https://api.anthropic.com/v1/messages",
			state: { native: true },
			body: { model: "claude-sonnet-5-5", max_tokens: 64 }
		});
		expect(result.headers["anthropic-version"]).toBe("2023-06-01");
	});

	it("falls back to the endpoint marked default, else the first", async () => {
		const api = await make({ upstreams, detect: false });
		expect((await api.request({ ...hello, model: "unknown" })).upstream).toBe("second");
		expect((await api.request({ ...hello, model: undefined })).upstream).toBe("second");
		const plain = await make({
			upstreams: [
				{ name: "a", url: "http://a.test" },
				{ name: "b", url: "http://b.test" }
			],
			detect: false
		});
		expect((await plain.request({ ...hello, model: "x" })).upstream).toBe("a");
	});

	it("uses models learned by detection and the models from config", async () => {
		const transport = fakeTransport((url) =>
			url.startsWith("http://two.test") ? { body: { data: [{ id: "learned" }] } } : { status: 404, body: {} }
		);
		const api = await make({
			upstreams: [
				{ name: "one", url: "http://one.test" },
				{ name: "two", url: "http://two.test" }
			],
			transport
		});
		expect((await api.request({ ...hello, model: "learned" })).upstream).toBe("two");
	});

	it("does not treat Object.prototype keys as aliases", async () => {
		const api = await make({
			upstreams: [{ name: "x", url: "http://x.test", backend: "vllm", models: ["a", "b"] }],
			detect: false
		});
		expect((await api.request({ ...hello, model: "constructor" })).body.model).toBe("constructor");
	});
});

describe("request: OpenAI front", () => {
	it("passes an OpenAI request to an OpenAI-protocol upstream natively", async () => {
		const api = await make({ front: "openai", upstreams: [{ url: "http://vllm.test", backend: "vllm" }], detect: false });
		const result = await api.request({ model: "m", messages: [{ role: "user", content: "hi" }], stream: true, extra: 1 });
		expect(result).toMatchObject({
			url: "http://vllm.test/v1/chat/completions",
			body: { model: "m", extra: 1, stream: true },
			state: { native: true, front: "openai" }
		});
	});

	it("converts to an Anthropic upstream", async () => {
		const api = await make({
			front: "openai",
			upstreams: [{ url: "https://api.anthropic.com", apiKey: "sk-ant" }],
			detect: true,
			transport: quiet()
		});
		const result = await api.request({ model: "claude-sonnet-5-5", messages: [{ role: "user", content: "hi" }], max_tokens: 10 });
		expect(result).toMatchObject({
			url: "https://api.anthropic.com/v1/messages",
			headers: { "x-api-key": "sk-ant", "anthropic-version": "2023-06-01" },
			state: { native: false, front: "openai" }
		});
		expect(result.body.messages[0].role).toBe("user");
	});
});

describe("request: driver hooks", () => {
	it("calls a third-party driver's request normalizer, adds its headers and uses its chat path", async () => {
		const api = await make({ upstreams: ["http://hooks.test"], transport: quiet() });
		await api.slothlet.api.add(["driver", "hooks"], new URL("../fixtures/driver/hooks", import.meta.url).pathname);
		await api.detect();
		const result = await api.request(hello);
		expect(result).toMatchObject({ url: "http://hooks.test/chat", headers: { "x-driver": "hooks" }, body: { hooked: true } });
	});
});

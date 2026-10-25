/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/token-model.test.vitest.mjs
 *	@Date: 2026-10-25T12:21:46-07:00 (1792956106)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:03-07:00 (1792958343)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { afterEach, describe, expect, it } from "vitest";
import { closeAll, fakeTransport, make } from "../helpers/translator.mjs";
import { fakeVllm } from "../helpers/fake-server.mjs";

afterEach(closeAll);

const hello = { model: "qwen3-coder", max_tokens: 64, system: "be brief", messages: [{ role: "user", content: "hi" }] };

describe("token.count", () => {
	it("asks vLLM's /tokenize with the converted messages", async () => {
		const server = await fakeVllm();
		try {
			const api = await make({ upstreams: [server.url] });
			expect(await api.token.count(hello)).toEqual({ input_tokens: 42 });
			const call = server.requests.filter((entry) => entry.url === "/tokenize").at(-1);
			expect(call.body).toMatchObject({ model: "qwen3-coder", add_generation_prompt: true });
			expect(call.body.messages.map((message) => message.role)).toEqual(["system", "user"]);
		} finally {
			await server.close();
		}
	});

	it("falls back to the character estimate when the server cannot tokenize", async () => {
		const server = await fakeVllm({
			handler: (req, _body, res) => {
				if (req.url === "/tokenize" && req.headers["x-fail"] === "1") {
					res.writeHead(500).end("{}");
					return true;
				}
			}
		});
		try {
			const api = await make({ upstreams: [{ url: server.url, headers: { "x-fail": "1" }, settings: { inlineSystem: "user" } }] });
			const result = await api.token.count(hello, { signal: new AbortController().signal });
			expect(result.input_tokens).toBeGreaterThan(0);
			expect(result.input_tokens).not.toBe(42);
		} finally {
			await server.close();
		}
	});

	it("estimates one token per four characters for drivers without a tokenizer", async () => {
		const api = await make({ front: "openai", upstreams: [{ url: "http://a.test", backend: "compatible" }], detect: false });
		const messages = [{ role: "user", content: "x".repeat(100) }];
		const tools = [{ type: "function", function: { name: "t", parameters: {} } }];
		const result = await api.token.count({ model: "m", messages, tools });
		expect(result).toEqual({ input_tokens: Math.ceil(JSON.stringify([null, messages, tools]).length / 4) });
	});

	it("uses count_tokens on a native Anthropic upstream, without stream and max_tokens", async () => {
		const transport = fakeTransport(() => ({ body: { input_tokens: 99 } }));
		const api = await make({ upstreams: [{ url: "https://api.anthropic.com", apiKey: "k" }], transport });
		expect(await api.token.count({ ...hello, model: "claude-sonnet-5-5", stream: true })).toEqual({ input_tokens: 99 });
		const call = transport.calls.at(-1);
		expect(call.url).toBe("https://api.anthropic.com/v1/messages/count_tokens");
		expect(call.init.headers).toMatchObject({ "x-api-key": "k", "anthropic-version": "2023-06-01" });
		const sent = JSON.parse(call.init.body);
		expect(sent.stream).toBeUndefined();
		expect(sent.max_tokens).toBeUndefined();
		expect(sent.model).toBe("claude-sonnet-5-5");
	});

	it("estimates when Anthropic's count_tokens fails", async () => {
		const transport = fakeTransport(() => ({ status: 500, body: {} }));
		const api = await make({ upstreams: [{ url: "https://api.anthropic.com" }], transport });
		expect((await api.token.count({ ...hello, model: "claude-sonnet-5-5" })).input_tokens).toBeGreaterThan(0);
	});
});

describe("model.list", () => {
	it("lists vLLM's models in the Anthropic shape with aliases and context size", async () => {
		const server = await fakeVllm({ models: ["qwen3-coder", "llama"] });
		try {
			const api = await make({ upstreams: [server.url], aliases: { "claude-haiku-5-5": "llama", "claude-ghost": "missing" } });
			const list = await api.model.list({ signal: new AbortController().signal });
			expect(list.has_more).toBe(false);
			expect(list.first_id).toBe("qwen3-coder");
			expect(list.last_id).toBe("claude-ghost");
			expect(list.data.map((entry) => entry.id)).toEqual(["qwen3-coder", "llama", "claude-haiku-5-5", "claude-ghost"]);
			expect(list.data[0]).toEqual({
				type: "model",
				id: "qwen3-coder",
				display_name: "qwen3-coder",
				created_at: new Date(1700000000 * 1000).toISOString(),
				max_input_tokens: 32768
			});
			expect(list.data[2].max_input_tokens).toBe(32768);
			expect(list.data[3].max_input_tokens).toBeUndefined();
			expect(list.data[3].created_at).toBe("1970-01-01T00:00:00.000Z");
		} finally {
			await server.close();
		}
	});

	it("lists models in the OpenAI shape", async () => {
		const server = await fakeVllm();
		try {
			const api = await make({ front: "openai", upstreams: [{ name: "local", url: server.url }], aliases: { gpt: "qwen3-coder" } });
			const list = await api.model.list();
			expect(list.object).toBe("list");
			expect(list.data[0]).toEqual({ id: "qwen3-coder", object: "model", created: 1700000000, owned_by: "vllm", max_model_len: 32768 });
			expect(list.data[1]).toMatchObject({ id: "gpt", owned_by: "vllm" });
		} finally {
			await server.close();
		}
	});

	it("falls back to configured and detected models when the live listing fails, and handles an empty list", async () => {
		const transport = fakeTransport(() => ({ status: 500, body: {} }));
		const api = await make({
			front: "openai",
			upstreams: [
				{ name: "configured", url: "http://one.test", models: ["m1"] },
				{ name: "none", url: "http://two.test" }
			],
			transport,
			detect: false
		});
		const list = await api.model.list();
		expect(list.data).toEqual([{ id: "m1", object: "model", created: 0, owned_by: "configured" }]);
		const empty = await make({ upstreams: [{ url: "http://two.test" }], transport, detect: false });
		expect(await empty.model.list()).toEqual({ data: [], has_more: false, first_id: null, last_id: null });
	});

	it("falls back to an alias entry without an upstream when its target is unknown", async () => {
		const transport = fakeTransport(() => ({ status: 500, body: {} }));
		const api = await make({ front: "openai", upstreams: [{ url: "http://one.test" }], aliases: { a: "b" }, transport, detect: false });
		expect((await api.model.list()).data).toEqual([{ id: "a", object: "model", created: 0, owned_by: "llm-translator" }]);
	});

	it("lists through the generic, OpenAI and Anthropic drivers", async () => {
		const transport = fakeTransport((url) => ({ body: { data: [{ id: `from:${url}` }] } }));
		const api = await make({
			upstreams: [
				{ name: "generic", url: "http://g.test", backend: "compatible" },
				{ name: "oa", url: "https://api.openai.com", backend: "openai" },
				{ name: "an", url: "https://api.anthropic.com", backend: "anthropic", apiKey: "k" }
			],
			transport,
			detect: false
		});
		const ids = (await api.model.list()).data.map((entry) => entry.id);
		expect(ids).toEqual([
			"from:http://g.test/v1/models",
			"from:https://api.openai.com/v1/models",
			"from:https://api.anthropic.com/v1/models"
		]);
		const anthropicCall = transport.calls.find((call) => call.url.startsWith("https://api.anthropic.com"));
		expect(anthropicCall.init.headers).toMatchObject({ "x-api-key": "k", "anthropic-version": "2023-06-01" });
	});
});

describe("model.list with a driver that has no listing", () => {
	it("uses the models the driver detected", async () => {
		const api = await make({ upstreams: ["http://hooks.test"], transport: fakeTransport(() => ({ status: 500 })) });
		await api.slothlet.api.add(["driver", "hooks"], new URL("../fixtures/driver/hooks", import.meta.url).pathname);
		await api.detect();
		expect((await api.model.list()).data).toEqual([]);
		const configured = await make({
			upstreams: [{ url: "http://hooks.test", models: ["fixed"] }],
			transport: fakeTransport(() => ({ status: 500 }))
		});
		await configured.slothlet.api.add(["driver", "hooks"], new URL("../fixtures/driver/hooks", import.meta.url).pathname);
		await configured.detect();
		expect((await configured.model.list()).data.map((entry) => entry.id)).toEqual(["fixed"]);
	});
});

describe("status", () => {
	it("reports front and upstream facts without secrets", async () => {
		const api = await make({
			upstreams: [{ url: "http://a.test", apiKey: "secret", headers: { authorization: "secret" }, backend: "vllm", version: "0.20.0" }],
			detect: false
		});
		const status = api.status();
		expect(status.front).toBe("anthropic");
		expect(JSON.stringify(status)).not.toContain("secret");
		expect(status.upstreams[0]).toMatchObject({ backend: "vllm", driver: "vllm", version: "0.20.0", models: [] });
	});
});

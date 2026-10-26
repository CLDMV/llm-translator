/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/driver/drivers.test.vitest.mjs
 *	@Date: 2026-10-25T12:22:51-07:00 (1792956171)
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

afterEach(closeAll);

const endpoint = { url: "http://x.test", headers: {}, apiKey: undefined };

describe("driver info", () => {
	it("describes the four built-in drivers in detection order", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		const infos = Object.fromEntries(["vllm", "anthropic", "openai", "compatible"].map((name) => [name, api.driver[name].info()]));
		expect(infos.vllm).toMatchObject({ name: "vllm", protocol: "openai.chat", order: 10, auth: "bearer" });
		expect(infos.anthropic).toMatchObject({ name: "anthropic", protocol: "anthropic.messages", order: 20, auth: "x-api-key" });
		expect(infos.openai).toMatchObject({ name: "openai", protocol: "openai.chat", order: 30 });
		expect(infos.compatible).toMatchObject({ name: "compatible", order: 100 });
		expect(infos.vllm.paths.tokenize).toBe("/tokenize");
		expect(infos.anthropic.headers).toEqual({ "anthropic-version": "2023-06-01" });
	});
});

describe("vllm.settings (version mapping)", () => {
	it.each([
		["0.10.1", { reasoningField: "reasoning_content", thinkingBudget: false, effort: false }],
		["0.15.9", { reasoningField: "reasoning_content", thinkingBudget: false, effort: false }],
		["0.16.0", { reasoningField: "reasoning", thinkingBudget: false, effort: false }],
		["0.19.0rc1", { reasoningField: "reasoning", thinkingBudget: true, effort: false }],
		["0.22.0", { reasoningField: "reasoning", thinkingBudget: true, effort: true }],
		["v0.32.0+cu126", { reasoningField: "reasoning", thinkingBudget: true, effort: true }],
		["1.0.0", { reasoningField: "reasoning", thinkingBudget: true, effort: true }],
		["0.9", { reasoningField: "reasoning_content", thinkingBudget: false, effort: false }],
		["7", { reasoningField: "reasoning", thinkingBudget: true, effort: true }],
		["garbage", { reasoningField: "reasoning", thinkingBudget: false, effort: true }],
		[undefined, { reasoningField: "reasoning", thinkingBudget: false, effort: true }]
	])("version %s", async (version, expected) => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		expect(api.driver.vllm.settings({ version })).toMatchObject({
			...expected,
			maxTokensField: "max_completion_tokens",
			prefill: "continue_final_message",
			topK: true,
			streamUsage: true,
			continuousUsage: true,
			responseFormat: true
		});
	});

	it("defaults to the latest behavior without facts", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		expect(api.driver.vllm.settings().effort).toBe(true);
	});
});

describe("vllm.detect / probe / count over a fake transport", () => {
	it("returns null for a server that is neither vLLM-versioned nor vLLM-owned", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		const transport = fakeTransport((url) =>
			url.endsWith("/version") ? { status: 404, body: {} } : { body: { data: [{ id: "m", owned_by: "me" }, null] } }
		);
		expect(await api.driver.vllm.detect({ endpoint, transport })).toBeNull();
		const broken = fakeTransport(() => {
			throw new Error("down");
		});
		expect(await api.driver.vllm.detect({ endpoint, transport: broken })).toBeNull();
	});

	it("ignores a non-string version and a models body without data", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		const transport = fakeTransport((url) => (url.endsWith("/version") ? { body: { version: 12 } } : { body: { object: "list" } }));
		expect(await api.driver.vllm.detect({ endpoint, transport })).toBeNull();
	});

	it("detects by version alone, without max_model_len", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		const transport = fakeTransport((url) =>
			url.endsWith("/version") ? { body: { version: "0.20.1" } } : { body: { data: [{ id: "m" }] } }
		);
		expect(await api.driver.vllm.detect({ endpoint, transport, timeout: 1000, signal: new AbortController().signal })).toEqual({
			version: "0.20.1",
			models: ["m"],
			maxModelLen: undefined
		});
	});

	it("probe reports user when /tokenize is unreachable and works without facts", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		const transport = fakeTransport(() => {
			throw new Error("down");
		});
		expect(await api.driver.vllm.probe({ endpoint, transport })).toEqual({ inlineSystem: "user" });
		const ok = fakeTransport(() => ({ body: { count: 1 } }));
		expect(await api.driver.vllm.probe({ endpoint, transport: ok, facts: { models: [] } })).toEqual({ inlineSystem: "keep" });
	});

	it("probe can check image support on its own, and reports only what is conclusive", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		const probeWith = (answer) =>
			api.driver.vllm.probe({
				endpoint,
				transport: fakeTransport(() => answer),
				facts: { models: ["m"] },
				want: { inlineSystem: false, images: true }
			});
		expect(await probeWith({ body: { id: "x" } })).toEqual({ images: true });
		expect(await probeWith({ status: 400, body: { error: { message: "m is not a multimodal model" } } })).toEqual({ images: false });
		expect(await probeWith({ status: 400, body: { error: { message: "This model does not support image inputs" } } })).toEqual({
			images: false
		});
		expect(await probeWith({ status: 400, body: { error: { message: "prompt too long" } } })).toEqual({});
		expect(await probeWith({ status: 500, body: "boom" })).toEqual({});
	});

	it("token.count returns null for malformed answers", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		const request = { model: "m", messages: [], tools: undefined };
		expect(await api.driver.vllm.token.count({ endpoint, request, transport: fakeTransport(() => ({ body: { count: "7" } })) })).toBeNull();
		expect(await api.driver.vllm.token.count({ endpoint, request, transport: fakeTransport(() => ({ body: { count: 7 } })) })).toBe(7);
	});

	it("error normalizes flat and nested bodies", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		expect(api.driver.vllm.error(400, { message: "flat", type: "BadRequestError" })).toEqual({
			error: { message: "flat", type: "BadRequestError", param: null, code: 400 }
		});
		expect(api.driver.vllm.error(500, { error: { message: "n", type: "T", param: "p", code: 501 } })).toEqual({
			error: { message: "n", type: "T", param: "p", code: 501 }
		});
	});
});

describe("openai / anthropic / compatible", () => {
	it("openai settings avoid vLLM-only fields", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		expect(api.driver.openai.settings()).toMatchObject({
			topK: false,
			thinking: "reasoning_effort",
			effort: true,
			prefill: "none",
			deferredTools: "drop"
		});
		expect(api.driver.anthropic.settings()).toEqual({});
		expect(api.driver.compatible.settings()).toMatchObject({ continuousUsage: false, thinking: "none", topK: false, effort: false });
	});

	it("openai and generic request normalizers drop empty tool fields", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		const body = { model: "m", messages: [], tools: [], tool_choice: "auto", parallel_tool_calls: true };
		expect(api.driver.openai.request(body)).toEqual({ model: "m", messages: [] });
		expect(api.driver.compatible.request(body)).toEqual({ model: "m", messages: [] });
		expect(api.driver.vllm.request({ model: "m" })).toEqual({ model: "m" });
		const withTools = { model: "m", tools: [{ type: "function" }] };
		expect(api.driver.openai.request(withTools)).toBe(withTools);
	});

	it("host-based detectors match only their own host", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		expect(api.driver.openai.detect({ endpoint: { url: "https://api.openai.com/v1" } })).toEqual({ host: "api.openai.com" });
		expect(api.driver.openai.detect({ endpoint: { url: "https://example.com" } })).toBeNull();
		expect(api.driver.anthropic.detect({ endpoint: { url: "https://api.anthropic.com" } })).toEqual({ host: "api.anthropic.com" });
		expect(api.driver.anthropic.detect({ endpoint: { url: "nope" } })).toBeNull();
	});

	it("compatible detect reports reachability", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		const up = fakeTransport(() => ({ body: { data: [{ id: "a" }, { id: 5 }, null] } }));
		expect(await api.driver.compatible.detect({ endpoint, transport: up })).toEqual({ reachable: true, models: ["a"] });
		const down = fakeTransport(() => ({ status: 503, body: {} }));
		expect(await api.driver.compatible.detect({ endpoint, transport: down })).toEqual({ reachable: false, models: [] });
		const odd = fakeTransport(() => ({ body: { nope: 1 } }));
		expect((await api.driver.compatible.detect({ endpoint, transport: odd })).reachable).toBe(false);
	});

	it("anthropic count_tokens tolerates malformed answers", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		const request = { model: "claude", messages: [] };
		expect(await api.driver.anthropic.token.count({ endpoint, request, transport: fakeTransport(() => ({ body: {} })) })).toBeNull();
	});
});

describe("stream usage options per driver", () => {
	it("only vLLM asks for continuous_usage_stats", async () => {
		const body = { model: "m", max_tokens: 5, stream: true, messages: [{ role: "user", content: "x" }] };
		const options = async (backend) => {
			const api = await make({ upstreams: [{ url: "http://x.test", backend }], detect: false });
			return (await api.request(body)).body.stream_options;
		};
		expect(await options("vllm")).toEqual({ include_usage: true, continuous_usage_stats: true });
		expect(await options("openai")).toEqual({ include_usage: true });
		expect(await options("compatible")).toEqual({ include_usage: true });
	});
});

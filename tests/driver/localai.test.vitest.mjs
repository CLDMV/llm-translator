/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/driver/localai.test.vitest.mjs
 *	@Date: 2026-11-13T09:00:00-08:00 (1794589200)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-13T09:00:00-08:00 (1794589200)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview LocalAI driver: detection through `/version` and the discovery document, reasoning in `reasoning` and `reasoning_content`,
 * and one-tool-call-at-a-time for clients that disable parallel tool use.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { openaiSse } from "../helpers/streams.mjs";
import { isLocalaiDiscovery, isLocalaiVersion } from "../../src/lib/backends.mjs";

afterEach(closeAll);

const VERSION = { version: "v3.9.0 (1a2b3c4d5e6f)" };
const DISCOVERY = {
	version: "v3.9.0 (1a2b3c4d5e6f)",
	endpoints: { models: "/v1/models", chat_completions: "/v1/chat/completions", completions: "/v1/completions" },
	endpoint_groups: {}
};
const MODELS = { object: "list", data: [{ id: "qwen3", object: "model" }] };
const server = (paths) =>
	fakeTransport((url) => {
		const path = new URL(url).pathname;
		return path in paths ? { body: paths[path] } : { status: 404, body: { error: "not found" } };
	});
const chatBody = (transport) => JSON.parse(transport.calls.find((call) => call.url.endsWith("/chat/completions")).init.body);
const messages = [{ role: "user", content: "hi" }];
const url = { url: "http://localai.test", backend: "localai" };

describe("localai detection", () => {
	it("is bound through /version, with the version and models as facts", async () => {
		const transport = server({ "/version": VERSION, "/v1/models": MODELS });
		const api = await make({ upstreams: ["http://localai.test"], transport });
		expect(api.status().upstreams[0]).toMatchObject({ driver: "localai", protocol: "openai.chat", models: ["qwen3"] });
		expect(api.driver.localai.info()).toMatchObject({ order: 52, probes: ["/version", "/.well-known/localai.json"] });
		expect(api.driver.localai.settings()).toMatchObject({ reasoningField: "reasoning", maxTokensField: "max_tokens", topK: true });
		expect(await api.driver.localai.detect({ endpoint: { url: "http://localai.test" }, transport })).toEqual({
			version: "v3.9.0 (1a2b3c4d5e6f)",
			models: ["qwen3"]
		});
	});

	it("is bound through the discovery document alone, and tolerates a failed model list", async () => {
		const api = await make({ upstreams: ["http://localai.test"], transport: server({ "/.well-known/localai.json": DISCOVERY }) });
		expect(api.status().upstreams[0]).toMatchObject({ driver: "localai", facts: { version: "v3.9.0 (1a2b3c4d5e6f)", models: [] } });
	});

	it("wins over vLLM, which also answers /version, and a source build with an empty commit is still LocalAI", async () => {
		const withModels = await make({ upstreams: ["http://localai.test"], transport: server({ "/version": VERSION, "/v1/models": MODELS }) });
		expect(withModels.status().upstreams[0].driver).toBe("localai");
		const source = await make({ upstreams: ["http://localai.test"], transport: server({ "/version": { version: " ()" } }) });
		expect(source.status().upstreams[0].driver).toBe("localai");
	});

	it("never binds another server, and vLLM and SGLang keep theirs", async () => {
		const vllm = await make({
			upstreams: ["http://x.test"],
			transport: server({ "/version": { version: "0.20.1" }, "/v1/models": MODELS })
		});
		expect(vllm.status().upstreams[0].driver).toBe("vllm");
		const sglang = await make({
			upstreams: ["http://y.test"],
			transport: server({ "/version": { version: "0.5.2" }, "/get_server_info": { model_path: "m" } })
		});
		expect(sglang.status().upstreams[0].driver).toBe("sglang");
		const missing = await make({ upstreams: ["http://z.test"], transport: server({}) });
		expect(missing.status().upstreams[0].driver).toBe("compatible");
		const pinned = await make({ upstreams: [{ url: "http://w.test", backend: "compatible" }], transport: server({ "/version": VERSION }) });
		expect(pinned.status().upstreams[0].driver).toBe("compatible");
	});

	it("isLocalaiVersion and isLocalaiDiscovery reject partial shapes", () => {
		expect(isLocalaiVersion(VERSION)).toBe(true);
		expect(isLocalaiVersion({ version: "v3.9.0-14-gabc (ABCDEF)" })).toBe(true);
		for (const version of ["0.20.1", "v3.9.0 (nothex)", "v3.9.0 abc", 3, undefined]) expect(isLocalaiVersion({ version })).toBe(false);
		expect(isLocalaiVersion({})).toBe(false);
		expect(isLocalaiDiscovery(DISCOVERY)).toBe(true);
		expect(isLocalaiDiscovery({})).toBe(false);
		expect(isLocalaiDiscovery({ ...DISCOVERY, version: 1 })).toBe(false);
		expect(isLocalaiDiscovery({ ...DISCOVERY, endpoints: null })).toBe(false);
		expect(isLocalaiDiscovery({ ...DISCOVERY, endpoints: "x" })).toBe(false);
		expect(isLocalaiDiscovery({ ...DISCOVERY, endpoints: { models: "/v1/models" } })).toBe(false);
		expect(isLocalaiDiscovery({ ...DISCOVERY, endpoints: { chat_completions: "/v1/chat/completions" } })).toBe(false);
	});
});

describe("localai.request", () => {
	const tools = [{ type: "function", function: { name: "f", parameters: {} } }];
	const request = async (body, ctx) => (await make({ upstreams: [url], detect: false })).driver.localai.request(body, ctx);

	it("drops empty tool fields and renames repetition_penalty", async () => {
		expect(await request({ model: "m", messages, tools: [], tool_choice: "auto", parallel_tool_calls: true })).toEqual({
			model: "m",
			messages
		});
		expect(await request({ model: "m", messages, repetition_penalty: 1.1 })).toEqual({ model: "m", messages, repeat_penalty: 1.1 });
		expect(await request({ model: "m", messages, repetition_penalty: 1.1, repeat_penalty: 1.3 })).toEqual({
			model: "m",
			messages,
			repeat_penalty: 1.3
		});
	});

	it("takes over parallel_tool_calls: false when the conversion state is there, and leaves it otherwise", async () => {
		const state = {};
		const out = await request({ model: "m", messages, tools, parallel_tool_calls: false }, { state });
		expect(out.parallel_tool_calls).toBeUndefined();
		expect(state.localaiSingleCall).toBe(true);
		expect((await request({ model: "m", messages, tools, parallel_tool_calls: false })).parallel_tool_calls).toBe(false);
		const open = {};
		expect((await request({ model: "m", messages, tools, parallel_tool_calls: true }, { state: open })).parallel_tool_calls).toBe(true);
		expect(open.localaiSingleCall).toBeUndefined();
	});
});

describe("localai reasoning", () => {
	const answer = (message) => ({
		id: "c",
		object: "chat.completion",
		model: "qwen3",
		choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: "stop" }]
	});
	const ask = async (message) => {
		const api = await make({ upstreams: [url], transport: fakeTransport(() => ({ body: answer(message) })) });
		return (await api.send({ model: "qwen3", max_tokens: 16, messages })).body.content;
	};

	it("reads LocalAI's `reasoning` field as a thinking block", async () => {
		expect(await ask({ content: "4", reasoning: "2+2" })).toEqual([
			expect.objectContaining({ type: "thinking", thinking: "2+2" }),
			{ type: "text", text: "4" }
		]);
	});

	it("reads `reasoning_content` too", async () => {
		expect(await ask({ content: "4", reasoning_content: "2+2" })).toEqual([
			expect.objectContaining({ type: "thinking", thinking: "2+2" }),
			{ type: "text", text: "4" }
		]);
	});

	it("reads both fields from a stream", async () => {
		const base = { id: "c", object: "chat.completion.chunk", model: "qwen3" };
		const frame = (delta, finish = null) => ({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] });
		for (const field of ["reasoning", "reasoning_content"]) {
			const frames = [
				frame({ role: "assistant" }),
				frame({ [field]: "2+" }),
				frame({ [field]: "2" }),
				frame({ content: "4" }),
				frame({}, "stop"),
				"[DONE]"
			];
			const transport = fakeTransport(
				() => new Response(openaiSse(frames), { status: 200, headers: { "content-type": "text/event-stream" } })
			);
			const api = await make({ upstreams: [url], transport });
			const reply = await api.send({ model: "qwen3", max_tokens: 16, stream: true, messages });
			const deltas = (await collect(reply.stream))
				.filter((event) => event.event === "content_block_delta")
				.map((event) => event.data.delta);
			expect(
				deltas
					.filter((delta) => delta.type === "thinking_delta")
					.map((delta) => delta.thinking)
					.join("")
			).toBe("2+2");
			expect(
				deltas
					.filter((delta) => delta.type === "text_delta")
					.map((delta) => delta.text)
					.join("")
			).toBe("4");
		}
	});

	it("reasoning sent back on a later turn uses the `reasoning` field", async () => {
		const transport = fakeTransport(() => ({ body: answer({ content: "ok" }) }));
		const api = await make({ upstreams: [url], transport });
		await api.send({
			model: "qwen3",
			max_tokens: 16,
			tools: [{ name: "f", description: "d", input_schema: { type: "object", properties: {} } }],
			messages: [
				{ role: "user", content: "go" },
				{
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "plan", signature: "sig" },
						{ type: "tool_use", id: "toolu_1", name: "f", input: {} }
					]
				},
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "done" }] }
			]
		});
		const sent = chatBody(transport);
		expect(
			sent.messages.find((message) => message.tool_calls)?.reasoning ??
				sent.messages.find((message) => message.tool_calls)?.reasoning_content
		).toBe("plan");
	});
});

describe("localai parallel tool calls", () => {
	const call = (index, name) => ({ index, id: `call_${index}`, type: "function", function: { name, arguments: "{}" } });
	const tools = [
		{ name: "A", description: "a", input_schema: { type: "object", properties: {} } },
		{ name: "B", description: "b", input_schema: { type: "object", properties: {} } }
	];
	const base = { id: "c", object: "chat.completion.chunk", model: "qwen3" };
	const frame = (delta, finish = null) => ({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] });
	const reply = () => ({
		id: "c",
		object: "chat.completion",
		model: "qwen3",
		choices: [
			{ index: 0, message: { role: "assistant", content: null, tool_calls: [call(0, "A"), call(1, "B")] }, finish_reason: "tool_calls" }
		]
	});
	const names = (body) => body.content.filter((block) => block.type === "tool_use").map((block) => block.name);

	it("sends no parallel_tool_calls and keeps the first call when the client disables parallel tool use", async () => {
		const transport = fakeTransport(() => ({ body: reply() }));
		const api = await make({ upstreams: [url], transport });
		const out = await api.send({
			model: "qwen3",
			max_tokens: 16,
			tools,
			tool_choice: { type: "auto", disable_parallel_tool_use: true },
			messages
		});
		expect(chatBody(transport).parallel_tool_calls).toBeUndefined();
		expect(names(out.body)).toEqual(["A"]);
	});

	it("returns every call LocalAI made when parallel tool use is not disabled", async () => {
		const api = await make({ upstreams: [url], transport: fakeTransport(() => ({ body: reply() })) });
		expect(names((await api.send({ model: "qwen3", max_tokens: 16, tools, messages })).body)).toEqual(["A", "B"]);
	});

	it("keeps a single call and a reply without calls as they are", async () => {
		const { response } = (await make({ upstreams: [url], detect: false })).driver.localai;
		const ctx = { state: { convert: { localaiSingleCall: true } } };
		const one = { choices: [{ index: 0, message: { tool_calls: [call(0, "A")] } }] };
		expect(response(one, ctx)).toEqual(one);
		const none = { choices: [null, { index: 0, message: { content: "x" } }] };
		expect(response(none, ctx)).toEqual(none);
		expect(response({ error: "x" }, ctx)).toEqual({ error: "x" });
		expect(response(reply())).toEqual(reply());
	});

	it("drops the fragments of later calls from a stream", async () => {
		const frames = [
			frame({ role: "assistant" }),
			frame({ tool_calls: [call(0, "A")] }),
			frame({ tool_calls: [call(1, "B")] }),
			frame({ tool_calls: [{ function: { arguments: "{}" } }] }),
			frame({}, "tool_calls"),
			"[DONE]"
		];
		const transport = fakeTransport(
			() => new Response(openaiSse(frames), { status: 200, headers: { "content-type": "text/event-stream" } })
		);
		const api = await make({ upstreams: [url], transport });
		const out = await api.send({
			model: "qwen3",
			max_tokens: 16,
			stream: true,
			tools,
			tool_choice: { type: "auto", disable_parallel_tool_use: true },
			messages
		});
		const events = await collect(out.stream);
		const started = events.filter((event) => event.event === "content_block_start" && event.data.content_block.type === "tool_use");
		expect(started.map((event) => event.data.content_block.name)).toEqual(["A"]);
	});

	it("chunk leaves other chunks alone", async () => {
		const { chunk } = (await make({ upstreams: [url], detect: false })).driver.localai;
		const ctx = { state: { convert: { localaiSingleCall: true } } };
		const text = frame({ content: "x" });
		expect(chunk(text, ctx)).toEqual(text);
		expect(chunk({ ...base, choices: [null] }, ctx)).toEqual({ ...base, choices: [null] });
		expect(chunk(undefined, ctx)).toBeUndefined();
		expect(chunk(frame({ tool_calls: [call(1, "B")] }), ctx).choices[0].delta).toEqual({});
		const first = frame({ tool_calls: [call(0, "A"), call(1, "B")] });
		expect(chunk(first, ctx).choices[0].delta.tool_calls).toEqual([call(0, "A")]);
		expect(chunk(first)).toBe(first);
	});
});

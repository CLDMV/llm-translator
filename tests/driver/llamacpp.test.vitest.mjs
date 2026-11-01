/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/driver/llamacpp.test.vitest.mjs
 *	@Date: 2026-10-31T14:00:00-07:00 (1793480400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-31T14:00:00-07:00 (1793480400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview llama.cpp driver: detection against a fake `/props`, request/response/chunk normalizers and tool-call ids.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { openaiSse } from "../helpers/streams.mjs";
import * as tools from "../../src/lib/tools.mjs";

afterEach(closeAll);

const endpoint = { url: "http://llama.test", headers: {}, apiKey: undefined };
const PROPS = { default_generation_settings: { n_ctx: 8192 }, total_slots: 1, build_info: "b6000-abcdef", modalities: { vision: false } };

/**
 * Transport answering GETs from a path table (404 for the rest) and POSTs with `chat`.
 * @param {Record<string, any>} paths - Path to reply body.
 * @param {(init: any) => any} [chat] - Reply for `/v1/chat/completions`.
 * @returns {Function} Fake transport.
 */
const server = (paths, chat = () => ({ status: 500, body: {} })) =>
	fakeTransport((url, init) => {
		const path = new URL(url).pathname;
		if (path === "/v1/chat/completions") return chat(init);
		return path in paths ? { body: paths[path] } : { status: 404, body: { error: "not found" } };
	});
const models = (owner) => ({ object: "list", data: [{ id: "qwen", object: "model", owned_by: owner }] });

describe("llamacpp detection", () => {
	it("is bound through /props and applies its settings", async () => {
		const transport = server({ "/props": PROPS, "/v1/models": models("llamacpp") });
		const api = await make({ upstreams: ["http://llama.test"], transport });
		const [upstream] = api.status().upstreams;
		expect(upstream).toMatchObject({ driver: "llamacpp", protocol: "openai.chat", models: ["qwen"] });
		expect(upstream.facts).toEqual({ models: ["qwen"], build: "b6000-abcdef", vision: false });
		// vision: false from /props becomes images: false
		expect(api.driver.llamacpp.settings(upstream.facts)).toMatchObject({
			images: false,
			reasoningField: "reasoning_content",
			maxTokensField: "max_tokens"
		});
	});

	it("is bound through owned_by alone when /props is missing", async () => {
		const api = await make({ upstreams: ["http://llama.test"], transport: server({ "/v1/models": models("llamacpp") }) });
		expect(api.status().upstreams[0]).toMatchObject({
			driver: "llamacpp",
			facts: { models: ["qwen"], build: undefined, vision: undefined }
		});
		expect(api.driver.llamacpp.settings({}).images).toBeUndefined();
		expect(api.driver.llamacpp.settings().topK).toBe(true);
	});

	it("is bound through /props when the model list is unavailable", async () => {
		const api = await make({ upstreams: ["http://llama.test"], transport: server({ "/props": { total_slots: 2 } }) });
		expect(api.status().upstreams[0]).toMatchObject({ driver: "llamacpp", facts: { models: [] } });
	});

	it("does not take another server for llama.cpp", async () => {
		const other = server({ "/props": "<html>not json</html>", "/v1/models": models("library") });
		const api = await make({ upstreams: ["http://llama.test"], transport: other });
		expect(api.status().upstreams[0].driver).toBe("compatible");
		const odd = server({ "/props": null, "/v1/models": models("library") });
		expect(await api.driver.llamacpp.detect({ endpoint, transport: odd })).toBeNull();
	});

	it("an explicit backend skips detection", async () => {
		const transport = server({});
		const api = await make({ upstreams: [{ url: "http://llama.test", backend: "llamacpp" }], transport });
		expect(api.status().upstreams[0].driver).toBe("llamacpp");
		expect(transport.calls).toHaveLength(0);
	});

	it("does not probe llama.cpp paths on a vLLM server, and asks each path once on a generic one", async () => {
		const vllm = server({ "/version": { version: "0.20.0" }, "/v1/models": models("vllm") });
		await make({ upstreams: ["http://llama.test"], transport: vllm });
		expect(vllm.calls.some((call) => call.url.endsWith("/props"))).toBe(false);
		const generic = server({ "/v1/models": models("library") });
		await make({ upstreams: ["http://llama.test"], transport: generic });
		const gets = generic.calls.map((call) => new URL(call.url).pathname);
		expect(gets.filter((path) => path === "/v1/models")).toHaveLength(1);
		expect(gets.filter((path) => path === "/props")).toHaveLength(1);
	});

	it("is not mistaken for vLLM when it answers /version", async () => {
		const transport = server({ "/version": { version: "b6000" }, "/props": PROPS, "/v1/models": models("llamacpp") });
		const api = await make({ upstreams: ["http://llama.test"], transport });
		expect(api.status().upstreams[0].driver).toBe("llamacpp");
	});
});

describe("llamacpp.request", () => {
	const tool = [{ type: "function", function: { name: "f", parameters: {} } }];

	it("asks for parallel tool calls unless told otherwise", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		const { request } = api.driver.llamacpp;
		expect(request({ model: "m", messages: [], tools: tool }, { settings: {} }).parallel_tool_calls).toBe(true);
		expect(request({ model: "m", messages: [], tools: tool })).toMatchObject({ parallel_tool_calls: true });
		expect(request({ model: "m", messages: [], tools: tool, parallel_tool_calls: false }, { settings: {} }).parallel_tool_calls).toBe(
			false
		);
		expect(
			request({ model: "m", messages: [], tools: tool }, { settings: { parallelToolCalls: false } }).parallel_tool_calls
		).toBeUndefined();
		expect(request({ model: "m", messages: [], tools: [], parallel_tool_calls: true })).toEqual({ model: "m", messages: [] });
	});

	it("renames repetition_penalty to repeat_penalty", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		const { request } = api.driver.llamacpp;
		expect(request({ model: "m", messages: [], repetition_penalty: 1.1 })).toEqual({ model: "m", messages: [], repeat_penalty: 1.1 });
		expect(request({ model: "m", messages: [], repetition_penalty: 1.1, repeat_penalty: 1.3 }).repeat_penalty).toBe(1.3);
	});
});

describe("llamacpp.response and tool-call ids", () => {
	const call = (id) => ({ type: "function", function: { name: "Read", arguments: '{"a":1}' }, ...(id ? { id } : {}) });
	const completion = (message) => ({
		id: "c",
		object: "chat.completion",
		model: "qwen",
		choices: [{ index: 0, message, finish_reason: "tool_calls" }]
	});

	it("gives tool calls without an id one and keeps real ids", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		const out = api.driver.llamacpp.response(
			completion({ role: "assistant", content: null, tool_calls: [call(), call("call_real"), call("")] })
		);
		const ids = out.choices[0].message.tool_calls.map((entry) => entry.id);
		expect(ids[0]).toMatch(/^call_[0-9a-f]+$/);
		expect(ids[1]).toBe("call_real");
		expect(ids[2]).toMatch(/^call_/);
		expect(ids[0]).not.toBe(ids[2]);
	});

	it("leaves other bodies alone", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		const { response } = api.driver.llamacpp;
		expect(response({ error: "x" })).toEqual({ error: "x" });
		expect(response(null)).toBeNull();
		const plain = completion({ role: "assistant", content: "hi" });
		expect(response(plain)).toEqual(plain);
		expect(response({ choices: [null, { index: 1 }] }).choices).toEqual([null, { index: 1 }]);
	});

	it("reads reasoning_format deepseek (reasoning_content only) and none (tags only)", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		const { response } = api.driver.llamacpp;
		const field = completion({ role: "assistant", content: "answer", reasoning_content: "why" });
		expect(response(field).choices[0].message).toMatchObject({ content: "answer", reasoning_content: "why" });
		const tags = completion({ role: "assistant", content: "<think>why</think>answer" });
		expect(response(tags).choices[0].message.content).toBe("<think>why</think>answer");
	});

	it("reads reasoning_format deepseek-legacy without duplicating the reasoning", async () => {
		const transport = server({ "/v1/models": models("llamacpp") }, () => ({
			body: completion({ role: "assistant", content: "<think>why</think>\n\nanswer", reasoning_content: "why" })
		}));
		const api = await make({ upstreams: [{ url: "http://llama.test", backend: "llamacpp" }], transport });
		const reply = await api.send({ model: "qwen", max_tokens: 8, messages: [{ role: "user", content: "hi" }] });
		expect(reply.body.content.map((block) => block.type)).toEqual(["thinking", "text"]);
		expect(reply.body.content[0].thinking).toBe("why");
		expect(reply.body.content[1].text).toBe("answer");
	});

	it("Anthropic front: a tool call without an id still round-trips, streaming and not", async () => {
		const message = { role: "assistant", content: null, tool_calls: [call()] };
		const api = await make({
			upstreams: [{ url: "http://llama.test", backend: "llamacpp" }],
			transport: server({}, () => ({ body: completion(message) }))
		});
		const reply = await api.send({ model: "qwen", max_tokens: 8, messages: [{ role: "user", content: "hi" }] });
		expect(reply.body.content[0]).toMatchObject({ type: "tool_use", name: "Read" });
		expect(reply.body.content[0].id).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it("OpenAI front, native: the client receives an id for every tool call", async () => {
		const api = await make({
			front: "openai",
			upstreams: [{ url: "http://llama.test", backend: "llamacpp" }],
			transport: server({}, () => ({ body: completion({ role: "assistant", content: null, tool_calls: [call()] }) }))
		});
		const reply = await api.send({ model: "qwen", messages: [{ role: "user", content: "hi" }] });
		expect(reply.body.choices[0].message.tool_calls[0].id).toMatch(/^call_/);
	});
});

describe("llamacpp.chunk and streamed tool calls", () => {
	const base = { id: "c", object: "chat.completion.chunk", model: "qwen" };
	const frame = (calls) => ({ ...base, choices: [{ index: 0, delta: { tool_calls: calls }, finish_reason: null }] });
	const start = (index, name, id) => ({ index, type: "function", function: { name, arguments: "" }, ...(id ? { id } : {}) });
	const fragment = (index, text) => ({ index, function: { arguments: text } });

	it("makes an id once per call, on the fragment that carries the name", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		const { chunk } = api.driver.llamacpp;
		const ctx = { state: {} };
		const first = chunk(frame([start(0, "Read")]), ctx).choices[0].delta.tool_calls[0];
		expect(first.id).toMatch(/^call_/);
		expect(chunk(frame([fragment(0, '{"a"')]), ctx).choices[0].delta.tool_calls[0].id).toBeUndefined();
		const second = chunk(frame([start(1, "Write"), fragment(0, ":1}")]), ctx).choices[0].delta.tool_calls;
		expect(second[0].id).toMatch(/^call_/);
		expect(second[0].id).not.toBe(first.id);
		expect(second[1].id).toBeUndefined();
		expect(chunk(frame([start(0, "Read")]), ctx).choices[0].delta.tool_calls[0].id).toBeUndefined();
		expect(ctx.state.toolIds[0]).toBe(first.id);
	});

	it("passes through chunks without tool calls, real ids and calls without an index", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		const { chunk } = api.driver.llamacpp;
		const text = { ...base, choices: [{ index: 0, delta: { content: "hi" } }] };
		expect(chunk(text, { state: {} })).toBe(text);
		expect(chunk({ ...base, choices: [] }, { state: {} }).choices).toEqual([]);
		expect(chunk(frame([start(0, "Read")]))).toEqual(frame([start(0, "Read")]));
		const real = frame([start(0, "Read", "call_real")]);
		expect(chunk(real, { state: {} }).choices[0].delta.tool_calls[0].id).toBe("call_real");
		const noIndex = { type: "function", function: { name: "Read", arguments: "{}" } };
		expect(chunk(frame([noIndex]), { state: {} }).choices[0].delta.tool_calls[0].id).toMatch(/^call_/);
	});

	it("Anthropic front streams a tool call the server sent without an id", async () => {
		const frames = [
			{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
			frame([start(0, "Read")]),
			frame([fragment(0, '{"a":1}')]),
			{ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
			"[DONE]"
		];
		const api = await make({
			upstreams: [{ url: "http://llama.test", backend: "llamacpp" }],
			transport: server({}, () => new Response(openaiSse(frames), { status: 200, headers: { "content-type": "text/event-stream" } }))
		});
		const reply = await api.send({ model: "qwen", max_tokens: 8, stream: true, messages: [{ role: "user", content: "hi" }] });
		const events = await collect(reply.stream);
		const started = events.find((event) => event.event === "content_block_start" && event.data.content_block.type === "tool_use");
		expect(started.data.content_block).toMatchObject({ name: "Read" });
		expect(started.data.content_block.id).toMatch(/^[A-Za-z0-9_-]+$/);
	});
});

describe("deepseek-legacy in a stream", () => {
	const base = { id: "c", object: "chat.completion.chunk", model: "qwen" };
	const frame = (delta, finish = null) => ({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] });
	const run = async (deltas, front = "anthropic") => {
		const frames = [frame({ role: "assistant", content: "" }), ...deltas.map((delta) => frame(delta)), frame({}, "stop"), "[DONE]"];
		const transport = server({}, () => new Response(openaiSse(frames), { status: 200, headers: { "content-type": "text/event-stream" } }));
		const api = await make({ front, upstreams: [{ url: "http://llama.test", backend: "llamacpp" }], transport });
		const body = front === "openai" ? { model: "qwen", stream: true } : { model: "qwen", max_tokens: 16, stream: true };
		const reply = await api.send({ ...body, messages: [{ role: "user", content: "hi" }] });
		return await collect(reply.stream);
	};
	const anthropic = (events) => ({
		types: events.filter((e) => e.event === "content_block_start").map((e) => e.data.content_block.type),
		thinking: events
			.filter((e) => e.data?.delta?.type === "thinking_delta")
			.map((e) => e.data.delta.thinking)
			.join(""),
		text: events
			.filter((e) => e.data?.delta?.type === "text_delta")
			.map((e) => e.data.delta.text)
			.join("")
	});

	it("drops the repeated think block, matching the non-streaming result", async () => {
		const whole = await run([{ reasoning_content: "r1" }, { content: "<think>r1</think>" }, { content: "answer" }]);
		expect(anthropic(whole)).toEqual({ types: ["thinking", "text"], thinking: "r1", text: "answer" });
		const answer = anthropic(await run([{ reasoning_content: "r1" }, { content: "<think>r1</think>\n\nanswer" }]));
		expect(answer).toEqual({ types: ["thinking", "text"], thinking: "r1", text: "answer" });
	});

	it("handles both tags split across chunks and reasoning that arrives in the same chunk", async () => {
		const split = await run([
			{ reasoning_content: "r1" },
			{ content: "<thi" },
			{ content: "nk>r1</th" },
			{ content: "ink>\n\nans" },
			{ content: "wer" }
		]);
		expect(anthropic(split)).toEqual({ types: ["thinking", "text"], thinking: "r1", text: "answer" });
		const same = await run([{ reasoning_content: "r1", content: "<think>r1</think>answer" }]);
		expect(anthropic(same)).toEqual({ types: ["thinking", "text"], thinking: "r1", text: "answer" });
		const spaced = await run([{ reasoning_content: "r1" }, { content: "  " }, { content: "<think>r1" }, { content: " more</think>x" }]);
		expect(anthropic(spaced).text).toBe("x");
	});

	it("leaves the plain deepseek format alone, including text that only starts like a tag", async () => {
		expect(anthropic(await run([{ reasoning_content: "r1" }, { content: "answer" }, { content: " more" }]))).toEqual({
			types: ["thinking", "text"],
			thinking: "r1",
			text: "answer more"
		});
		expect(anthropic(await run([{ reasoning_content: "r1" }, { content: "<" }, { content: "b>bold</b>" }])).text).toBe("<b>bold</b>");
		expect(anthropic(await run([{ content: "<think>kept by thinkTags</think>answer" }]))).toMatchObject({
			types: ["thinking", "text"],
			text: "answer"
		});
	});

	it("a stream that ends while text is held releases it as the answer", async () => {
		for (const held of ["<", "<thi", "  "]) {
			const out = anthropic(await run([{ reasoning_content: "r1" }, { content: held }]));
			expect(out.types).toEqual(["thinking", ...(held.trim() === "" ? [] : ["text"])]);
			expect(out.text).toBe(held.trim() === "" ? "" : held);
		}
		const events = await run([{ reasoning_content: "r1" }, { content: "<" }], "openai");
		expect(events.map((event) => event.data?.choices?.[0]?.delta?.content ?? "").join("")).toBe("<");
		expect(events.at(-1).data).toBe("[DONE]");
		expect(events.findIndex((event) => event.data?.choices?.[0]?.delta?.content === "<")).toBeLessThan(events.length - 1);
	});

	it("the OpenAI front also flushes when the upstream stream ends without [DONE]", async () => {
		const frames = [frame({ reasoning_content: "r1" }), frame({ content: "<thi" }), frame({}, "stop")];
		const transport = server({}, () => new Response(openaiSse(frames), { status: 200, headers: { "content-type": "text/event-stream" } }));
		const api = await make({ front: "openai", upstreams: [{ url: "http://llama.test", backend: "llamacpp" }], transport });
		const reply = await api.send({ model: "qwen", stream: true, messages: [{ role: "user", content: "hi" }] });
		const events = await collect(reply.stream);
		expect(events.map((event) => event.data?.choices?.[0]?.delta?.content ?? "").join("")).toBe("<thi");
	});

	it("flush releases nothing when nothing is held, inside a repeated block, or without state", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		const { flush, chunk } = api.driver.llamacpp;
		expect(flush({})).toEqual([]);
		expect(flush({ state: {} })).toEqual([]);
		const state = {};
		chunk(frame({ reasoning_content: "r" }), { state });
		chunk(frame({ content: "<think>dup</th" }), { state });
		expect(flush({ state })).toEqual([]);
		const plain = {};
		chunk(frame({ reasoning_content: "r" }), { state: plain });
		chunk(frame({ content: "answer" }), { state: plain });
		expect(flush({ state: plain })).toEqual([]);
		const held = {};
		chunk({ ...base, created: 5, choices: [{ index: 0, delta: { reasoning_content: "r" } }] }, { state: held });
		chunk(frame({ content: "<" }), { state: held });
		const [out] = flush({ state: held });
		expect(out).toMatchObject({ id: "c", object: "chat.completion.chunk", model: "qwen", choices: [{ delta: { content: "<" } }] });
		expect(flush({ state: held })).toEqual([]);
	});

	it("the OpenAI front receives the answer without the repeated block", async () => {
		const events = await run([{ reasoning_content: "r1" }, { content: "<think>r1</think>" }, { content: "answer" }], "openai");
		const text = events.map((event) => event.data?.choices?.[0]?.delta?.content ?? "").join("");
		expect(text).toBe("answer");
		expect(events.map((event) => event.data?.choices?.[0]?.delta?.reasoning_content ?? "").join("")).toBe("r1");
	});
});

describe("the --jinja refusal", () => {
	const refusal = { error: { message: "tools param requires --jinja flag", type: "invalid_request_error", code: 400 } };

	it("is recognised and hinted", async () => {
		expect(tools.refused(refusal.error.message)).toBe(true);
		expect(tools.hint(false, refusal.error.message)).toContain("--jinja");
		expect(tools.hint(false, refusal.error.message)).toContain("toolFallback");
		expect(tools.hint(true, refusal.error.message)).not.toContain("toolFallback");
		expect(tools.hint(false, "other")).toContain("--enable-auto-tool-choice");
		const transport = server({}, () => ({ status: 400, body: refusal }));
		const api = await make({ upstreams: [{ url: "http://llama.test", backend: "llamacpp" }], transport });
		const reply = await api.send({
			model: "qwen",
			max_tokens: 8,
			messages: [{ role: "user", content: "hi" }],
			tools: [{ name: "t", description: "d", input_schema: { type: "object" } }]
		});
		expect(reply.status).toBe(400);
		expect(reply.body.error.message).toContain("started without --jinja");
	});
});

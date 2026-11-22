/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/driver/cohere.test.vitest.mjs
 *	@Date: 2026-11-21T10:00:00-08:00 (1795284000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-21T10:00:00-08:00 (1795284000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Cohere driver: host detection, URL layout, the Compatibility API normalizer, the model list, and the native `/v2/chat` protocol (`api: "cohere"`) for both fronts: request bodies, replies, SSE streaming (whole or split), usage, errors and configuration.
 */
import { afterAll, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { readable, slices } from "../helpers/streams.mjs";

afterAll(closeAll);

const url = "https://api.cohere.com";
const user = [{ role: "user", content: "hi" }];
const tool = { name: "Read", description: "read", input_schema: { type: "object", properties: { path: { type: "string" } } } };
const reply = (message, extra = {}) => ({
	id: "r1",
	finish_reason: "COMPLETE",
	message: { role: "assistant", content: [{ type: "text", text: "hi" }], ...message },
	usage: { billed_units: { input_tokens: 5, output_tokens: 3 }, tokens: { input_tokens: 11, output_tokens: 5 } },
	...extra
});
const sse = (events) => events.map(({ type, ...rest }) => `event: ${type}\ndata: ${JSON.stringify({ type, ...rest })}\n\n`).join("");
const raw = (text) => () =>
	new Response(typeof text === "string" ? text : readable(text.map((part) => new TextEncoder().encode(part))), {
		status: 200,
		headers: { "content-type": "text/event-stream" }
	});

const streamEvents = [
	{ type: "message-start", id: "r1", delta: { message: { role: "assistant" } } },
	{ type: "content-start", index: 0, delta: { message: { content: { type: "thinking", thinking: "" } } } },
	{ type: "content-delta", index: 0, delta: { message: { content: { thinking: "Let me " } } } },
	{ type: "content-delta", index: 0, delta: { message: { content: { thinking: "look." } } } },
	{ type: "content-end", index: 0 },
	{ type: "content-start", index: 1, delta: { message: { content: { type: "text", text: "" } } } },
	{ type: "content-delta", index: 1, delta: { message: { content: { text: "Sure, " } } } },
	{ type: "content-delta", index: 1, delta: { message: { content: { text: "reading." } } } },
	{ type: "content-end", index: 1 },
	{ type: "tool-plan-delta", delta: { message: { tool_plan: "I will read." } } },
	{
		type: "tool-call-start",
		index: 0,
		delta: { message: { tool_calls: { id: "Read_1", type: "function", function: { name: "Read", arguments: "" } } } }
	},
	{ type: "tool-call-delta", index: 0, delta: { message: { tool_calls: { function: { arguments: '{"path"' } } } } },
	{ type: "tool-call-delta", index: 0, delta: { message: { tool_calls: { function: { arguments: ':"/a"}' } } } } },
	{ type: "tool-call-end", index: 0 },
	{ type: "citation-start", index: 0, delta: { message: { citations: { start: 0, end: 1, text: "S", sources: [] } } } },
	{ type: "citation-end", index: 0 },
	{
		type: "message-end",
		delta: {
			finish_reason: "TOOL_CALL",
			usage: { billed_units: { input_tokens: 5, output_tokens: 3 }, tokens: { input_tokens: 11, output_tokens: 5 } }
		}
	}
];

// Composing a translator is slow, so each (front, extra) pair is made once and reused with a fresh handler.
const made = new Map();
const apiFor = (front, extra = {}) => {
	const key = `${front}|${JSON.stringify(extra)}`;
	if (!made.has(key)) {
		const handler = { current: () => ({ body: reply({}) }) };
		const transport = fakeTransport((target, init) => handler.current(target, init));
		made.set(
			key,
			make({
				front,
				upstreams: [{ url, backend: "cohere", apiKey: "k", api: "cohere", models: ["command-a"], ...extra }],
				detect: false,
				transport
			}).then((api) => ({
				api,
				transport,
				use(next) {
					handler.current = next;
					transport.calls.length = 0;
				}
			}))
		);
	}
	return made.get(key);
};

describe("detection and layout", () => {
	it("binds api.cohere.com and api.cohere.ai by host with no request, and nothing else", async () => {
		for (const host of ["https://api.cohere.com", "https://api.cohere.ai/compatibility/v1"]) {
			const transport = fakeTransport(() => ({ status: 500 }));
			const api = await make({ upstreams: [host], transport });
			expect(api.status().upstreams[0]).toMatchObject({ driver: "cohere", protocol: "openai.chat" });
			expect(transport.calls).toEqual([]);
		}
		const api = await make({ upstreams: [url], detect: false, transport: fakeTransport(() => ({ body: {} })) });
		expect(api.driver.cohere.detect({ endpoint: { url: "https://example.test" } })).toBeNull();
		expect(api.driver.cohere.detect({ endpoint: { url: "not a url" } })).toBeNull();
		expect(api.driver.cohere.detect({ endpoint: { url } })).toEqual({ host: "api.cohere.com" });
		expect(api.driver.cohere.info()).toMatchObject({
			protocols: ["openai.chat", "cohere.chat"],
			hosts: ["api.cohere.com", "api.cohere.ai"]
		});
		expect(api.driver.cohere.settings()).toMatchObject({ topK: false, maxTokensField: "max_tokens", thinking: "reasoning_effort" });
	});

	it("puts each call at its URL: Compatibility API by default, /v2/chat for cohere.chat, Cohere's own model list", async () => {
		const api = await make({ upstreams: [url], detect: false, transport: fakeTransport(() => ({ body: {} })) });
		const path = api.driver.cohere.path;
		const endpoint = { url };
		const under = { url: "https://api.cohere.com/compatibility" };
		expect(path("chat", { endpoint, protocol: "openai.chat" })).toBe("/compatibility/v1/chat/completions");
		expect(path("chat", { endpoint: under, protocol: "openai.chat" })).toBe("/v1/chat/completions");
		expect(path("chat", { endpoint, protocol: "cohere.chat" })).toBe("/v2/chat");
		expect(path("embeddings", { endpoint, protocol: "cohere.chat" })).toBe("/compatibility/v1/embeddings");
		expect(path("models", { endpoint: under })).toBe("/v1/models");
	});
});

describe("Compatibility API (api: auto)", () => {
	const chatReply = {
		id: "c",
		object: "chat.completion",
		model: "command-a",
		choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
		usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 }
	};
	const compat = (front) => apiFor(front, { api: "auto", url: "https://api.cohere.com/compatibility/v1" });

	it("sends Chat Completions to /compatibility/v1/chat/completions with the key, and drops what the API rejects", async () => {
		const { api, transport, use } = await compat("openai");
		use(() => ({ body: chatReply }));
		const out = await api.send({
			model: "command-a",
			messages: user,
			n: 2,
			logit_bias: { 1: 1 },
			stream_options: { include_usage: true },
			reasoning_effort: "low",
			parallel_tool_calls: true,
			store: true
		});
		expect(out.body.choices[0].message.content).toBe("hi");
		const [call] = transport.calls;
		expect(call.url).toBe("https://api.cohere.com/compatibility/v1/chat/completions");
		expect(call.init.headers.authorization).toBe("Bearer k");
		expect(JSON.parse(call.init.body)).toEqual({ model: "command-a", messages: user, reasoning_effort: "high" });
		const state = { dropped: [] };
		api.driver.cohere.request({ model: "command-a", messages: user, n: 2, logit_bias: {}, store: false, stream_options: {} }, { state });
		api.driver.cohere.request({ model: "command-a", messages: user, n: 2 }, { state });
		expect(state.dropped).toEqual(["store", "logit_bias", "n"]);
		expect(api.driver.cohere.request({ model: "command-a", messages: user, n: 2 })).toEqual({ model: "command-a", messages: user });
		const native = { model: "command-a", messages: user, n: 2 };
		expect(api.driver.cohere.request(native, { protocol: "cohere.chat", state })).toBe(native);
	});

	it("keeps reasoning_effort none, and an Anthropic client's disabled thinking turns into it", async () => {
		const { api, use } = await compat("anthropic");
		use(() => ({ body: chatReply }));
		const off = await api.request({ model: "command-a", max_tokens: 8, messages: user, thinking: { type: "disabled" } });
		expect(off.body.reasoning_effort).toBe("none");
		const on = await api.request({ model: "command-a", max_tokens: 8, messages: user, thinking: { type: "enabled", budget_tokens: 1024 } });
		expect(on.body.reasoning_effort).toBe("high");
		expect(on.url).toBe("https://api.cohere.com/compatibility/v1/chat/completions");
	});
});

describe("model list", () => {
	const page = (models, next) => ({ body: { models, ...(next === undefined ? {} : { next_page_token: next }) } });

	it("reads GET /v1/models?endpoint=chat, follows next_page_token and keeps the context length", async () => {
		const transport = fakeTransport((target) => {
			const query = new URL(target).searchParams;
			expect(query.get("endpoint")).toBe("chat");
			return query.get("page_token") === "p2"
				? page([{ name: "command-r" }, { nope: 1 }])
				: page([{ name: "command-a", context_length: 256000 }, null], "p2");
		});
		const api = await make({
			upstreams: [{ url: "https://api.cohere.com/compatibility", backend: "cohere", apiKey: "k" }],
			detect: false,
			transport
		});
		const out = await api.model.list();
		expect(out.data.map((entry) => entry.id).sort()).toEqual(["command-a", "command-r"]);
		expect(out.data.find((entry) => entry.id === "command-a")).toMatchObject({ max_input_tokens: 256000 });
		expect(transport.calls.map((call) => new URL(call.url).pathname)).toEqual(["/v1/models", "/v1/models"]);
		expect(transport.calls[0].init.headers.authorization).toBe("Bearer k");
	});

	it("keeps what it has when a later page fails, gives nothing when the first does, and stops at a page limit", async () => {
		const later = fakeTransport((target) =>
			new URL(target).searchParams.has("page_token") ? { status: 500, body: {} } : page([{ name: "a" }], "more")
		);
		const api = await make({ upstreams: [{ url, backend: "cohere", apiKey: "k", models: ["x"] }], detect: false, transport: later });
		expect((await api.model.list()).data.map((entry) => entry.id)).toEqual(["a"]);
		const none = await make({
			upstreams: [{ url, backend: "cohere", models: ["fallback"] }],
			detect: false,
			transport: fakeTransport(() => ({ status: 401, body: {} }))
		});
		expect((await none.model.list()).data.map((entry) => entry.id)).toEqual(["fallback"]);
		const looping = fakeTransport(() => page([{ name: "a" }], "again"));
		const endless = await make({ upstreams: [{ url, backend: "cohere" }], detect: false, transport: looping });
		await endless.model.list();
		expect(looping.calls).toHaveLength(20);
	});
});

describe("native protocol selection", () => {
	it("binds the cohere driver to cohere.chat and calls /v2/chat; the default stays on the Compatibility API", async () => {
		const { api, use } = await apiFor("anthropic");
		use(() => ({ body: reply({}) }));
		expect(api.status().upstreams[0]).toMatchObject({ driver: "cohere", protocol: "cohere.chat" });
		const sent = await api.request({ model: "command-a", max_tokens: 8, messages: user });
		expect(sent).toMatchObject({ url: "https://api.cohere.com/v2/chat", path: "/v2/chat" });
		expect(sent.headers.authorization).toBe("Bearer k");
		const plain = await make({ upstreams: [{ url, backend: "cohere" }], detect: false, transport: fakeTransport(() => ({ body: {} })) });
		expect(plain.status().upstreams[0].protocol).toBe("openai.chat");
		expect((await plain.request({ model: "m", max_tokens: 4, messages: user })).url).toBe(
			"https://api.cohere.com/compatibility/v1/chat/completions"
		);
	});
});

describe("Anthropic front: request", () => {
	it("converts messages, tools, sampling, thinking and structured output to Cohere's body", async () => {
		const { api, use } = await apiFor("anthropic");
		use(() => ({ body: reply({}) }));
		const sent = await api.request({
			model: "command-a",
			max_tokens: 256,
			temperature: 0.3,
			top_p: 0.9,
			top_k: 20,
			stop_sequences: ["END"],
			system: "be brief",
			thinking: { type: "enabled", budget_tokens: 1000 },
			tool_choice: { type: "any" },
			tools: [tool],
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "read it" },
						{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }
					]
				},
				{
					role: "assistant",
					content: [
						{ type: "text", text: "ok" },
						{ type: "tool_use", id: "toolu_1", name: "Read", input: { path: "/a" } }
					]
				},
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "body" }] }
			]
		});
		expect(sent.headers.accept).toBe("application/json");
		expect(sent.body).toMatchObject({
			model: "command-a",
			stream: false,
			messages: [
				{ role: "system", content: "be brief" },
				{
					role: "user",
					content: [
						{ type: "text", text: "read it" },
						{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }
					]
				},
				{
					role: "assistant",
					content: "ok",
					tool_calls: [{ id: "toolu_1", type: "function", function: { name: "Read", arguments: '{"path":"/a"}' } }]
				},
				{ role: "tool", tool_call_id: "toolu_1", content: "body" }
			],
			tools: [{ type: "function", function: { name: "Read", description: "read", parameters: tool.input_schema } }],
			tool_choice: "REQUIRED",
			max_tokens: 256,
			temperature: 0.3,
			p: 0.9,
			k: 20,
			stop_sequences: ["END"],
			thinking: { type: "enabled", token_budget: 1000 }
		});
	});

	it("disabled thinking, an effort and no thinking at all; structured output; the sampling setting and metadata.sampling", async () => {
		const { api, use } = await apiFor("anthropic", { settings: { sampling: { safety_mode: "STRICT", seed: 1 } } });
		use(() => ({ body: reply({}) }));
		const ask = async (extra) => (await api.request({ model: "command-a", max_tokens: 8, messages: user, ...extra })).body;
		expect((await ask({ thinking: { type: "disabled" } })).thinking).toEqual({ type: "disabled" });
		expect((await ask({ thinking: { type: "adaptive" }, output_config: { effort: "high" } })).thinking).toEqual({ type: "enabled" });
		expect(await ask({})).not.toHaveProperty("thinking");
		const schema = { type: "object", properties: { a: { type: "string" } } };
		expect((await ask({ output_config: { format: { type: "json_schema", schema } } })).response_format).toEqual({
			type: "json_object",
			json_schema: schema
		});
		const merged = await ask({ metadata: { sampling: { seed: 9, k: 3 } } });
		expect(merged).toMatchObject({ safety_mode: "STRICT", seed: 9, k: 3 });
		expect(await ask({ metadata: { sampling: ["bad"] } })).toMatchObject({ seed: 1 });
		expect(await ask({ metadata: { sampling: null } })).toMatchObject({ seed: 1 });
	});

	it("names a tool choice Cohere cannot take", async () => {
		const { api, use } = await apiFor("anthropic");
		use(() => ({ body: reply({}) }));
		const two = [tool, { ...tool, name: "Write" }];
		const sent = await api.request({
			model: "command-a",
			max_tokens: 8,
			messages: user,
			tools: two,
			tool_choice: { type: "tool", name: "Read" }
		});
		expect(sent.body).not.toHaveProperty("tool_choice");
		expect(sent.state.convert.dropped).toContain("tool_choice");
	});
});

describe("Anthropic front: non-streaming reply", () => {
	it("converts text, thinking, a tool call with Cohere's id and the token counts", async () => {
		const { api, use } = await apiFor("anthropic");
		use(() => ({
			body: reply({
				tool_plan: "I will read the file.",
				content: [
					{ type: "thinking", thinking: "hm" },
					{ type: "text", text: "Sure" }
				],
				tool_calls: [{ id: "Read_1", type: "function", function: { name: "Read", arguments: '{"path":"/a"}' } }]
			}),
			finish_reason: "TOOL_CALL"
		}));
		const out = await api.send({ model: "command-a", max_tokens: 64, tools: [tool], messages: user });
		expect(out.status).toBe(200);
		expect(out.body).toMatchObject({
			type: "message",
			model: "command-a",
			stop_reason: "tool_use",
			usage: { input_tokens: 11, output_tokens: 5 }
		});
		expect(out.body.content.map((block) => block.type)).toEqual(["thinking", "text", "tool_use"]);
		expect(out.body.content[2]).toMatchObject({ id: "Read_1", name: "Read", input: { path: "/a" } });
		expect(await out.usage).toMatchObject({ input_tokens: 11, output_tokens: 5, reason: "done" });
	});

	it("an end_turn, a max_tokens stop, and the failures", async () => {
		const { api, use } = await apiFor("anthropic");
		const ask = async (body) => {
			use(() => ({ body }));
			return api.send({ model: "command-a", max_tokens: 4, messages: user });
		};
		expect((await ask(reply({}))).body.stop_reason).toBe("end_turn");
		expect((await ask(reply({}, { finish_reason: "MAX_TOKENS" }))).body.stop_reason).toBe("max_tokens");
		const failed = await ask(reply({}, { finish_reason: "ERROR" }));
		expect(failed.status).toBe(502);
		expect(failed.body).toMatchObject({ type: "error", error: { message: "Upstream generation failed" } });
		expect((await ask(reply({}, { finish_reason: "TIMEOUT" }))).status).toBe(504);
		expect((await ask({ id: "x" })).status).toBe(502);
	});

	it("a Cohere error body becomes the client's error with the upstream's status", async () => {
		const { api, use } = await apiFor("anthropic");
		use(() => ({ status: 404, body: { message: "model 'command-a' not found, make sure the correct model ID was used" } }));
		const out = await api.send({ model: "command-a", max_tokens: 4, messages: user });
		expect(out.status).toBe(404);
		expect(out.body).toMatchObject({ type: "error", error: { message: expect.stringContaining("not found") } });
		use(() => ({ status: 429, body: { message: "too many requests" } }));
		expect((await api.send({ model: "command-a", max_tokens: 4, messages: user })).status).toBe(429);
	});
});

describe("Anthropic front: streaming", () => {
	const run = async (text) => {
		const { api, use } = await apiFor("anthropic");
		use(raw(text));
		const out = await api.send({ model: "command-a", max_tokens: 64, stream: true, tools: [tool], messages: user });
		return { events: await collect(out.stream), out, api };
	};

	it("converts SSE events, with thinking, text and a streamed tool call, whole or split at any byte", async () => {
		const text = sse(streamEvents);
		const whole = (await run(text)).events;
		for (const size of [1, 9, 64]) {
			const split = (await run(slices(text, size))).events;
			expect(split.map((event) => event.event)).toEqual(whole.map((event) => event.event));
			expect(split.filter((event) => event.event === "content_block_delta").map((event) => event.data.delta)).toEqual(
				whole.filter((event) => event.event === "content_block_delta").map((event) => event.data.delta)
			);
		}
		expect(whole[0].event).toBe("message_start");
		expect(whole.at(-1).event).toBe("message_stop");
		const starts = whole.filter((event) => event.event === "content_block_start").map((event) => event.data.content_block);
		expect(starts.map((block) => block.type)).toEqual(["thinking", "text", "tool_use"]);
		expect(starts[2]).toMatchObject({ id: "Read_1", name: "Read" });
		const deltas = whole.filter((event) => event.event === "content_block_delta").map((event) => event.data.delta);
		expect(
			deltas
				.filter((delta) => delta.type === "thinking_delta")
				.map((delta) => delta.thinking)
				.join("")
		).toBe("Let me look.");
		expect(
			deltas
				.filter((delta) => delta.type === "text_delta")
				.map((delta) => delta.text)
				.join("")
		).toBe("Sure, reading.");
		expect(
			deltas
				.filter((delta) => delta.type === "input_json_delta")
				.map((delta) => delta.partial_json)
				.join("")
		).toBe('{"path":"/a"}');
		expect(whole.find((event) => event.event === "message_delta").data).toMatchObject({
			delta: { stop_reason: "tool_use" },
			usage: { input_tokens: 11, output_tokens: 5 }
		});
	});

	it("a failure ends the stream with an error event, and so does a stream cut before message-end", async () => {
		const failed = (await run(sse([streamEvents[6], { type: "message-end", delta: { finish_reason: "ERROR" } }]))).events;
		expect(failed.at(-1)).toMatchObject({ event: "error", data: { error: { message: "Upstream generation failed" } } });
		const cut = (await run(sse(streamEvents.slice(0, 8)))).events;
		expect(cut.at(-1)).toMatchObject({ event: "error", data: { error: { message: "Upstream stream ended before completion" } } });
	});
});

describe("OpenAI front", () => {
	it("converts a Chat Completions request to Cohere's body", async () => {
		const { api, use } = await apiFor("openai");
		use(() => ({ body: reply({}) }));
		const sent = await api.request({
			model: "command-a",
			max_completion_tokens: 100,
			temperature: 0.4,
			top_p: 0.8,
			seed: 3,
			stop: ["x"],
			frequency_penalty: 0.1,
			presence_penalty: 0.2,
			reasoning_effort: "none",
			response_format: { type: "json_object" },
			n: 2,
			tool_choice: "required",
			tools: [{ type: "function", function: { name: "Read", description: "r", parameters: { type: "object" } } }],
			messages: [
				{ role: "system", content: "s" },
				{ role: "user", content: "see" },
				{
					role: "assistant",
					content: null,
					tool_calls: [{ id: "call_1", type: "function", function: { name: "Read", arguments: '{"p":1}' } }]
				},
				{ role: "tool", tool_call_id: "call_1", content: "r" }
			]
		});
		expect(sent.body).toEqual({
			model: "command-a",
			stream: false,
			messages: [
				{ role: "system", content: "s" },
				{ role: "user", content: [{ type: "text", text: "see" }] },
				{ role: "assistant", tool_calls: [{ id: "call_1", type: "function", function: { name: "Read", arguments: '{"p":1}' } }] },
				{ role: "tool", tool_call_id: "call_1", content: "r" }
			],
			tools: [{ type: "function", function: { name: "Read", description: "r", parameters: { type: "object" } } }],
			tool_choice: "REQUIRED",
			max_tokens: 100,
			temperature: 0.4,
			p: 0.8,
			seed: 3,
			stop_sequences: ["x"],
			frequency_penalty: 0.1,
			presence_penalty: 0.2,
			thinking: { type: "disabled" }
		});
		expect(sent.state.convert.dropped).toEqual(["response_format", "n"]);
	});

	it("a body without messages is an invalid request", async () => {
		const { api } = await apiFor("openai");
		await expect(api.request({ model: "command-a" })).rejects.toMatchObject({ code: "invalid_request", param: "messages" });
		await expect(api.request({ model: "command-a", messages: "x" })).rejects.toMatchObject({ code: "invalid_request" });
	});

	it("returns a chat.completion with the client's model, Cohere's tool-call ids, reasoning and usage", async () => {
		const { api, use } = await apiFor("openai");
		use(() => ({
			body: reply(
				{
					tool_plan: "plan",
					content: [{ type: "thinking", thinking: "hm" }],
					tool_calls: [
						{ id: "Read_1", type: "function", function: { name: "Read", arguments: '{"path":"/a"}' } },
						{ id: "Read_2", type: "function", function: { name: "Read", arguments: '{"path":"/b"}' } }
					]
				},
				{ finish_reason: "TOOL_CALL" }
			)
		}));
		const out = await api.send({ model: "command-a", messages: user });
		expect(out.status).toBe(200);
		expect(out.body).toMatchObject({
			object: "chat.completion",
			model: "command-a",
			usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 }
		});
		expect(out.body.choices[0]).toMatchObject({ finish_reason: "tool_calls", message: { reasoning: "hm" } });
		expect(out.body.choices[0].message.tool_calls.map((call) => call.id)).toEqual(["Read_1", "Read_2"]);
		expect(await out.usage).toMatchObject({ input_tokens: 11, output_tokens: 5 });
	});

	it("a failed generation and an error status are the client's errors", async () => {
		const { api, use } = await apiFor("openai");
		use(() => ({ body: reply({}, { finish_reason: "ERROR" }) }));
		expect((await api.send({ model: "command-a", messages: user })).status).toBe(502);
		use(() => ({ status: 401, body: { message: "invalid api token" } }));
		const out = await api.send({ model: "command-a", messages: user });
		expect(out.status).toBe(401);
		expect(out.body.error.message).toBe("invalid api token");
	});

	it("streams chunks with one id, the tool call's own id and a final usage chunk when asked, whole or split", async () => {
		const { api, use } = await apiFor("openai");
		const text = sse(streamEvents);
		const read = async (chunks, body = {}) => {
			use(raw(chunks));
			const out = await api.send({ model: "command-a", stream: true, stream_options: { include_usage: true }, messages: user, ...body });
			return (await collect(out.stream)).map((event) => event.data);
		};
		const whole = await read(text);
		const shape = (list) => JSON.parse(JSON.stringify(list, (key, value) => (key === "id" ? "id" : key === "created" ? 0 : value)));
		for (const size of [1, 5, 50]) expect(shape(await read(slices(text, size)))).toEqual(shape(whole));
		expect(whole.at(-1)).toBe("[DONE]");
		const chunks = whole.filter((chunk) => chunk !== "[DONE]");
		expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(1);
		expect(chunks.every((chunk) => chunk.model === "command-a")).toBe(true);
		expect(chunks[0].choices[0].delta).toEqual({ role: "assistant", content: "" });
		expect(chunks.map((chunk) => chunk.choices[0]?.delta.reasoning ?? "").join("")).toBe("Let me look.");
		expect(chunks.map((chunk) => chunk.choices[0]?.delta.content ?? "").join("")).toBe("Sure, reading.");
		const calls = chunks.flatMap((chunk) => chunk.choices[0]?.delta.tool_calls ?? []);
		expect(calls).toEqual([
			{ index: 0, id: "Read_1", type: "function", function: { name: "Read", arguments: "" } },
			{ index: 0, function: { arguments: '{"path"' } },
			{ index: 0, function: { arguments: ':"/a"}' } }
		]);
		expect(chunks.find((chunk) => chunk.choices[0]?.finish_reason)?.choices[0].finish_reason).toBe("tool_calls");
		expect(chunks.at(-1)).toMatchObject({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 } });
	});

	it("without stream_options the usage chunk is not shown, and failures end the stream", async () => {
		const { api, use } = await apiFor("openai");
		use(raw(sse(streamEvents)));
		const quiet = await api.send({ model: "command-a", stream: true, messages: user });
		const data = (await collect(quiet.stream)).map((event) => event.data);
		expect(data.some((chunk) => chunk !== "[DONE]" && chunk.choices.length === 0)).toBe(false);

		const failures = [
			[sse([streamEvents[6], { type: "message-end", delta: { finish_reason: "TIMEOUT" } }]), "Upstream generation timed out"],
			[sse(streamEvents.slice(0, 3)), "Upstream stream ended before completion"],
			["event: content-delta\ndata: {broken\n\n", expect.any(String)]
		];
		for (const [body, message] of failures) {
			use(raw(body));
			const out = await api.send({ model: "command-a", stream: true, messages: user });
			const events = (await collect(out.stream)).map((event) => event.data);
			expect(events.at(-1)).toBe("[DONE]");
			expect(events.at(-2)).toMatchObject({ error: { message } });
		}
	});
});

describe("token counting", () => {
	it("estimates the prompt, since /v1/tokenize takes raw text only", async () => {
		const { api, use, transport } = await apiFor("anthropic");
		use(() => ({ body: reply({}) }));
		const out = await api.token.count({ model: "command-a", max_tokens: 8, messages: user });
		expect(out.input_tokens).toBeGreaterThan(0);
		expect(transport.calls).toEqual([]);
	});
});

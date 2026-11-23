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
import { response as toResponses } from "../../src/api/convert/openai/chat/to/openai/responses/response.mjs";
import { stream as toResponsesStream } from "../../src/api/convert/openai/chat/to/openai/responses/stream.mjs";
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
	{ type: "tool-plan-delta", delta: { message: { tool_plan: "I will read." } } },
	{ type: "content-start", index: 1, delta: { message: { content: { type: "text", text: "" } } } },
	{ type: "content-delta", index: 1, delta: { message: { content: { text: "Sure, " } } } },
	{ type: "content-delta", index: 1, delta: { message: { content: { text: "reading." } } } },
	{ type: "content-end", index: 1 },
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

describe("Compatibility API (api: openai)", () => {
	const chatReply = {
		id: "c",
		object: "chat.completion",
		model: "command-a",
		choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
		usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 }
	};
	const compat = (front) => apiFor(front, { api: "openai", url: "https://api.cohere.com/compatibility/v1" });

	it("sends Chat Completions to /compatibility/v1/chat/completions with the key, and drops what the API rejects", async () => {
		const { api, transport, use } = await compat("openai");
		use(() => ({ body: chatReply }));
		const out = await api.send({
			model: "command-a",
			messages: user,
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
					tool_plan: "ok",
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
		expect((await ask({ thinking: { type: "adaptive" }, output_config: { effort: "high" } })).thinking).toEqual({
			type: "enabled",
			token_budget: 16384
		});
		expect((await ask({ thinking: { type: "enabled", budget_tokens: 3000 } })).thinking).toEqual({ type: "enabled", token_budget: 3000 });
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

	it("forces a named tool by offering only that tool", async () => {
		const { api, use } = await apiFor("anthropic");
		use(() => ({ body: reply({}) }));
		const two = [tool, { ...tool, name: "Write" }];
		const sent = await api.request({
			model: "command-a",
			max_tokens: 8,
			messages: user,
			tools: two,
			tool_choice: { type: "tool", name: "Write" }
		});
		expect(sent.body.tool_choice).toBe("REQUIRED");
		expect(sent.body.tools.map((entry) => entry.function.name)).toEqual(["Write"]);
		const none = await api.request({
			model: "command-a",
			max_tokens: 8,
			messages: user,
			tools: two,
			tool_choice: { type: "tool", name: "Nope" }
		});
		expect(none.body).not.toHaveProperty("tool_choice");
		expect(none.state.convert.dropped).toContain("tool_choice");
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
		).toBe("I will read.\n\nSure, reading.");
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
				{ role: "system", content: expect.any(String) },
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
		expect(sent.state.convert.dropped).toEqual(["n"]);
		expect(sent.body.messages.map((message) => message.role)).toEqual(["system", "system", "user", "assistant", "tool"]);
		expect(sent.body.messages[1].content).toMatch(/only a valid JSON object/);
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
		expect(chunks.map((chunk) => chunk.choices[0]?.delta.content ?? "").join("")).toBe("I will read.\n\nSure, reading.");
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
	const tokenize = (handler) => (target, init) =>
		new URL(target).pathname === "/v1/tokenize" ? handler(JSON.parse(init.body)) : { body: reply({}) };

	it("counts the prompt text with Cohere's tokenizer, in pieces of at most 65,536 characters", async () => {
		const { api, use, transport } = await apiFor("anthropic");
		use(tokenize((body) => ({ body: { tokens: Array.from({ length: Math.ceil(body.text.length / 10) }), token_strings: [] } })));
		const small = await api.token.count({ model: "command-a", max_tokens: 8, messages: user });
		expect(small.input_tokens).toBe(1);
		const call = transport.calls[0];
		expect(call.url).toBe("https://api.cohere.com/v1/tokenize");
		expect(call.init.headers.authorization).toBe("Bearer k");
		expect(JSON.parse(call.init.body)).toEqual({ text: "hi", model: "command-a" });
		transport.calls.length = 0;
		const big = await api.token.count({ model: "command-a", max_tokens: 8, messages: [{ role: "user", content: "x".repeat(70000) }] });
		expect(transport.calls).toHaveLength(2);
		expect(big.input_tokens).toBe(Math.ceil(65536 / 10) + Math.ceil(4464 / 10));
	});

	it("estimates when Cohere does not answer or the prompt is too long for 16 calls", async () => {
		const { api, use, transport } = await apiFor("anthropic");
		use(tokenize(() => ({ status: 500, body: {} })));
		expect((await api.token.count({ model: "command-a", max_tokens: 8, messages: user })).input_tokens).toBeGreaterThan(0);
		use(tokenize(() => ({ body: { nope: 1 } })));
		expect((await api.token.count({ model: "command-a", max_tokens: 8, messages: user })).input_tokens).toBeGreaterThan(0);
		use(tokenize(() => ({ body: { tokens: [] } })));
		await api.token.count({ model: "command-a", max_tokens: 8, messages: [{ role: "user", content: "x".repeat(65536 * 16 + 1) }] });
		expect(transport.calls).toEqual([]);
	});
});

describe("documents and citations", () => {
	const document = {
		type: "document",
		title: "Notes",
		source: { type: "text", media_type: "text/plain", data: "alpha beta gamma" },
		citations: { enabled: true }
	};
	const found = {
		type: "search_result",
		source: "https://s.test/a",
		title: "Page",
		content: [{ type: "text", text: "delta" }],
		citations: { enabled: true }
	};
	const cited = (sources, extra = {}) => ({
		start: 6,
		end: 9,
		text: "big",
		type: "TEXT_CONTENT",
		content_index: 0,
		sources,
		...extra
	});
	const hello = (citations, extra = {}) =>
		reply({ content: [{ type: "text", text: "Hello big world" }], citations }, { finish_reason: "COMPLETE", ...extra });

	it("sends a document that asks for citations as a Cohere document, and cites it as a char_location of the document", async () => {
		const { api, use } = await apiFor("anthropic");
		use(() => ({ body: hello([cited([{ type: "document", id: "doc_0", document: { id: "doc_0", text: "alpha beta" } }])]) }));
		const body = {
			model: "command-a",
			max_tokens: 64,
			messages: [{ role: "user", content: [document, { type: "text", text: "What is beta?" }] }]
		};
		const sent = await api.request(body);
		expect(sent.body.documents).toEqual([{ id: "doc_0", data: { title: "Notes", text: expect.stringContaining("alpha beta gamma") } }]);
		expect(sent.body.messages).toEqual([{ role: "user", content: [{ type: "text", text: "What is beta?" }] }]);
		const out = await api.send(body);
		expect(out.body.content.map((block) => block.text)).toEqual(["Hello ", "big", " world"]);
		const citation = out.body.content[1].citations[0];
		expect(citation).toMatchObject({
			type: "char_location",
			cited_text: "alpha beta",
			document_index: 0,
			document_title: "Notes",
			start_char_index: 0,
			end_char_index: sent.state.convert.documents.doc_0.length
		});
	});

	it("cites a search result in a tool result as a search_result_location, and a tool output as the tool call's result", async () => {
		const { api, use } = await apiFor("anthropic");
		use(() => ({
			body: hello([
				cited([{ type: "document", id: "result_0", document: { text: "delta" } }]),
				cited([{ type: "tool", id: "toolu_1:0", tool_output: { a: 1 } }], { start: 0, end: 5 })
			])
		}));
		const body = {
			model: "command-a",
			max_tokens: 64,
			tools: [tool],
			messages: [
				{ role: "user", content: "find" },
				{ role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: {} }] },
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: [found] }] }
			]
		};
		const sent = await api.request(body);
		const result = sent.body.messages.at(-1);
		expect(result).toEqual({
			role: "tool",
			tool_call_id: "toolu_1",
			content: [{ type: "document", document: { id: "result_0", data: { title: "Page", source: "https://s.test/a", text: "delta" } } }]
		});
		const out = await api.send(body);
		const citations = out.body.content.flatMap((block) => block.citations ?? []);
		// The citation of "Hello" (the tool output) comes before the one of "big" in the text.
		expect(citations).toEqual([
			{
				type: "search_result_location",
				cited_text: '{"a":1}',
				source: "toolu_1",
				title: null,
				search_result_index: 0,
				start_block_index: 0,
				end_block_index: 1
			},
			{
				type: "search_result_location",
				cited_text: "delta",
				source: "https://s.test/a",
				title: "Page",
				search_result_index: 0,
				start_block_index: 0,
				end_block_index: 1
			}
		]);
	});

	it("sends an OpenAI client's documents and citation options as they are, and gives the citations back as annotations", async () => {
		const { api, use } = await apiFor("openai");
		use(() => ({ body: hello([cited([{ type: "document", id: "mine", document: { title: "Mine", text: "snippet" } }])]) }));
		const body = {
			model: "command-a",
			messages: user,
			documents: [{ id: "mine", data: { title: "Mine", text: "snippet" } }],
			citation_options: { mode: "ACCURATE" }
		};
		const sent = await api.request(body);
		expect(sent.body).toMatchObject({ documents: body.documents, citation_options: { mode: "ACCURATE" } });
		const out = await api.send(body);
		const [annotation] = out.body.choices[0].message.annotations;
		expect(annotation).toMatchObject({
			type: "citation",
			citation: { kind: "document", id: "mine", title: "Mine", text: "snippet", span: { start: 6, end: 9 } }
		});
	});

	it("streams citations as citations_delta events on the open text block, and as annotation chunks", async () => {
		const events = [
			{ type: "message-start", id: "r1", delta: { message: { role: "assistant" } } },
			{ type: "content-start", index: 0, delta: { message: { content: { type: "text", text: "" } } } },
			{ type: "content-delta", index: 0, delta: { message: { content: { text: "Hello big world" } } } },
			{
				type: "citation-start",
				index: 0,
				delta: { message: { citations: cited([{ type: "document", id: "doc_0", document: { text: "alpha" } }]) } }
			},
			{ type: "citation-end", index: 0 },
			{ type: "content-end", index: 0 },
			{ type: "message-end", delta: { finish_reason: "COMPLETE", usage: { tokens: { input_tokens: 1, output_tokens: 1 } } } }
		];
		const body = {
			model: "command-a",
			max_tokens: 64,
			stream: true,
			messages: [{ role: "user", content: [document, { type: "text", text: "q" }] }]
		};
		const anthropic = await apiFor("anthropic");
		anthropic.use(raw(sse(events)));
		const out = await anthropic.api.send(body);
		const list = await collect(out.stream);
		const citation = list.find((event) => event.data?.delta?.type === "citations_delta");
		expect(citation.data.delta.citation).toMatchObject({ type: "char_location", cited_text: "alpha", document_index: 0 });
		expect(list.findIndex((event) => event === citation)).toBeLessThan(list.findIndex((event) => event.event === "content_block_stop"));
		const chat = await apiFor("openai");
		chat.use(raw(sse(events)));
		const chunks = (
			await collect(
				(await chat.api.send({ model: "command-a", stream: true, documents: [{ id: "doc_0", data: { text: "alpha" } }], messages: user }))
					.stream
			)
		).map((event) => event.data);
		const annotated = chunks.find((chunk) => chunk !== "[DONE]" && chunk.choices[0]?.delta.annotations);
		expect(annotated.choices[0].delta.annotations[0].citation).toMatchObject({ kind: "document", id: "doc_0", span: { start: 6, end: 9 } });
	});
});

describe("tool plans, parallel calls, logprobs, cached tokens and failed tool results", () => {
	const calls = [
		{ id: "Read_1", type: "function", function: { name: "Read", arguments: '{"path":"/a"}' } },
		{ id: "Read_2", type: "function", function: { name: "Read", arguments: '{"path":"/b"}' } }
	];

	it("returns the tool plan as the text before the tool calls, and sends it back as the plan of the turn", async () => {
		const { api, use } = await apiFor("anthropic");
		use(() => ({ body: reply({ tool_plan: "I will read it.", content: [], tool_calls: [calls[0]] }, { finish_reason: "TOOL_CALL" }) }));
		const body = { model: "command-a", max_tokens: 64, tools: [tool], messages: user };
		const out = await api.send(body);
		expect(out.body.content.map((block) => [block.type, block.text])).toEqual([
			["text", "I will read it."],
			["tool_use", undefined]
		]);
		const next = await api.request({
			...body,
			messages: [
				...user,
				{ role: "assistant", content: out.body.content },
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "Read_1", content: "file body" }] }
			]
		});
		expect(next.body.messages[1]).toEqual({ role: "assistant", tool_plan: "I will read it.", tool_calls: [calls[0]] });
	});

	it("keeps the first tool call only when the client switched parallel calls off", async () => {
		const reply2 = { body: reply({ content: [], tool_calls: calls }, { finish_reason: "TOOL_CALL" }) };
		const anthropic = await apiFor("anthropic");
		anthropic.use(() => reply2);
		const one = await anthropic.api.send({
			model: "command-a",
			max_tokens: 64,
			tools: [tool],
			tool_choice: { type: "auto", disable_parallel_tool_use: true },
			messages: user
		});
		expect(one.body.content.filter((block) => block.type === "tool_use")).toHaveLength(1);
		const many = await anthropic.api.send({ model: "command-a", max_tokens: 64, tools: [tool], messages: user });
		expect(many.body.content.filter((block) => block.type === "tool_use")).toHaveLength(2);
	});

	it("sends logprobs and returns the log probabilities", async () => {
		const { api, use } = await apiFor("openai");
		use(() => ({ body: reply({}, { logprobs: [{ token_ids: [5], text: "hi", logprobs: [-0.25] }] }) }));
		const body = { model: "command-a", messages: user, logprobs: true, top_logprobs: 2 };
		const sent = await api.request(body);
		expect(sent.body.logprobs).toBe(true);
		expect(sent.state.convert.dropped).toEqual(["top_logprobs"]);
		const out = await api.send(body);
		expect(out.body.choices[0].logprobs.content[0]).toMatchObject({ token: "hi", logprob: -0.25 });
	});

	it("reports the cached tokens in the OpenAI usage and as cache reads for the Anthropic client", async () => {
		const usage = { tokens: { input_tokens: 100, output_tokens: 5 }, cached_tokens: 30 };
		const chat = await apiFor("openai");
		chat.use(() => ({ body: reply({}, { usage }) }));
		expect((await chat.api.send({ model: "command-a", messages: user })).body.usage.prompt_tokens_details).toEqual({ cached_tokens: 30 });
		const anthropic = await apiFor("anthropic");
		anthropic.use(() => ({ body: reply({}, { usage }) }));
		expect((await anthropic.api.send({ model: "command-a", max_tokens: 8, messages: user })).body.usage).toMatchObject({
			input_tokens: 70,
			cache_read_input_tokens: 30,
			output_tokens: 5
		});
	});

	it("sends a failed tool result as an error object", async () => {
		const { api, use } = await apiFor("anthropic");
		use(() => ({ body: reply({}) }));
		const sent = await api.request({
			model: "command-a",
			max_tokens: 8,
			tools: [tool],
			messages: [
				...user,
				{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] },
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "no such file" }] }
			]
		});
		expect(sent.body.messages.at(-1)).toEqual({ role: "tool", tool_call_id: "t1", content: '{"error":"no such file"}' });
	});

	it("moves values into Cohere's ranges, and the state says which", async () => {
		const { api, use } = await apiFor("openai");
		use(() => ({ body: reply({}) }));
		const sent = await api.request({ model: "command-a", messages: user, frequency_penalty: 2, top_p: 1 });
		expect(sent.body).toMatchObject({ frequency_penalty: 1, p: 0.99 });
		expect(sent.state.convert.clamped).toEqual(["p", "frequency_penalty"]);
		expect((await api.request({ model: "command-a", messages: user })).state.convert).not.toHaveProperty("clamped");
	});
});

describe("auto routing and several choices", () => {
	it("sends a request over cohere.chat when it needs something only that protocol has, and over the Compatibility API otherwise", async () => {
		const { api, use } = await apiFor("anthropic", { api: "auto" });
		use(() => ({ body: reply({}) }));
		const plain = await api.request({ model: "command-a", max_tokens: 8, messages: user });
		expect(plain.url).toBe("https://api.cohere.com/compatibility/v1/chat/completions");
		const budget = await api.request({
			model: "command-a",
			max_tokens: 8,
			messages: user,
			thinking: { type: "enabled", budget_tokens: 2048 }
		});
		expect(budget.url).toBe("https://api.cohere.com/v2/chat");
		expect(budget.body.thinking).toEqual({ type: "enabled", token_budget: 2048 });
		const doc = await api.request({
			model: "command-a",
			max_tokens: 8,
			messages: [
				{
					role: "user",
					content: [{ type: "document", source: { type: "text", media_type: "text/plain", data: "x" }, citations: { enabled: true } }]
				}
			]
		});
		expect(doc.url).toBe("https://api.cohere.com/v2/chat");
		const chat = await apiFor("openai", { api: "auto" });
		chat.use(() => ({ body: reply({}) }));
		expect((await chat.api.request({ model: "command-a", messages: user, logprobs: true })).url).toBe("https://api.cohere.com/v2/chat");
		expect((await chat.api.request({ model: "command-a", messages: user })).url).toBe(
			"https://api.cohere.com/compatibility/v1/chat/completions"
		);
	});

	it("answers n above 1 with parallel requests over the Compatibility API, which has no n", async () => {
		const { api, transport, use } = await apiFor("openai", { api: "openai" });
		use(() => ({
			body: {
				id: "c",
				object: "chat.completion",
				model: "command-a",
				choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
			}
		}));
		const out = await api.send({ model: "command-a", messages: user, n: 2 });
		expect(out.body.choices.map((choice) => choice.index)).toEqual([0, 1]);
		expect(transport.calls).toHaveLength(2);
		expect(transport.calls.every((call) => JSON.parse(call.init.body).n === undefined)).toBe(true);
	});
});

describe("citations of the model's thinking, on each front", () => {
	const thinking = "Let me check the notes";
	const citations = [
		{
			type: "THINKING_CONTENT",
			start: 0,
			end: 6,
			content_index: 0,
			sources: [{ type: "document", id: "mine", document: { title: "Mine", url: "https://mine.test" } }]
		}
	];
	const answer = reply(
		{
			content: [
				{ type: "thinking", thinking },
				{ type: "text", text: "ok" }
			],
			citations
		},
		{ finish_reason: "COMPLETE" }
	);
	const marked = "Let me[1] check the notes\n\nSources:\n[1] Mine (https://mine.test)";
	const documents = [{ id: "mine", data: { title: "Mine", text: "t" } }];
	const events = [
		{ type: "message-start", id: "r1", delta: { message: { role: "assistant" } } },
		{ type: "content-start", index: 0, delta: { message: { content: { type: "thinking", thinking: "" } } } },
		{ type: "content-delta", index: 0, delta: { message: { content: { thinking: "Let me check " } } } },
		{ type: "content-delta", index: 0, delta: { message: { content: { thinking: "the notes" } } } },
		{ type: "citation-start", index: 0, delta: { message: { citations: citations[0] } } },
		{ type: "content-end", index: 0 },
		{ type: "content-start", index: 1, delta: { message: { content: { type: "text", text: "" } } } },
		{ type: "content-delta", index: 1, delta: { message: { content: { text: "ok" } } } },
		{ type: "content-end", index: 1 },
		{ type: "message-end", delta: { finish_reason: "COMPLETE" } }
	];

	it("is a marked thinking block for an Anthropic client, whole and streamed", async () => {
		const { api, use } = await apiFor("anthropic");
		use(() => ({ body: answer }));
		const out = await api.send({ model: "command-a", max_tokens: 8, messages: user });
		expect(out.body.content[0]).toMatchObject({ type: "thinking", thinking: marked });
		use(raw(sse(events)));
		const asks = {
			type: "document",
			title: "T",
			source: { type: "text", media_type: "text/plain", data: "t" },
			citations: { enabled: true }
		};
		const body = {
			model: "command-a",
			max_tokens: 8,
			stream: true,
			messages: [{ role: "user", content: [asks, { type: "text", text: "q" }] }]
		};
		const list = await collect((await api.send(body)).stream);
		const text = list.filter((event) => event.data?.delta?.type === "thinking_delta").map((event) => event.data.delta.thinking);
		expect(text.join("")).toBe(marked);
	});

	it("is marked reasoning for a Chat Completions client, whole and streamed", async () => {
		const { api, use } = await apiFor("openai");
		use(() => ({ body: answer }));
		expect((await api.send({ model: "command-a", messages: user })).body.choices[0].message.reasoning).toBe(marked);
		use(raw(sse(events)));
		const chunks = await collect((await api.send({ model: "command-a", stream: true, documents, messages: user })).stream);
		const text = chunks.map((event) => event.data).filter((chunk) => chunk !== "[DONE]");
		expect(text.map((chunk) => chunk.choices[0]?.delta.reasoning ?? "").join("")).toBe(marked);
	});

	it("is marked reasoning summary text for a Responses client", async () => {
		const { api, use } = await apiFor("openai");
		use(() => ({ body: answer }));
		// The Responses front sits on the Chat Completions reply (`wire: "responses"`), which its converter turns into output items.
		const out = await api.send({ model: "command-a", messages: user }, { front: "openai", wire: "responses" });
		const item = toResponses(out.body, { model: "command-a" }).output.find((entry) => entry.type === "reasoning");
		expect(item.summary[0].text).toBe(marked);
		use(raw(sse(events)));
		const chat = await api.send({ model: "command-a", stream: true, documents, messages: user }, { front: "openai", wire: "responses" });
		const streamed = await collect(toResponsesStream(chat.stream, { model: "command-a" }));
		const parts = streamed.filter((event) => event.event === "response.reasoning_summary_text.delta").map((event) => event.data.delta);
		expect(parts.join("")).toBe(marked);
	});

	it("sends the thinking back without the markers and the list", async () => {
		const { api, use } = await apiFor("openai");
		use(() => ({ body: answer }));
		const sent = await api.request({
			model: "command-a",
			messages: [...user, { role: "assistant", content: "ok", reasoning: marked }, { role: "user", content: "more" }]
		});
		expect(sent.body.messages[1].content[0]).toEqual({ type: "thinking", thinking });
	});
});

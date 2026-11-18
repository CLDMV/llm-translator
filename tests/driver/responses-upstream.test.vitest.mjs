/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/driver/responses-upstream.test.vitest.mjs
 *	@Date: 2026-11-17T12:00:00-08:00 (1794945600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-17T12:00:00-08:00 (1794945600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The Responses API as an upstream protocol (`api: "responses"`): selection and defaults, both fronts, tools, reasoning round trips,
 * usage, streaming with split lines, and errors. Every upstream is a mocked transport.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { readable, slices } from "../helpers/streams.mjs";

afterAll(closeAll);

const url = "http://responses.test";
const user = [{ role: "user", content: "hi" }];
const tool = { name: "Read", description: "read", input_schema: { type: "object", properties: { path: { type: "string" } } } };
const usage = {
	input_tokens: 20,
	input_tokens_details: { cached_tokens: 5 },
	output_tokens: 7,
	output_tokens_details: { reasoning_tokens: 3 },
	total_tokens: 27
};
const reasoning = {
	type: "reasoning",
	id: "rs_1",
	summary: [
		{ type: "summary_text", text: "Plan A" },
		{ type: "summary_text", text: "Plan B" }
	],
	encrypted_content: "ENC-1"
};
const message = (text) => ({
	type: "message",
	id: "msg_1",
	role: "assistant",
	status: "completed",
	content: [{ type: "output_text", text, annotations: [] }]
});
const call = { type: "function_call", id: "fc_1", call_id: "call_1", name: "Read", arguments: '{"path":"/a"}', status: "completed" };
const reply = (output, extra = {}) => ({
	id: "resp_abc",
	object: "response",
	created_at: 1700000000,
	status: "completed",
	model: "gpt-x",
	output,
	usage,
	...extra
});
const frames = (events) => events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
const raw =
	(text, size = 17) =>
	() =>
		new Response(readable(slices(text, size).map((part) => new TextEncoder().encode(part))), {
			status: 200,
			headers: { "content-type": "text/event-stream" }
		});

// Composing a translator is slow, so each (front, extra) pair is made once and reused with a fresh handler.
const made = new Map();
const apiFor = (front, extra = {}, settings = {}) => {
	const key = `${front}|${JSON.stringify(extra)}|${JSON.stringify(settings)}`;
	if (!made.has(key)) {
		const handler = { current: () => ({ body: reply([message("hi")]) }) };
		const transport = fakeTransport((target, init) => handler.current(target, init));
		made.set(
			key,
			make({
				front,
				upstreams: [{ url, backend: "compatible", api: "responses", models: ["gpt-x"], ...extra }],
				settings,
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
const sentBody = (transport) => JSON.parse(transport.calls.at(-1).init.body);

describe("selecting the protocol", () => {
	it("opts in with api: responses, calls /v1/responses and reports the protocol", async () => {
		const { api, use, transport } = await apiFor("anthropic");
		use(() => ({ body: reply([message("hi")]) }));
		expect(api.status().upstreams[0]).toMatchObject({ driver: "compatible", protocol: "openai.responses" });
		expect(api.route({ model: "gpt-x", max_tokens: 8, messages: user })).toMatchObject({ protocol: "openai.responses", native: false });
		const sent = await api.request({ model: "gpt-x", max_tokens: 8, messages: user });
		expect(sent.url).toBe("http://responses.test/v1/responses");
		expect(sent.headers.accept).toBe("application/json");
		expect(sent.state.responses).toBe(true);
		const result = await api.send({ model: "gpt-x", max_tokens: 8, messages: user });
		expect(new URL(transport.calls[0].url).pathname).toBe("/v1/responses");
		expect(result.body).toMatchObject({ type: "message", content: [{ type: "text", text: "hi" }] });
	});

	const backends = ["openai", "compatible", "vllm", "ollama", "lmstudio", "llamacpp", "sglang", "localai"];
	const protocols = async (extra) => {
		const api = await make({
			upstreams: backends.map((backend) => ({ url, name: backend, backend, models: [backend], ...extra })),
			detect: false,
			transport: fakeTransport(() => ({ body: {} }))
		});
		return api.status().upstreams.map((entry) => entry.protocol);
	};

	it("keeps Chat Completions as the default for every driver, and for api: openai", async () => {
		for (const extra of [{}, { api: "openai" }]) {
			expect(await protocols(extra)).toEqual(backends.map(() => "openai.chat"));
		}
		const named = await make({ upstreams: [{ url, backend: "openai", api: "openai" }], detect: false });
		expect((await named.request({ model: "m", max_tokens: 4, messages: user })).url).toBe("http://responses.test/v1/chat/completions");
	});

	it("opts in for each driver that declares it, and api: auto starts on the Responses API for them", async () => {
		expect(await protocols({ api: "responses" })).toEqual(backends.map(() => "openai.responses"));
		expect(await protocols({ api: "auto" })).toEqual(backends.map(() => "openai.responses"));
	});

	it("rejects an api value it does not know, and a driver without the Responses API", async () => {
		await expect(make({ upstreams: [{ url, api: "grpc" }], detect: false })).rejects.toMatchObject({
			code: "INVALID_CONFIG",
			message: expect.stringContaining('"openai", "responses", "auto" or "native"')
		});
		await expect(make({ upstreams: [{ url, backend: "deepseek", api: "responses" }], detect: false })).rejects.toMatchObject({
			code: "unsupported_api",
			message: expect.stringMatching(/Responses API \(.*\bopenai\b.*\bcompatible\b.*\)/)
		});
	});

	it("a driver can declare the protocol itself, with its own path, and api: auto keeps a Responses-only driver as it is", async () => {
		const api = await make({
			upstreams: [
				{ url: "http://declares.test", name: "own", models: ["m"] },
				{ url: "http://declares.test", name: "explicit", api: "responses", models: ["e"] },
				{ url: "http://declares.test", name: "auto", api: "auto", models: ["a"] }
			],
			detect: false,
			transport: fakeTransport(() => ({ status: 404, body: {} }))
		});
		for (const name of ["declares-responses"]) {
			await api.slothlet.api.add(["driver", name], new URL(`../fixtures/driver/${name}`, import.meta.url).pathname);
		}
		await api.detect();
		const byName = Object.fromEntries(api.status().upstreams.map((entry) => [entry.name, [entry.driver, entry.protocol]]));
		expect(byName).toEqual({
			own: ["declares-responses", "openai.responses"],
			explicit: ["declares-responses", "openai.responses"],
			auto: ["declares-responses", "openai.responses"]
		});
		const ask = async (model) => (await api.request({ model, max_tokens: 4, messages: user })).url;
		expect(await ask("m")).toBe("http://declares.test/api/responses");
		expect(await ask("e")).toBe("http://declares.test/api/responses");
		expect(await ask("a")).toBe("http://declares.test/api/responses");
	});

	it("turns reasoningRoundTrip on for the endpoint unless the settings say otherwise", async () => {
		const { api } = await apiFor("anthropic");
		const sent = await api.request({
			model: "gpt-x",
			max_tokens: 8,
			messages: [
				{ role: "user", content: "go" },
				{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] },
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "x" }] }
			],
			tools: [tool]
		});
		expect(sent.body.include).toEqual(["reasoning.encrypted_content"]);
		const off = await apiFor("anthropic", {}, { reasoningRoundTrip: false });
		expect((await off.api.request({ model: "gpt-x", max_tokens: 8, messages: user })).body.include).toBeUndefined();
	});
});

describe("reasoning warning", () => {
	it("does not warn about a tool turn without reasoning: a Responses upstream does not need it sent back", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const transport = fakeTransport(() => ({ body: reply([message("ok")]) }));
			const api = await make({
				upstreams: [{ url, backend: "compatible", api: "responses", models: ["gpt-x"] }],
				detect: false,
				logs: true,
				transport
			});
			const result = await api.send({
				model: "gpt-x",
				max_tokens: 8,
				tools: [tool],
				messages: [
					{ role: "user", content: "go" },
					{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] },
					{ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "x" }] }
				]
			});
			expect(result.status).toBe(200);
			expect(warn.mock.calls.filter((call) => /no reasoning to send back/.test(call[0]))).toHaveLength(0);
		} finally {
			warn.mockRestore();
		}
	});
});

describe("Anthropic front: request", () => {
	it("converts system, messages, tools, thinking and structured output to a Responses body", async () => {
		const { api, use } = await apiFor("anthropic", {}, { thinking: "reasoning_effort", effort: true });
		use(() => ({ body: reply([message("ok")]) }));
		const sent = await api.request({
			model: "gpt-x",
			max_tokens: 256,
			temperature: 0.3,
			top_p: 0.9,
			top_k: 20,
			stop_sequences: ["END"],
			system: "be brief",
			thinking: { type: "enabled", budget_tokens: 1000 },
			output_config: { effort: "high", format: { type: "json_schema", schema: { type: "object", properties: {} } } },
			tools: [tool],
			tool_choice: { type: "tool", name: "Read" },
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "read it" },
						{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }
					]
				},
				{ role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: { path: "/a" } }] },
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "body" }] }
			]
		});
		expect(sent.body).toEqual({
			model: "gpt-x",
			instructions: "be brief",
			input: [
				{
					role: "user",
					content: [
						{ type: "input_text", text: "read it" },
						{ type: "input_image", image_url: "data:image/png;base64,AAAA" }
					]
				},
				{ type: "function_call", call_id: "toolu_1", name: "Read", arguments: '{"path":"/a"}' },
				{ type: "function_call_output", call_id: "toolu_1", output: "body" }
			],
			store: false,
			include: ["reasoning.encrypted_content"],
			max_output_tokens: 256,
			temperature: 0.3,
			top_p: 0.9,
			tools: [
				{
					type: "function",
					name: "Read",
					description: "read",
					parameters: { type: "object", properties: { path: { type: "string" } } },
					strict: false
				}
			],
			tool_choice: { type: "function", name: "Read" },
			reasoning: { effort: "high", summary: "auto" },
			text: { format: { type: "json_schema", name: "output", schema: { type: "object", properties: {} } } }
		});
		// What the Responses API has no field for is recorded, like any other dropped field.
		expect(sent.state.convert.dropped).toEqual(expect.arrayContaining(["top_k", "stop"]));
	});

	it("sends no tools, tool_choice or parallel_tool_calls without tools, and honours reasoningSummary", async () => {
		const { api } = await apiFor("anthropic", {}, { thinking: "reasoning_effort", reasoningSummary: "detailed" });
		const sent = await api.request({
			model: "gpt-x",
			max_tokens: 8,
			messages: user,
			tool_choice: { type: "auto", disable_parallel_tool_use: true },
			thinking: { type: "enabled", budget_tokens: 100 }
		});
		expect(sent.body.tools).toBeUndefined();
		expect(sent.body.tool_choice).toBeUndefined();
		expect(sent.body.parallel_tool_calls).toBeUndefined();
		expect(sent.body.reasoning).toEqual({ effort: "medium", summary: "detailed" });
		const none = await apiFor("anthropic", {}, { thinking: "reasoning_effort", reasoningSummary: "none" });
		const off = await none.api.request({
			model: "gpt-x",
			max_tokens: 8,
			messages: user,
			thinking: { type: "enabled", budget_tokens: 100 }
		});
		expect(off.body.reasoning).toEqual({ effort: "medium" });
		const disabled = await apiFor("anthropic", {}, { thinking: "reasoning_effort" });
		const noThinking = await disabled.api.request({ model: "gpt-x", max_tokens: 8, messages: user, thinking: { type: "disabled" } });
		expect(noThinking.body.reasoning).toEqual({ effort: "none" });
	});

	it("does not run the driver's Chat Completions request leaf, the sampling extensions or the Chat-only retries", async () => {
		const { api } = await apiFor("anthropic", { backend: "openai" }, { sampling: { min_p: 0.1 } });
		const sent = await api.request({ model: "gpt-x", max_tokens: 8, messages: user, metadata: { prompt_cache_key: "k" } });
		expect(sent.body.min_p).toBeUndefined();
		expect(sent.body.messages).toBeUndefined();
		expect(sent.images.retry).toBe(false);
		expect(sent.tools.retry).toBe(false);
		expect(sent.state.convert.dropped).toEqual(expect.arrayContaining(["prompt_cache_key"]));
	});
});

describe("Anthropic front: reply", () => {
	it("returns thinking with the encrypted reasoning in the signature, text, tool use and usage", async () => {
		const { api, use } = await apiFor("anthropic");
		use(() => ({ body: reply([reasoning, message("Sure"), call]) }));
		const result = await api.send({ model: "gpt-x", max_tokens: 8, messages: user, tools: [tool] });
		expect(result.status).toBe(200);
		const [thinking, text, toolUse] = result.body.content;
		expect(thinking).toMatchObject({ type: "thinking", thinking: "Plan A\n\nPlan B", signature: expect.stringMatching(/^llmt:/) });
		expect(text).toEqual({ type: "text", text: "Sure" });
		expect(toolUse).toMatchObject({ type: "tool_use", id: "call_1", name: "Read", input: { path: "/a" } });
		expect(result.body.stop_reason).toBe("tool_use");
		expect(result.body.usage).toMatchObject({ input_tokens: 15, output_tokens: 7, cache_read_input_tokens: 5 });
		const report = await result.usage;
		expect(report).toMatchObject({
			input_tokens: 15,
			output_tokens: 7,
			cache_read_input_tokens: 5,
			reported: true,
			complete: true,
			estimated: null
		});
	});

	it("sends the signed reasoning back as a reasoning item before the tool call it led to", async () => {
		const { api, use, transport } = await apiFor("anthropic");
		use(() => ({ body: reply([reasoning, call]) }));
		const first = await api.send({ model: "gpt-x", max_tokens: 8, messages: user, tools: [tool] });
		use(() => ({ body: reply([message("done")]) }));
		const second = await api.send({
			model: "gpt-x",
			max_tokens: 8,
			tools: [tool],
			messages: [
				...user,
				{ role: "assistant", content: first.body.content },
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "file" }] }
			]
		});
		expect(second.body.content[0]).toEqual({ type: "text", text: "done" });
		expect(sentBody(transport).input).toEqual([
			{ role: "user", content: "hi" },
			{
				type: "reasoning",
				id: "rs_1",
				summary: [{ type: "summary_text", text: "Plan A\n\nPlan B" }],
				encrypted_content: "ENC-1"
			},
			{ type: "function_call", call_id: "call_1", name: "Read", arguments: '{"path":"/a"}' },
			{ type: "function_call_output", call_id: "call_1", output: "file" }
		]);
	});

	it("estimates usage the upstream did not report and records a finished reply", async () => {
		const { api, use } = await apiFor("anthropic");
		use(() => ({ body: reply([message("hello there")], { usage: undefined }) }));
		const result = await api.send({ model: "gpt-x", max_tokens: 8, messages: user });
		expect(result.body.usage.input_tokens).toBeGreaterThan(0);
		expect(result.body.usage.output_tokens).toBeGreaterThan(0);
		const report = await result.usage;
		expect(report).toMatchObject({ reported: false, estimated: { input_tokens: expect.any(Number), output_tokens: expect.any(Number) } });
	});

	it("maps an incomplete reply to max_tokens and a failed one to an error", async () => {
		const { api, use } = await apiFor("anthropic");
		use(() => ({ body: reply([message("cut")], { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }) }));
		expect((await api.send({ model: "gpt-x", max_tokens: 8, messages: user })).body.stop_reason).toBe("max_tokens");
		use(() => ({ body: reply([], { status: "failed", error: { code: "server_error", message: "model fell over" } }) }));
		const failed = await api.send({ model: "gpt-x", max_tokens: 8, messages: user });
		expect(failed.status).toBe(502);
		expect(failed.body.error.message).toBe("model fell over");
	});

	it("answers an upstream HTTP error in the client's shape", async () => {
		const { api, use } = await apiFor("anthropic");
		use(() => ({ status: 400, body: { error: { message: "bad input", type: "invalid_request_error", code: "x" } } }));
		const result = await api.send({ model: "gpt-x", max_tokens: 8, messages: user });
		expect(result.status).toBe(400);
		expect(result.body).toMatchObject({ type: "error", error: { type: "invalid_request_error", message: "bad input" } });
		expect(await result.usage).toMatchObject({ reason: "upstream_error", complete: false });
	});
});

describe("OpenAI front", () => {
	it("converts a Chat Completions request and reply", async () => {
		const { api, use, transport } = await apiFor("openai");
		use(() => ({ body: reply([reasoning, message("Sure"), call]) }));
		const result = await api.send({
			model: "gpt-x",
			max_completion_tokens: 50,
			messages: [
				{ role: "system", content: "be brief" },
				{ role: "user", content: "hi" }
			],
			tools: [{ type: "function", function: { name: "Read", description: "read", parameters: { type: "object", properties: {} } } }],
			reasoning_effort: "low"
		});
		expect(sentBody(transport)).toMatchObject({
			model: "gpt-x",
			instructions: "be brief",
			input: [{ role: "user", content: "hi" }],
			max_output_tokens: 50,
			reasoning: { effort: "low", summary: "auto" },
			store: false
		});
		const [choice] = result.body.choices;
		expect(choice.message).toMatchObject({
			role: "assistant",
			content: "Sure",
			reasoning: "Plan A\n\nPlan B",
			tool_calls: [{ id: "call_1", type: "function", function: { name: "Read", arguments: '{"path":"/a"}' } }],
			reasoning_details: [{ type: "reasoning.encrypted", data: "ENC-1", id: "rs_1", format: "openai-responses-v1", index: 0 }]
		});
		expect(choice.finish_reason).toBe("tool_calls");
		expect(result.body.usage).toEqual({
			prompt_tokens: 20,
			completion_tokens: 7,
			total_tokens: 27,
			prompt_tokens_details: { cached_tokens: 5 },
			completion_tokens_details: { reasoning_tokens: 3 }
		});
		expect(result.body.model).toBe("gpt-x");
		expect(await result.usage).toMatchObject({ input_tokens: 15, output_tokens: 7, cache_read_input_tokens: 5, reported: true });
	});

	it("replays the reasoning details the client sends back", async () => {
		const { api, use, transport } = await apiFor("openai");
		use(() => ({ body: reply([message("ok")]) }));
		await api.send({
			model: "gpt-x",
			messages: [
				{ role: "user", content: "go" },
				{
					role: "assistant",
					content: null,
					reasoning_details: [{ type: "reasoning.encrypted", data: "ENC-2", format: "openai-responses-v1", index: 0 }],
					tool_calls: [{ id: "call_9", type: "function", function: { name: "Read", arguments: "{}" } }]
				},
				{ role: "tool", tool_call_id: "call_9", content: "result" }
			]
		});
		expect(sentBody(transport).input).toEqual([
			{ role: "user", content: "go" },
			{ type: "reasoning", summary: [], encrypted_content: "ENC-2" },
			{ type: "function_call", call_id: "call_9", name: "Read", arguments: "{}" },
			{ type: "function_call_output", call_id: "call_9", output: "result" }
		]);
	});

	it("skips output items it has no Chat Completions counterpart for", async () => {
		const { api, use } = await apiFor("openai");
		use(() => ({ body: reply([{ type: "web_search_call", id: "ws_1", status: "completed" }, message("found")]) }));
		const result = await api.send({ model: "gpt-x", messages: user });
		expect(result.body.choices[0].message.content).toBe("found");
	});

	it("fans n above 1 out to parallel single-choice requests", async () => {
		const { api, use, transport } = await apiFor("openai");
		use(() => ({ body: reply([message("one")]) }));
		const result = await api.send({ model: "gpt-x", n: 2, messages: user });
		expect(transport.calls).toHaveLength(2);
		expect(result.body.choices.map((choice) => choice.index)).toEqual([0, 1]);
	});
});

describe("streaming", () => {
	const events = [
		{ type: "response.created", response: { id: "resp_s1", model: "gpt-x", status: "in_progress", output: [] } },
		{ type: "response.output_item.added", output_index: 0, item: { type: "reasoning", id: "rs_1", summary: [] } },
		{ type: "response.reasoning_summary_part.added", output_index: 0, summary_index: 0 },
		{ type: "response.reasoning_summary_text.delta", output_index: 0, summary_index: 0, delta: "Plan A" },
		{ type: "response.reasoning_summary_part.added", output_index: 0, summary_index: 1 },
		{ type: "response.reasoning_summary_text.delta", output_index: 0, summary_index: 1, delta: "Plan B" },
		{ type: "response.output_item.done", output_index: 0, item: reasoning },
		{ type: "response.output_item.added", output_index: 1, item: { type: "message", id: "msg_1", content: [] } },
		{ type: "response.output_text.delta", output_index: 1, content_index: 0, delta: "Sure, " },
		{ type: "response.output_text.delta", output_index: 1, content_index: 0, delta: "reading." },
		{ type: "response.output_item.done", output_index: 1, item: message("Sure, reading.") },
		{ type: "response.output_item.added", output_index: 2, item: { ...call, arguments: "" } },
		{ type: "response.function_call_arguments.delta", output_index: 2, delta: '{"path"' },
		{ type: "response.function_call_arguments.delta", output_index: 2, delta: ':"/a"}' },
		{ type: "response.output_item.done", output_index: 2, item: call },
		{ type: "response.completed", response: reply([reasoning, message("Sure, reading."), call]) }
	];

	it("converts the events to Anthropic events, whatever the chunking", async () => {
		const { api, use, transport } = await apiFor("anthropic");
		for (const size of [7, 4000]) {
			use(raw(frames(events), size));
			const result = await api.send({ model: "gpt-x", max_tokens: 8, stream: true, messages: user, tools: [tool] });
			expect(sentBody(transport)).toMatchObject({ stream: true, store: false });
			expect(transport.calls[0].init.headers.accept).toBe("text/event-stream");
			const out = await collect(result.stream);
			const names = out.map((entry) => entry.event);
			expect(names[0]).toBe("message_start");
			expect(names.at(-1)).toBe("message_stop");
			const blocks = out.filter((entry) => entry.event === "content_block_start").map((entry) => entry.data.content_block);
			expect(blocks.map((block) => block.type)).toEqual(["thinking", "text", "tool_use"]);
			const sig = out.find((entry) => entry.data.delta?.type === "signature_delta");
			expect(sig.data.delta.signature).toMatch(/^llmt:/);
			const thinking = out.filter((entry) => entry.data.delta?.type === "thinking_delta").map((entry) => entry.data.delta.thinking);
			expect(thinking.join("")).toBe("Plan A\n\nPlan B");
			const json = out.filter((entry) => entry.data.delta?.type === "input_json_delta").map((entry) => entry.data.delta.partial_json);
			expect(JSON.parse(json.join(""))).toEqual({ path: "/a" });
			const last = out.find((entry) => entry.event === "message_delta");
			expect(last.data.delta.stop_reason).toBe("tool_use");
			expect(last.data.usage).toMatchObject({ input_tokens: 15, output_tokens: 7, cache_read_input_tokens: 5 });
			expect(await result.usage).toMatchObject({ input_tokens: 15, output_tokens: 7, reported: true, complete: true });
		}
	});

	it("converts the events to Chat Completions chunks with usage only when asked for", async () => {
		const { api, use } = await apiFor("openai");
		use(raw(frames(events), 11));
		const asked = await api.send({
			model: "gpt-x",
			stream: true,
			stream_options: { include_usage: true },
			messages: user,
			tools: [{ type: "function", function: { name: "Read", parameters: { type: "object", properties: {} } } }]
		});
		const out = (await collect(asked.stream)).map((entry) => entry.data);
		expect(out.at(-1)).toBe("[DONE]");
		expect(out[0].choices[0].delta).toEqual({ role: "assistant", content: "" });
		expect(out.at(-2)).toMatchObject({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 7 } });
		const deltas = out.filter((chunk) => chunk.choices?.length).map((chunk) => chunk.choices[0]);
		expect(deltas.map((choice) => choice.delta.content).join("")).toBe("Sure, reading.");
		expect(deltas.at(-1).finish_reason).toBe("tool_calls");
		use(raw(frames(events), 11));
		const quiet = await api.send({ model: "gpt-x", stream: true, messages: user });
		const plain = (await collect(quiet.stream)).map((entry) => entry.data);
		expect(plain.some((chunk) => chunk.usage)).toBe(false);
	});

	it("ends a stream that fails with an error event", async () => {
		const { api, use } = await apiFor("anthropic");
		const failed = [
			events[0],
			{ type: "response.failed", response: { id: "resp_s1", status: "failed", error: { code: "server_error", message: "boom" } } }
		];
		use(raw(frames(failed)));
		const out = await collect((await api.send({ model: "gpt-x", max_tokens: 8, stream: true, messages: user })).stream);
		expect(out.at(-1)).toMatchObject({ event: "error", data: { error: { message: "boom" } } });
		use(raw(frames([events[0], { type: "error", code: "rate_limit_exceeded", message: "slow down" }])));
		const limited = await collect((await api.send({ model: "gpt-x", max_tokens: 8, stream: true, messages: user })).stream);
		expect(limited.at(-1)).toMatchObject({ event: "error" });
		use(raw(frames(events.slice(0, 4))));
		const cut = await collect((await api.send({ model: "gpt-x", max_tokens: 8, stream: true, messages: user })).stream);
		expect(cut.at(-1)).toMatchObject({ event: "error", data: { error: { message: "Upstream stream ended before completion" } } });
	});
});

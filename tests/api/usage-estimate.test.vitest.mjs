/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/usage-estimate.test.vitest.mjs
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
 * @fileoverview Estimated usage in converted replies whose upstream sent none, and its separation from the usage report.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { openaiSse } from "../helpers/streams.mjs";
import { estimate } from "../../src/lib/estimate.mjs";

afterEach(closeAll);

const base = { id: "chatcmpl-1", object: "chat.completion.chunk", created: 1, model: "qwen3-coder" };
const chunk = (delta, finish = null) => ({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] });
const frames = (usage) => [
	chunk({ role: "assistant", content: "" }),
	chunk({ content: "Hello there, friend" }),
	chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "Read", arguments: '{"file":"/a"}' } }] }),
	chunk({}, "tool_calls"),
	...(usage ? [{ ...base, choices: [], usage }] : []),
	"[DONE]"
];
const completion = (usage) => ({
	id: "chatcmpl-1",
	object: "chat.completion",
	created: 1,
	model: "qwen3-coder",
	choices: [{ index: 0, message: { role: "assistant", content: "Hello there, friend" }, finish_reason: "stop" }],
	...(usage ? { usage } : {})
});
const sse = (text) => new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
const anthropicSse = (events) => events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
const anthropicEvents = (usage) =>
	anthropicSse([
		[
			"message_start",
			{ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5", content: [], usage } }
		],
		["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
		["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello there, friend" } }],
		["content_block_stop", { type: "content_block_stop", index: 0 }],
		["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: {} }],
		["message_stop", { type: "message_stop" }]
	]);
const message = (usage) => ({
	id: "msg_1",
	type: "message",
	role: "assistant",
	model: "claude-sonnet-5",
	content: [
		{ type: "text", text: "Hello there, friend" },
		{ type: "tool_use", id: "toolu_1", name: "Read", input: { file: "/a" } }
	],
	stop_reason: "tool_use",
	stop_sequence: null,
	...(usage ? { usage } : {})
});

const ask = { model: "qwen3-coder", max_tokens: 64, messages: [{ role: "user", content: "hi" }] };
const vllm = { url: "http://vllm.test", backend: "vllm", models: ["qwen3-coder"] };
const plain = { url: "http://plain.test", backend: "openai", models: ["qwen3-coder"] };
const claude = { url: "https://api.anthropic.com", backend: "anthropic" };
const askClaude = { model: "claude-sonnet-5", max_tokens: 64, messages: [{ role: "user", content: "hi" }] };
// "Hello there, friend" (19) + "Read" (4) + '{"file":"/a"}' (13) characters of output
const OUTPUT = Math.ceil(36 / 4);

/**
 * Transport that answers `answer` for the chat route and `count` for the tokenizer routes.
 * @param {any} answer - Reply for the generation request.
 * @param {(url: string) => any} [count] - Reply for a tokenizer request.
 * @returns {Function} Fake transport.
 */
const route = (answer, count = () => ({ status: 404, body: {} })) =>
	fakeTransport((url) => (url.endsWith("/tokenize") || url.endsWith("/count_tokens") ? count(url) : answer));
const tokenizer = (url) => ({ body: url.endsWith("/tokenize") ? { count: 42 } : { input_tokens: 77 } });
const sent = (transport) => JSON.parse(transport.calls.find((call) => !/tokenize|count_tokens/.test(call.url)).init.body);

describe("Anthropic front, OpenAI-protocol upstream", () => {
	it("JSON: server tokenizer input, character output, report keeps estimates separate", async () => {
		const transport = route({ body: completion() }, tokenizer);
		const api = await make({ upstreams: [vllm], transport, detect: false });
		const reply = await api.send(ask);
		expect(reply.body.usage).toMatchObject({ input_tokens: 42, output_tokens: 5 });
		expect(await reply.usage).toMatchObject({
			input_tokens: null,
			output_tokens: null,
			cache_read_input_tokens: null,
			cache_creation_input_tokens: null,
			reported: false,
			complete: true,
			estimated: { input_tokens: 42, output_tokens: 5 }
		});
	});

	it("JSON: no tokenizer means the character estimate, and a failed tokenizer falls back to it", async () => {
		for (const [upstream, handler] of [
			[plain, undefined],
			[vllm, undefined]
		]) {
			const transport = route({ body: completion() }, handler);
			const api = await make({ upstreams: [upstream], transport, detect: false });
			const reply = await api.send(ask);
			const input = estimate(sent(transport));
			expect(reply.body.usage).toMatchObject({ input_tokens: input, output_tokens: 5 });
			expect((await reply.usage).estimated).toEqual({ input_tokens: input, output_tokens: 5 });
		}
	});

	it("JSON: tool calls count towards the output", async () => {
		const withTool = completion();
		withTool.choices[0].message.tool_calls = [{ id: "call_1", type: "function", function: { name: "Read", arguments: '{"file":"/a"}' } }];
		const api = await make({ upstreams: [plain], transport: route({ body: withTool }), detect: false });
		const reply = await api.send(ask);
		expect(reply.body.usage.output_tokens).toBe(OUTPUT);
	});

	it("JSON: an empty reply still estimates at least one output token", async () => {
		const empty = { ...completion(), choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: "stop" }] };
		const api = await make({ upstreams: [plain], transport: route({ body: empty }), detect: false });
		const reply = await api.send(ask);
		expect(reply.body.usage.output_tokens).toBe(1);
	});

	it("JSON: real usage wins and estimated is null", async () => {
		const transport = route({ body: completion({ prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 }) }, tokenizer);
		const api = await make({ upstreams: [vllm], transport, detect: false });
		const reply = await api.send(ask);
		expect(reply.body.usage).toMatchObject({ input_tokens: 20, output_tokens: 5 });
		expect(await reply.usage).toMatchObject({ input_tokens: 20, output_tokens: 5, reported: true, estimated: null });
		expect(transport.calls.some((call) => call.url.endsWith("/tokenize"))).toBe(false);
	});

	it("stream: estimates go into message_delta only, and into the report", async () => {
		const transport = route(sse(openaiSse(frames(null))), tokenizer);
		const api = await make({ upstreams: [vllm], transport, detect: false });
		const reply = await api.send({ ...ask, stream: true });
		const events = await collect(reply.stream);
		const start = events.find((event) => event.event === "message_start");
		const delta = events.find((event) => event.event === "message_delta");
		expect(start.data.message.usage).toMatchObject({ input_tokens: 0, output_tokens: 0 });
		expect(delta.data.usage).toMatchObject({ input_tokens: 42, output_tokens: OUTPUT });
		expect(await reply.usage).toMatchObject({
			input_tokens: null,
			output_tokens: null,
			reported: false,
			complete: true,
			estimated: { input_tokens: 42, output_tokens: OUTPUT }
		});
	});

	it("stream: real usage passes through untouched and never calls the tokenizer", async () => {
		const real = { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 };
		const transport = route(sse(openaiSse(frames(real))), tokenizer);
		const api = await make({ upstreams: [vllm], transport, detect: false });
		const reply = await api.send({ ...ask, stream: true });
		const events = await collect(reply.stream);
		expect(events.find((event) => event.event === "message_delta").data.usage).toMatchObject({ input_tokens: 20, output_tokens: 5 });
		expect(await reply.usage).toMatchObject({ input_tokens: 20, output_tokens: 5, reported: true, estimated: null });
		expect(transport.calls.some((call) => call.url.endsWith("/tokenize"))).toBe(false);
	});

	it("stream: a stream that fails before its end carries no estimate", async () => {
		const failing = openaiSse([
			chunk({ role: "assistant", content: "Hi" }),
			{ error: { message: "boom", type: "server_error" } },
			"[DONE]"
		]);
		const api = await make({ upstreams: [vllm], transport: route(sse(failing), tokenizer), detect: false });
		const reply = await api.send({ ...ask, stream: true });
		await collect(reply.stream);
		expect(await reply.usage).toMatchObject({ reported: false, complete: false, estimated: null });
	});
});

describe("retry without tools", () => {
	it("estimates the input from the request that was actually answered", async () => {
		const refusal = {
			error: { message: '"auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set', type: "BadRequestError" }
		};
		const transport = fakeTransport((_url, init) =>
			JSON.parse(init.body).tools ? { status: 400, body: refusal } : { body: completion() }
		);
		const api = await make({ upstreams: [{ ...plain, settings: { toolFallback: true } }], transport, detect: false });
		const tool = { name: "weather", description: "Look up weather", input_schema: { type: "object", properties: {} } };
		const reply = await api.send({ ...ask, tools: [tool] });
		expect(transport.calls).toHaveLength(2);
		const retried = JSON.parse(transport.calls[1].init.body);
		expect(retried.tools).toBeUndefined();
		expect(reply.body.usage.input_tokens).toBe(estimate(retried));
		expect((await reply.usage).estimated.input_tokens).toBe(estimate(retried));
	});
});

describe("a side the upstream did report is left alone", () => {
	const only = (usage) => route({ body: completion(usage) }, tokenizer);

	it("Anthropic front, JSON: only output reported, only input reported, only a total reported", async () => {
		const api = await make({ upstreams: [vllm], transport: only({ completion_tokens: 7 }), detect: false });
		const out = await api.send(ask);
		expect(out.body.usage).toMatchObject({ input_tokens: 42, output_tokens: 7 });
		expect(await out.usage).toMatchObject({
			input_tokens: null,
			output_tokens: 7,
			reported: true,
			estimated: { input_tokens: 42, output_tokens: null }
		});

		const input = await (await make({ upstreams: [vllm], transport: only({ prompt_tokens: 20 }), detect: false })).send(ask);
		expect(input.body.usage).toMatchObject({ input_tokens: 20, output_tokens: 5 });
		expect(await input.usage).toMatchObject({ input_tokens: 20, output_tokens: null, estimated: { input_tokens: null, output_tokens: 5 } });

		const total = await (await make({ upstreams: [vllm], transport: only({ total_tokens: 30 }), detect: false })).send(ask);
		expect(total.body.usage.total_tokens).toBeUndefined();
		expect(total.body.usage).toMatchObject({ input_tokens: 42, output_tokens: 5 });
		expect(await total.usage).toMatchObject({ reported: false, estimated: { input_tokens: 42, output_tokens: 5 } });
	});

	it("a reported 0 is real, not missing", async () => {
		const openai = await (
			await make({ upstreams: [vllm], transport: only({ prompt_tokens: 20, completion_tokens: 0 }), detect: false })
		).send(ask);
		expect(openai.body.usage).toMatchObject({ input_tokens: 20, output_tokens: 0 });
		expect(await openai.usage).toMatchObject({ input_tokens: 20, output_tokens: 0, reported: true, estimated: null });
		const zeroInput = await (
			await make({ upstreams: [vllm], transport: only({ prompt_tokens: 0, completion_tokens: 9 }), detect: false })
		).send(ask);
		expect(zeroInput.body.usage).toMatchObject({ input_tokens: 0, output_tokens: 9 });
		expect((await zeroInput.usage).estimated).toBeNull();
		const claudeApi = await make({
			front: "openai",
			upstreams: [claude],
			transport: route({ body: message({ input_tokens: 10, output_tokens: 0 }) }, tokenizer),
			detect: false
		});
		const viaClaude = await claudeApi.send(askClaude);
		expect(viaClaude.body.usage).toEqual({ prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 });
		expect((await viaClaude.usage).estimated).toBeNull();
		const stream = await (
			await make({
				upstreams: [vllm],
				transport: route(sse(openaiSse(frames({ prompt_tokens: 20, completion_tokens: 0 }))), tokenizer),
				detect: false
			})
		).send({ ...ask, stream: true });
		const events = await collect(stream.stream);
		expect(events.find((event) => event.event === "message_delta").data.usage).toMatchObject({ input_tokens: 20, output_tokens: 0 });
		expect((await stream.usage).estimated).toBeNull();
	});

	it("Anthropic front, stream: only the missing side of message_delta is estimated", async () => {
		const frame = (usage) => sse(openaiSse(frames(usage)));
		for (const [usage, expected, estimated] of [
			[{ prompt_tokens: 20 }, { input_tokens: 20, output_tokens: OUTPUT }, { input_tokens: null, output_tokens: OUTPUT }],
			[{ completion_tokens: 9 }, { input_tokens: 42, output_tokens: 9 }, { input_tokens: 42, output_tokens: null }]
		]) {
			const api = await make({ upstreams: [vllm], transport: route(frame(usage), tokenizer), detect: false });
			const reply = await api.send({ ...ask, stream: true });
			const events = await collect(reply.stream);
			expect(events.find((event) => event.event === "message_delta").data.usage).toMatchObject(expected);
			expect((await reply.usage).estimated).toEqual(estimated);
		}
	});

	it("OpenAI front, JSON: prompt and completion are kept apart and the total follows", async () => {
		const run = async (usage) => {
			const transport = route({ body: message(usage) }, tokenizer);
			const api = await make({ front: "openai", upstreams: [claude], transport, detect: false });
			return await api.send(askClaude);
		};
		const inputOnly = await run({ input_tokens: 10 });
		expect(inputOnly.body.usage).toEqual({ prompt_tokens: 10, completion_tokens: OUTPUT, total_tokens: 10 + OUTPUT });
		expect(await inputOnly.usage).toMatchObject({ estimated: { input_tokens: null, output_tokens: OUTPUT } });
		const outputOnly = await run({ output_tokens: 3 });
		expect(outputOnly.body.usage).toEqual({ prompt_tokens: 77, completion_tokens: 3, total_tokens: 80 });
		expect(await outputOnly.usage).toMatchObject({ estimated: { input_tokens: 77, output_tokens: null } });
	});

	it("OpenAI front, stream: only the missing side of the usage chunk is estimated", async () => {
		const transport = route(sse(anthropicEvents({ input_tokens: 10 })), tokenizer);
		const api = await make({ front: "openai", upstreams: [claude], transport, detect: false });
		const reply = await api.send({ ...askClaude, stream: true, stream_options: { include_usage: true } });
		const events = await collect(reply.stream);
		expect(events.find((event) => event.data?.choices?.length === 0).data.usage).toEqual({
			prompt_tokens: 10,
			completion_tokens: 5,
			total_tokens: 15
		});
		expect((await reply.usage).estimated).toEqual({ input_tokens: null, output_tokens: 5 });
	});
});

describe("OpenAI front, Anthropic upstream", () => {
	it("JSON: prompt, completion and total tokens are estimated", async () => {
		const transport = route({ body: message() }, tokenizer);
		const api = await make({ front: "openai", upstreams: [claude], transport, detect: false });
		const reply = await api.send(askClaude);
		expect(reply.body.usage).toEqual({ prompt_tokens: 77, completion_tokens: OUTPUT, total_tokens: 77 + OUTPUT });
		expect(await reply.usage).toMatchObject({
			input_tokens: null,
			reported: false,
			estimated: { input_tokens: 77, output_tokens: OUTPUT }
		});
	});

	it("JSON: real usage wins", async () => {
		const transport = route({ body: message({ input_tokens: 10, output_tokens: 3 }) }, tokenizer);
		const api = await make({ front: "openai", upstreams: [claude], transport, detect: false });
		const reply = await api.send(askClaude);
		expect(reply.body.usage).toMatchObject({ prompt_tokens: 10, completion_tokens: 3 });
		expect(await reply.usage).toMatchObject({ input_tokens: 10, output_tokens: 3, estimated: null });
	});

	it("stream: tool calls count towards the output", async () => {
		const events = anthropicSse([
			[
				"message_start",
				{ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5", content: [] } }
			],
			[
				"content_block_start",
				{ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "Read", input: {} } }
			],
			[
				"content_block_delta",
				{ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"file":"/a"}' } }
			],
			["content_block_stop", { type: "content_block_stop", index: 0 }],
			["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: {} }],
			["message_stop", { type: "message_stop" }]
		]);
		const api = await make({ front: "openai", upstreams: [claude], transport: route(sse(events), tokenizer), detect: false });
		const reply = await api.send({ ...askClaude, stream: true, stream_options: { include_usage: true } });
		const chunks = await collect(reply.stream);
		expect(chunks.find((event) => event.data?.choices?.length === 0).data.usage).toMatchObject({ completion_tokens: 5 });
	});

	it("stream: the usage chunk is patched when the client asked for it", async () => {
		const transport = route(sse(anthropicEvents({ input_tokens: 0, output_tokens: 0 })), tokenizer);
		const api = await make({ front: "openai", upstreams: [claude], transport, detect: false });
		const reply = await api.send({ ...askClaude, stream: true, stream_options: { include_usage: true } });
		const events = await collect(reply.stream);
		const usageChunk = events.find((event) => event.data?.choices?.length === 0);
		expect(usageChunk.data.usage).toEqual({ prompt_tokens: 77, completion_tokens: 5, total_tokens: 82 });
		expect(await reply.usage).toMatchObject({ reported: false, estimated: { input_tokens: 77, output_tokens: 5 } });
	});

	it("stream: when the client will not see the usage the tokenizer is skipped, the character estimate is reported", async () => {
		const transport = route(sse(anthropicEvents({ input_tokens: 0, output_tokens: 0 })), tokenizer);
		const api = await make({ front: "openai", upstreams: [claude], transport, detect: false });
		const reply = await api.send({ ...askClaude, stream: true });
		const events = await collect(reply.stream);
		expect(events.find((event) => event.data?.choices?.length === 0)).toBeUndefined();
		expect(transport.calls.some((call) => call.url.endsWith("/count_tokens"))).toBe(false);
		const input = estimate(sent(transport));
		expect(await reply.usage).toMatchObject({ reported: false, estimated: { input_tokens: input, output_tokens: 5 } });
	});

	it("count_tokens also forwards mcp_servers and context_management on a native upstream", async () => {
		const native = route({ body: message() }, tokenizer);
		const direct = await make({ upstreams: [claude], transport: native, detect: false });
		await direct.token.count({
			...askClaude,
			mcp_servers: [{ type: "url", url: "https://m.test", name: "m" }],
			context_management: { edits: [] }
		});
		const forwarded = JSON.parse(native.calls.find((call) => call.url.endsWith("/count_tokens")).init.body);
		expect(forwarded).toMatchObject({ mcp_servers: [{ name: "m" }], context_management: { edits: [] } });
		expect(forwarded.max_tokens).toBeUndefined();
	});

	it("count_tokens is sent only the fields it accepts", async () => {
		const transport = route({ body: message() }, tokenizer);
		const api = await make({ front: "openai", upstreams: [claude], transport, detect: false });
		await api.send({
			model: "claude-sonnet-5",
			temperature: 0.2,
			top_p: 0.9,
			max_tokens: 32,
			messages: [
				{ role: "system", content: "be brief" },
				{ role: "user", content: "hi" }
			],
			tools: [{ type: "function", function: { name: "t", description: "d", parameters: { type: "object" } } }]
		});
		const counted = JSON.parse(transport.calls.find((call) => call.url.endsWith("/count_tokens")).init.body);
		expect(Object.keys(counted).sort()).toEqual(["messages", "model", "system", "tools"]);
	});
});

describe("pass-through replies", () => {
	it("a native reply is not altered and has no estimate", async () => {
		const transport = route({ body: message() }, tokenizer);
		const api = await make({ upstreams: [claude], transport, detect: false });
		const reply = await api.send(askClaude);
		expect(reply.body.usage).toBeUndefined();
		expect(await reply.usage).toMatchObject({ reported: false, estimated: null });
		const streaming = await make({
			upstreams: [claude],
			transport: route(sse(anthropicEvents({ input_tokens: 0, output_tokens: 0 }))),
			detect: false
		});
		const stream = await streaming.send({ ...askClaude, stream: true });
		const events = await collect(stream.stream);
		expect(events.find((event) => event.event === "message_delta").data.usage).toEqual({});
		expect((await stream.usage).estimated).toBeNull();
	});
});

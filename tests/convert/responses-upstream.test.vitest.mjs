/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/convert/responses-upstream.test.vitest.mjs
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
 * @fileoverview The Chat Completions to Responses request converter and the Responses reply and stream converters, one mapping at a time.
 */
import { describe, expect, test } from "vitest";
import { request, response, stream, usageOf } from "../../src/lib/responses-upstream.mjs";
import { request as chatRequest } from "../../src/api/convert/openai/chat/to/openai/responses/request.mjs";
import { response as chatReply } from "../../src/api/convert/openai/responses/to/openai/chat/response.mjs";
import { stream as chatStream } from "../../src/api/convert/openai/responses/to/openai/chat/stream.mjs";
import { collect } from "../helpers/streams.mjs";

const user = [{ role: "user", content: "hi" }];
const convert = (extra = {}, settings) => request({ model: "m", messages: user, ...extra }, settings);

describe("request: messages", () => {
	test("leading system and developer text becomes instructions, later system text stays an input item", () => {
		const { body } = convert({
			messages: [
				{ role: "system", content: "one" },
				{ role: "developer", content: [{ type: "text", text: "two" }] },
				{ role: "system", content: "" },
				{ role: "user", content: "hi" },
				{ role: "system", content: "late" }
			]
		});
		expect(body.instructions).toBe("one\n\ntwo");
		expect(body.input).toEqual([
			{ role: "user", content: "hi" },
			{ role: "system", content: "late" }
		]);
		expect(convert().body.instructions).toBeUndefined();
	});

	test("user parts: text, images (string or object, with detail), files, and an unsupported part recorded as dropped", () => {
		const { body, state } = convert({
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "see" },
						{ type: "image_url", image_url: "https://x/a.png" },
						{ type: "image_url", image_url: { url: "https://x/b.png", detail: "high" } },
						{ type: "file", file: { file_id: "file-1" } },
						{ type: "file", file: { file_data: "QUJD", filename: "a.pdf" } },
						{ type: "input_audio", input_audio: {} },
						{ type: "input_audio", input_audio: {} }
					]
				},
				{ role: "user", content: undefined }
			]
		});
		expect(body.input[0].content).toEqual([
			{ type: "input_text", text: "see" },
			{ type: "input_image", image_url: "https://x/a.png" },
			{ type: "input_image", image_url: "https://x/b.png", detail: "high" },
			{ type: "input_file", file_id: "file-1" },
			{ type: "input_file", file_data: "QUJD", filename: "a.pdf" }
		]);
		expect(body.input[1].content).toEqual([]);
		expect(state.dropped).toEqual(["content:input_audio"]);
	});

	test("tool results: a string, all-text parts joined, and parts with an image kept as input parts", () => {
		const { body } = convert({
			messages: [
				{ role: "tool", tool_call_id: "a", content: "plain" },
				{
					role: "tool",
					tool_call_id: "b",
					content: [
						{ type: "text", text: "x" },
						{ type: "text", text: "y" }
					]
				},
				{
					role: "tool",
					tool_call_id: "c",
					content: [
						{ type: "text", text: "see" },
						{ type: "image_url", image_url: { url: "data:image/png;base64,AA" } }
					]
				},
				{ role: "tool", tool_call_id: "d", content: null }
			]
		});
		expect(body.input.map((item) => item.output)).toEqual([
			"plain",
			"x\ny",
			[
				{ type: "input_text", text: "see" },
				{ type: "input_image", image_url: "data:image/png;base64,AA" }
			],
			""
		]);
	});

	test("assistant turns: text, refusal and tool calls, with no arguments written as an empty object", () => {
		const { body, state } = convert({
			messages: [
				{ role: "assistant", content: "said" },
				{ role: "assistant", content: null, refusal: "no" },
				{
					role: "assistant",
					content: [
						{ type: "text", text: "a" },
						{ type: "refusal", refusal: "b" }
					]
				},
				{
					role: "assistant",
					content: null,
					tool_calls: [
						{ id: "c1", type: "function", function: { name: "f" } },
						{ id: "c2", function: { name: "g", arguments: "{}" } },
						{ id: "c3", type: "custom", custom: { name: "h", input: "x" } }
					]
				},
				{ role: "assistant", content: "" }
			]
		});
		expect(body.input).toEqual([
			{ role: "assistant", content: "said" },
			{ role: "assistant", content: "no" },
			{ role: "assistant", content: "a" },
			{ type: "function_call", call_id: "c1", name: "f", arguments: "{}" },
			{ type: "function_call", call_id: "c2", name: "g", arguments: "{}" }
		]);
		expect(state.dropped).toEqual(["tool_call:custom"]);
	});

	test("an unknown role is an error", () => {
		expect(() => convert({ messages: [{ role: "critic", content: "x" }] })).toThrow(/unsupported role "critic"/);
		expect(() => convert({ messages: [null] })).toThrow(/unsupported role "undefined"/);
	});
});

describe("request: reasoning items", () => {
	const detail = (index, extra = {}) => ({
		type: "reasoning.encrypted",
		data: `E${index}`,
		format: "openai-responses-v1",
		index,
		...extra
	});
	const assistant = (details) => ({
		role: "assistant",
		content: "text",
		reasoning_details: details,
		tool_calls: [
			{ id: "c1", type: "function", function: { name: "f", arguments: "{}" } },
			{ id: "c2", type: "function", function: { name: "g", arguments: "{}" } }
		]
	});
	const kinds = (settings, details) =>
		convert({ messages: [...user, assistant(details)] }, settings)
			.body.input.slice(1)
			.map((item) => item.type ?? item.role);

	test("each item goes before the part its index names, and later ones follow", () => {
		const details = [detail(2, { id: "rs_2", summary: "S" }), detail(0), detail(9)];
		expect(kinds({ reasoningRoundTrip: true }, details)).toEqual([
			"reasoning",
			"assistant",
			"function_call",
			"reasoning",
			"function_call",
			"reasoning"
		]);
		const { body } = convert({ messages: [...user, assistant(details)] }, { reasoningRoundTrip: true });
		expect(body.input[4]).toEqual({
			type: "reasoning",
			id: "rs_2",
			summary: [{ type: "summary_text", text: "S" }],
			encrypted_content: "E2"
		});
	});

	test("only this protocol's items with data travel, and none when reasoningRoundTrip is off", () => {
		const other = [
			{ type: "reasoning.encrypted", data: "x", format: "anthropic-claude-v1", index: 0 },
			{ type: "reasoning.encrypted", data: "", format: "openai-responses-v1", index: 0 },
			null,
			detail(-1)
		];
		expect(kinds({ reasoningRoundTrip: true }, other)).toEqual(["reasoning", "assistant", "function_call", "function_call"]);
		expect(kinds({ reasoningRoundTrip: true }, undefined)).toEqual(["assistant", "function_call", "function_call"]);
		expect(kinds({ reasoningRoundTrip: false }, [detail(0)])).toEqual(["assistant", "function_call", "function_call"]);
	});
});

describe("request: fields", () => {
	test("sampling, limits and pass-through fields map, with the stateless defaults", () => {
		const { body, state } = convert({
			stream: true,
			stream_options: { include_usage: true },
			max_tokens: 10,
			temperature: 0.5,
			top_p: 0.8,
			user: "u",
			metadata: { a: "b" },
			service_tier: "flex",
			prompt_cache_key: "k",
			safety_identifier: "s",
			store: true,
			n: 1
		});
		expect(body).toEqual({
			model: "m",
			input: [{ role: "user", content: "hi" }],
			stream: true,
			store: false,
			max_output_tokens: 10,
			temperature: 0.5,
			top_p: 0.8,
			user: "u",
			metadata: { a: "b" },
			service_tier: "flex",
			prompt_cache_key: "k",
			safety_identifier: "s"
		});
		expect(state).toMatchObject({ front: "openai", model: "m", stream: true, includeUsage: true, dropped: [] });
		expect(convert({ max_tokens: 10, max_completion_tokens: 20 }).body.max_output_tokens).toBe(20);
		expect(convert().state).toMatchObject({ stream: false, includeUsage: false });
	});

	test("fields with no Responses counterpart are dropped and recorded, or refused when unknownFields is error", () => {
		const extra = { stop: ["x"], seed: 1, frequency_penalty: 0.1, logit_bias: {}, logprobs: true };
		expect(convert(extra).state.dropped).toEqual(["stop", "seed", "frequency_penalty", "logit_bias", "logprobs"]);
		expect(() => convert(extra, { unknownFields: "error" })).toThrow(/stop: Unrecognized request argument/);
	});

	test("a body without messages and n above 1 are errors", () => {
		expect(() => request(null)).toThrow(/messages is a required property/);
		expect(() => request({ model: "m" })).toThrow(/messages is a required property/);
		expect(() => convert({ n: 3 })).toThrow(/only a single choice/);
	});

	test("tools: function (strict written, default parameters), custom, and others dropped; no tools drops the other tool fields", () => {
		const { body, state } = convert({
			tools: [
				{
					type: "function",
					function: { name: "a", description: "d", parameters: { type: "object", properties: { x: {} } }, strict: true }
				},
				{ type: "function", function: { name: "b" } },
				{ type: "custom", custom: { name: "c", description: "e", format: { type: "text" } } },
				{ type: "custom", custom: { name: "d" } },
				{ type: "web_search" },
				null
			],
			tool_choice: "required",
			parallel_tool_calls: false
		});
		expect(body.tools).toEqual([
			{ type: "function", name: "a", description: "d", parameters: { type: "object", properties: { x: {} } }, strict: true },
			{ type: "function", name: "b", parameters: { type: "object", properties: {} }, strict: false },
			{ type: "custom", name: "c", description: "e", format: { type: "text" } },
			{ type: "custom", name: "d" }
		]);
		expect(body.tool_choice).toBe("required");
		expect(body.parallel_tool_calls).toBe(false);
		expect(state.dropped).toEqual(["tool:web_search", "tool:undefined"]);
		const bare = convert({ tools: [], tool_choice: "auto", parallel_tool_calls: true }).body;
		expect(bare.tools).toBeUndefined();
		expect(bare.tool_choice).toBeUndefined();
		expect(bare.parallel_tool_calls).toBeUndefined();
		expect(
			convert({ tools: [{ type: "function", function: { name: "a" } }], parallel_tool_calls: true }, { parallelToolCalls: false }).body
				.parallel_tool_calls
		).toBeUndefined();
		expect(convert({ tools: [{ type: "function", function: { name: "a" } }] }).body.tool_choice).toBeUndefined();
	});

	test("tool_choice: a named function or custom tool, allowed tools, and an unknown one dropped", () => {
		const tools = [{ type: "function", function: { name: "a" } }];
		const choose = (tool_choice) => convert({ tools, tool_choice });
		expect(choose({ type: "function", function: { name: "a" } }).body.tool_choice).toEqual({ type: "function", name: "a" });
		expect(choose({ type: "custom", custom: { name: "c" } }).body.tool_choice).toEqual({ type: "custom", name: "c" });
		expect(
			choose({ type: "allowed_tools", allowed_tools: { mode: "auto", tools: [{ type: "function", function: { name: "a" } }] } }).body
				.tool_choice
		).toEqual({ type: "allowed_tools", mode: "auto", tools: [{ type: "function", name: "a" }] });
		expect(choose({ type: "allowed_tools", allowed_tools: { mode: "auto" } }).body.tool_choice).toEqual({
			type: "allowed_tools",
			mode: "auto",
			tools: []
		});
		const odd = choose({ type: "mystery" });
		expect(odd.body.tool_choice).toBeUndefined();
		expect(odd.state.dropped).toEqual(["tool_choice"]);
	});

	test("response_format and verbosity become the text object", () => {
		const format = (response_format, settings) => convert({ response_format }, settings);
		expect(
			format({ type: "json_schema", json_schema: { name: "n", schema: { type: "object" }, strict: true, description: "d" } }).body.text
		).toEqual({ format: { type: "json_schema", name: "n", schema: { type: "object" }, strict: true, description: "d" } });
		expect(format({ type: "json_schema", json_schema: { schema: {} } }).body.text.format).toEqual({
			type: "json_schema",
			name: "output",
			schema: {}
		});
		expect(format({ type: "json_object" }).body.text).toEqual({ format: { type: "json_object" } });
		expect(format({ type: "text" }).body.text).toEqual({ format: { type: "text" } });
		expect(format({ type: "grammar" }).state.dropped).toEqual(["response_format"]);
		const off = format({ type: "json_object" }, { responseFormat: false });
		expect(off.body.text).toBeUndefined();
		expect(off.state.dropped).toEqual(["response_format"]);
		expect(convert({ verbosity: "low" }).body.text).toEqual({ verbosity: "low" });
		expect(convert().body.text).toBeUndefined();
	});

	test("reasoning_effort sets the effort and, unless it is none, asks for a summary", () => {
		expect(convert({ reasoning_effort: "high" }).body.reasoning).toEqual({ effort: "high", summary: "auto" });
		expect(convert({ reasoning_effort: "none" }).body.reasoning).toEqual({ effort: "none" });
		expect(convert({ reasoning_effort: "low" }, { reasoningSummary: "concise" }).body.reasoning).toEqual({
			effort: "low",
			summary: "concise"
		});
		expect(convert({ reasoning_effort: "low" }, { reasoningSummary: "none" }).body.reasoning).toEqual({ effort: "low" });
		expect(convert().body.reasoning).toBeUndefined();
	});

	test("the leaf wraps the converter", async () => {
		expect((await chatRequest({ model: "m", messages: user })).body.input).toEqual([{ role: "user", content: "hi" }]);
	});
});

describe("usageOf", () => {
	test("maps the counts and keeps the optional details only when present", () => {
		expect(usageOf({ input_tokens: 3, output_tokens: 2 })).toEqual({ prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
		expect(usageOf({ total_tokens: 9 })).toEqual({ prompt_tokens: 0, completion_tokens: 0, total_tokens: 9 });
		expect(
			usageOf({ input_tokens: 1, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 4 } })
		).toEqual({
			prompt_tokens: 1,
			completion_tokens: 0,
			total_tokens: 1,
			prompt_tokens_details: { cached_tokens: 0 },
			completion_tokens_details: { reasoning_tokens: 4 }
		});
		expect(usageOf(undefined)).toBeUndefined();
		expect(usageOf(null)).toBeUndefined();
	});
});

const out = (items, extra = {}) => ({ id: "resp_1", status: "completed", model: "up", created_at: 5, output: items, ...extra });
const text = (value) => ({ type: "message", content: [{ type: "output_text", text: value }] });

describe("response", () => {
	test("reads text, refusal, calls and reasoning, with the front's model and the usage on the state", () => {
		const state = { model: "front" };
		const reply = response(
			out(
				[
					{ type: "reasoning", id: "rs", summary: [{ type: "summary_text", text: "why" }], encrypted_content: "E" },
					{ type: "message", content: [{ type: "output_text", text: "a" }, { type: "refusal", refusal: "no" }, { type: "other" }, null] },
					{ type: "function_call", call_id: "c1", name: "f", arguments: "{}" },
					{ type: "function_call", id: "fc2", name: "g" },
					{ type: "message" },
					{ type: "web_search_call" },
					null
				],
				{ usage: { input_tokens: 1, output_tokens: 2 } }
			),
			state,
			{ reasoningRoundTrip: true, reasoningField: "reasoning_content" }
		);
		expect(reply).toMatchObject({
			id: "chatcmpl-1",
			object: "chat.completion",
			created: 5,
			model: "front",
			usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
		});
		expect(reply.choices[0]).toEqual({
			index: 0,
			finish_reason: "tool_calls",
			message: {
				role: "assistant",
				content: "a",
				refusal: "no",
				reasoning_content: "why",
				reasoning_details: [{ type: "reasoning.encrypted", data: "E", format: "openai-responses-v1", index: 0, id: "rs", summary: "why" }],
				tool_calls: [
					{ id: "c1", type: "function", function: { name: "f", arguments: "{}" } },
					{ id: "fc2", type: "function", function: { name: "g", arguments: "{}" } }
				]
			}
		});
		expect(state.upstreamUsage).toEqual(reply.usage);
	});

	test("a reply with only calls has null content; without usage or state nothing is kept", () => {
		const reply = response(
			out([{ type: "function_call", call_id: "c", name: "f", arguments: "{}" }], { created_at: undefined, id: undefined, model: "up" })
		);
		expect(reply.choices[0].message.content).toBeNull();
		expect(reply.usage).toBeUndefined();
		expect(reply.model).toBe("up");
		expect(reply.created).toBeGreaterThan(1e9);
		expect(reply.id).toMatch(/^chatcmpl-[0-9a-f]+$/);
		expect(response(out([text("x")]), {}).choices[0].message.content).toBe("x");
	});

	test("reasoning items are positioned among the text and the calls, and need encrypted content and the setting", () => {
		const item = (n) => ({
			type: "reasoning",
			id: `rs${n}`,
			encrypted_content: `E${n}`,
			content: [{ type: "reasoning_text", text: `raw${n}` }]
		});
		const reply = response(
			out([
				item(0),
				text(""),
				item(1),
				text("t"),
				item(2),
				{ type: "function_call", call_id: "c", name: "f", arguments: "{}" },
				item(3),
				{ type: "reasoning" }
			]),
			undefined,
			{ reasoningRoundTrip: true }
		);
		expect(reply.choices[0].message.reasoning_details.map((detail) => [detail.id, detail.index])).toEqual([
			["rs0", 0],
			["rs1", 0],
			["rs2", 1],
			["rs3", 2]
		]);
		expect(reply.choices[0].message.reasoning).toBe("raw0\n\nraw1\n\nraw2\n\nraw3");
		const plain = response(out([item(0), { type: "reasoning", encrypted_content: "" }]));
		expect(plain.choices[0].message.reasoning_details).toBeUndefined();
		const noId = response(
			out([{ type: "reasoning", encrypted_content: "E", summary: [{ type: "summary_text", text: "s" }, { type: "x" }] }]),
			undefined,
			{
				reasoningRoundTrip: true
			}
		);
		expect(noId.choices[0].message.reasoning_details).toEqual([
			{ type: "reasoning.encrypted", data: "E", format: "openai-responses-v1", index: 0, summary: "s" }
		]);
	});

	test("an incomplete reply finishes with length or content_filter, and other reasons as stop", () => {
		const finish = (reason) =>
			response(out([text("x")], { status: "incomplete", incomplete_details: reason && { reason } })).choices[0].finish_reason;
		expect(finish("max_output_tokens")).toBe("length");
		expect(finish("content_filter")).toBe("content_filter");
		expect(finish("other")).toBe("stop");
		expect(finish(undefined)).toBe("stop");
	});

	test("a reply that did not finish, or has no output, is an error", () => {
		expect(() => response(out([], { status: "failed", error: { code: "server_error", message: "boom" } }))).toThrow(/boom/);
		expect(() => response(out([], { status: "cancelled" }))).toThrow(/status "cancelled"/);
		expect(() => response(out([], { status: "in_progress" }))).toThrow(/in_progress/);
		expect(() => response({ error: { message: "nope", code: "x" } })).toThrow(/nope/);
		expect(() => response({ error: {} })).toThrow(/status "failed"/);
		expect(() => response({ id: "r" })).toThrow(/no output/);
		expect(() => response(null)).toThrow(/no output/);
		try {
			response(out([], { status: "failed", error: { code: "server_error", message: "boom" } }));
		} catch (error) {
			expect(error).toMatchObject({ status: 502, code: "upstream_server_error" });
		}
	});
});

const run = async (events, state, settings) => (await collect(stream(events, state, settings))).map((entry) => entry.data);
const created = { type: "response.created", response: { id: "resp_9", model: "up" } };
const done = (extra = {}) => ({
	type: "response.completed",
	response: { status: "completed", usage: { input_tokens: 4, output_tokens: 1 }, ...extra }
});
const deltas = (chunks) => chunks.filter((chunk) => chunk.choices?.length).map((chunk) => chunk.choices[0]);

describe("stream", () => {
	test("text, refusal and reasoning deltas, the finish and the usage chunk", async () => {
		const state = { model: "front" };
		const chunks = await run(
			[
				created,
				{ type: "ping" },
				{ type: "response.reasoning_summary_part.added", output_index: 0 },
				{ type: "response.reasoning_summary_text.delta", output_index: 0, delta: "a" },
				{ type: "response.reasoning_text.delta", output_index: 0, delta: "b" },
				{ type: "response.reasoning_summary_text.delta", output_index: 0 },
				{ type: "response.output_text.delta", output_index: 1, delta: "" },
				{ type: "response.output_text.delta", output_index: 1 },
				{ type: "response.output_text.delta", output_index: 1, delta: "hi" },
				{ type: "response.refusal.delta", output_index: 1, delta: "no" },
				{ type: "response.refusal.delta", output_index: 1 },
				done()
			],
			state
		);
		expect(chunks[0]).toMatchObject({ id: "chatcmpl-9", model: "front", choices: [{ delta: { role: "assistant", content: "" } }] });
		expect(deltas(chunks).map((choice) => choice.delta)).toEqual([
			{ role: "assistant", content: "" },
			{ reasoning: "a" },
			{ reasoning: "b" },
			{ reasoning: "" },
			{ content: "hi" },
			{ refusal: "no" },
			{ refusal: "" },
			{}
		]);
		expect(deltas(chunks).at(-1).finish_reason).toBe("stop");
		expect(chunks.at(-2)).toMatchObject({ choices: [], usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 } });
		expect(chunks.at(-1)).toBe("[DONE]");
		expect(state.upstreamUsage).toMatchObject({ prompt_tokens: 4 });
	});

	test("without a model on the state the stream's own is used; includeUsage false and no usage drop the usage chunk", async () => {
		const chunks = await run(
			[created, { type: "response.incomplete", response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } } }],
			{
				includeUsage: false
			}
		);
		expect(chunks[0].model).toBe("up");
		expect(deltas(chunks).at(-1).finish_reason).toBe("length");
		expect(chunks.some((chunk) => chunk.choices?.length === 0)).toBe(false);
		const bare = await run([{ type: "response.created" }, { type: "response.completed" }]);
		expect(bare[0].id).toMatch(/^chatcmpl-/);
		expect(bare.at(-2)).toMatchObject({ choices: [] });
		expect(bare.at(-2).usage).toBeUndefined();
	});

	test("a tool call starts when its item is added and streams its arguments; the delta of an unknown item is ignored", async () => {
		const call = { type: "function_call", id: "fc", call_id: "c1", name: "f" };
		const chunks = await run([
			created,
			{ type: "response.function_call_arguments.delta", output_index: 4, delta: "lost" },
			{ type: "response.output_item.added", output_index: 0, item: call },
			{ type: "response.output_item.added", output_index: 0, item: call },
			{ type: "response.function_call_arguments.delta", output_index: 0, delta: "{}" },
			{ type: "response.function_call_arguments.delta", output_index: 0 },
			{ type: "response.output_item.done", output_index: 0, item: { ...call, arguments: "{}" } },
			{ type: "response.output_item.added", output_index: 1, item: { type: "message" } },
			done()
		]);
		const calls = deltas(chunks).flatMap((choice) => choice.delta.tool_calls ?? []);
		expect(calls).toEqual([
			{ index: 0, id: "c1", type: "function", function: { name: "f", arguments: "" } },
			{ index: 0, function: { arguments: "{}" } },
			{ index: 0, function: { arguments: "" } }
		]);
		expect(deltas(chunks).at(-1).finish_reason).toBe("tool_calls");
	});

	test("a server that sends items only when they are done still gets its text, summary, refusal and calls shown", async () => {
		const chunks = await run(
			[
				created,
				{
					type: "response.output_item.done",
					output_index: 0,
					item: { type: "reasoning", id: "rs", summary: [{ type: "summary_text", text: "why" }], encrypted_content: "E" }
				},
				{
					type: "response.output_item.done",
					output_index: 1,
					item: {
						type: "message",
						content: [
							{ type: "output_text", text: "ans" },
							{ type: "refusal", refusal: "no" },
							{ type: "output_text" },
							{ type: "refusal" },
							{ type: "x" }
						]
					}
				},
				{ type: "response.output_item.done", output_index: 2, item: { type: "function_call", id: "fc", name: "f", arguments: '{"a":1}' } },
				{ type: "response.output_item.done", output_index: 3, item: { type: "function_call", call_id: "c4", name: "g" } },
				{ type: "response.output_item.done", output_index: 4, item: { type: "message" } },
				{ type: "response.output_item.done", output_index: 5 },
				done()
			],
			undefined,
			{ reasoningRoundTrip: true }
		);
		const all = deltas(chunks).map((choice) => choice.delta);
		expect(all).toContainEqual({ reasoning: "why" });
		expect(all).toContainEqual({
			reasoning_details: [{ type: "reasoning.encrypted", data: "E", format: "openai-responses-v1", index: 0, id: "rs", summary: "why" }]
		});
		expect(all).toContainEqual({ content: "ans" });
		expect(all).toContainEqual({ refusal: "no" });
		expect(all).toContainEqual({ tool_calls: [{ index: 0, id: "fc", type: "function", function: { name: "f", arguments: "" } }] });
		expect(all).toContainEqual({ tool_calls: [{ index: 0, function: { arguments: '{"a":1}' } }] });
		expect(all).toContainEqual({ tool_calls: [{ index: 1, id: "c4", type: "function", function: { name: "g", arguments: "" } }] });
	});

	test("reasoning that streamed is not repeated from its item, and details carry the position", async () => {
		const item = { type: "reasoning", id: "rs", summary: [{ type: "summary_text", text: "why" }], encrypted_content: "E" };
		const chunks = await run(
			[
				created,
				{ type: "response.reasoning_summary_text.delta", output_index: 0, delta: "why" },
				{ type: "response.output_item.done", output_index: 0, item },
				{ type: "response.output_text.delta", output_index: 1, delta: "t" },
				{ type: "response.output_item.done", output_index: 2, item: { type: "reasoning", encrypted_content: "F" } },
				{ type: "response.output_item.done", output_index: 3, item: { type: "reasoning" } },
				done()
			],
			undefined,
			{ reasoningRoundTrip: true }
		);
		const all = deltas(chunks).map((choice) => choice.delta);
		expect(all.filter((delta) => delta.reasoning !== undefined)).toEqual([{ reasoning: "why" }]);
		expect(all.filter((delta) => delta.reasoning_details).map((delta) => delta.reasoning_details[0].index)).toEqual([0, 1]);
		const off = await run([created, { type: "response.output_item.done", output_index: 0, item }, done()]);
		expect(deltas(off).some((choice) => choice.delta.reasoning_details)).toBe(false);
	});

	test("failures and early ends become error chunks and [DONE]", async () => {
		const failed = await run([created, { type: "response.failed", response: { error: { code: "bad", message: "boom" } } }]);
		expect(failed.slice(-2)).toEqual([{ error: { message: "boom", type: "server_error", param: null, code: "upstream_bad" } }, "[DONE]"]);
		const bare = await run([{ type: "response.failed" }]);
		expect(bare[0].error.message).toMatch(/status "failed"/);
		const errored = await run([{ type: "error", message: "slow", code: "rate" }]);
		expect(errored[0].error).toMatchObject({ message: "slow", code: "rate" });
		expect((await run([{ type: "error" }]))[0].error).toMatchObject({ message: "Upstream error", code: null });
		const cut = await run([created]);
		expect(cut.at(-2).error.message).toBe("Upstream stream ended before completion");
		const marked = await run([created, "[DONE]"].map((entry) => (entry === "[DONE]" ? { data: "[DONE]" } : entry)));
		expect(marked.at(-2).error.message).toBe("Upstream stream ended before completion");
	});

	test("a stream that breaks becomes an error chunk", async () => {
		const broken = (async function* () {
			yield { type: "response.created", response: { id: "r" } };
			throw new Error("socket closed");
		})();
		const chunks = (await collect(stream(broken))).map((entry) => entry.data);
		expect(chunks.at(-2).error.message).toBe("socket closed");
		expect(chunks.at(-1)).toBe("[DONE]");
	});
});

describe("leaves", () => {
	test("the Chat Completions leaves wrap the library converters", async () => {
		expect(chatReply(out([text("x")])).choices[0].message.content).toBe("x");
		expect((await collect(chatStream([created, done()]))).at(-1).data).toBe("[DONE]");
	});
});

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/ollama.test.vitest.mjs
 *	@Date: 2026-11-13T11:00:00-08:00 (1794596400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-13T11:00:00-08:00 (1794596400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Ollama native protocol helpers: the request body, the reply, the finish reason and usage, and the stream chunker (generated tool-call ids, numbering, errors).
 */
import { describe, expect, it } from "vitest";
import { PROTOCOL, callsOfReply, chatBody, completion, createChunker, errorOf, finishOf, folded, usageOf } from "../../src/lib/ollama.mjs";

const png = "data:image/png;base64,AAAA";

describe("chatBody", () => {
	it("converts messages: roles, text parts, base64 images, tool calls with object arguments, tool results by name, thinking", () => {
		const dropped = [];
		const out = chatBody(
			{
				model: "m",
				messages: [
					{ role: "developer", content: "be brief" },
					{
						role: "user",
						content: [
							{ type: "text", text: "look" },
							{ type: "image_url", image_url: { url: png } },
							{ type: "text", text: "now" }
						]
					},
					{
						role: "assistant",
						content: null,
						reasoning_content: "need the file",
						tool_calls: [
							{ id: "call_a", type: "function", function: { name: "Read", arguments: '{"path":"/a"}' } },
							{ id: "call_b", type: "function", function: { name: "Bash", arguments: "not json" } },
							{ type: "function", function: { name: "Noid", arguments: "" } }
						]
					},
					{ role: "tool", tool_call_id: "call_a", content: [{ type: "text", text: "body" }] },
					{ role: "tool", tool_call_id: "missing", name: "Named", content: "x" },
					{ role: "tool", tool_call_id: "missing", content: "y" },
					{ role: "assistant", content: "done" }
				]
			},
			{ dropped }
		);
		expect(out.stream).toBe(false);
		expect(out.messages).toEqual([
			{ role: "system", content: "be brief" },
			{ role: "user", content: "look\nnow", images: ["AAAA"] },
			{
				role: "assistant",
				content: "",
				thinking: "need the file",
				tool_calls: [
					{ type: "function", function: { name: "Read", arguments: { path: "/a" } } },
					{ type: "function", function: { name: "Bash", arguments: { _raw_arguments: "not json" } } },
					{ type: "function", function: { name: "Noid", arguments: {} } }
				]
			},
			{ role: "tool", tool_name: "Read", content: "body" },
			{ role: "tool", tool_name: "Named", content: "x" },
			{ role: "tool", content: "y" },
			{ role: "assistant", content: "done" }
		]);
		expect(dropped).toEqual([]);
	});

	it("replaces an image given by URL with a note, and names parts it cannot send", () => {
		const dropped = [];
		const out = chatBody(
			{
				model: "m",
				messages: [
					{
						role: "user",
						content: [
							{ type: "image_url", image_url: { url: "https://x.test/a.png" } },
							{ type: "image_url", image_url: "plain" },
							{ type: "input_audio" },
							{},
							null
						]
					}
				]
			},
			{ dropped }
		);
		expect(out.messages[0].content).toMatch(/^\[An image was omitted/);
		expect(out.messages[0]).not.toHaveProperty("images");
		expect(dropped).toEqual(["image_url", "content.input_audio", "content.part"]);
		expect(
			chatBody({ model: "m", messages: [{ role: "user", content: [{ type: "image_url", image_url: png }] }] }).messages[0].images
		).toEqual(["AAAA"]);
	});

	it("tolerates odd messages and works without a context", () => {
		expect(chatBody({ model: "m" }).messages).toEqual([]);
		expect(chatBody({ model: "m", messages: [null, { role: "user" }] }).messages).toEqual([
			{ role: undefined, content: "" },
			{ role: "user", content: "" }
		]);
	});

	it("maps tools and tool_choice: none removes the tools, auto is silent, anything else is named", () => {
		const tools = [
			{ type: "function", function: { name: "Read", description: "read", parameters: { type: "object", properties: {} }, strict: true } },
			{ type: "function", function: { name: "Bare" } }
		];
		const base = { model: "m", messages: [] };
		const out = chatBody({ ...base, tools, tool_choice: "auto" });
		expect(out.tools).toEqual([
			{ type: "function", function: { name: "Read", description: "read", parameters: { type: "object", properties: {} } } },
			{ type: "function", function: { name: "Bare", description: undefined, parameters: { type: "object", properties: {} } } }
		]);
		expect(out).not.toHaveProperty("tool_choice");
		for (const choice of ["required", { type: "function", function: { name: "Read" } }]) {
			const dropped = [];
			expect(chatBody({ ...base, tools, tool_choice: choice }, { dropped }).tools).toHaveLength(2);
			expect(dropped).toEqual(["tool_choice"]);
		}
		const none = [];
		expect(chatBody({ ...base, tools, tool_choice: "none" }, { dropped: none })).not.toHaveProperty("tools");
		expect(none).toEqual(["tools"]);
		const nothing = [];
		expect(chatBody({ ...base, tool_choice: "none" }, { dropped: nothing })).not.toHaveProperty("tools");
		expect(nothing).toEqual([]);
		expect(chatBody({ ...base, tools: [] })).not.toHaveProperty("tools");
	});

	it("puts the output cap and the sampling fields in options", () => {
		const out = chatBody({
			model: "m",
			messages: [],
			max_completion_tokens: 50,
			max_tokens: 99,
			temperature: 0.2,
			top_p: 0.9,
			top_k: 40,
			min_p: 0.05,
			seed: 7,
			frequency_penalty: 0.1,
			presence_penalty: 0.2,
			repetition_penalty: 1.1,
			stop: "END"
		});
		expect(out.options).toEqual({
			temperature: 0.2,
			top_p: 0.9,
			top_k: 40,
			min_p: 0.05,
			seed: 7,
			frequency_penalty: 0.1,
			presence_penalty: 0.2,
			repeat_penalty: 1.1,
			num_predict: 50,
			stop: ["END"]
		});
		expect(chatBody({ model: "m", messages: [], max_tokens: 9, stop: ["a", "b"] }).options).toEqual({ num_predict: 9, stop: ["a", "b"] });
		expect(chatBody({ model: "m", messages: [], temperature: null, stop: null, max_tokens: null })).not.toHaveProperty("options");
	});

	it("merges extension sampling, then the request's fields, then the client's own options", () => {
		const out = chatBody(
			{ model: "m", messages: [], temperature: 0.5, options: { num_ctx: 8192, temperature: 0.1 } },
			{ sampling: { temperature: 1, repetition_penalty: 1.3, mirostat: 2 } }
		);
		expect(out.options).toEqual({ temperature: 0.1, repeat_penalty: 1.3, mirostat: 2, num_ctx: 8192 });
		expect(chatBody({ model: "m", messages: [], options: "no" }).options).toBeUndefined();
	});

	it("turns response_format into format", () => {
		const base = { model: "m", messages: [] };
		const schema = { type: "object", properties: { a: { type: "string" } } };
		expect(chatBody({ ...base, response_format: { type: "json_object" } }).format).toBe("json");
		expect(chatBody({ ...base, response_format: { type: "json_schema", json_schema: { name: "x", schema } } }).format).toEqual(schema);
		expect(chatBody({ ...base, response_format: { type: "json_schema", json_schema: { name: "x" } } })).not.toHaveProperty("format");
		expect(chatBody({ ...base, response_format: { type: "text" } })).not.toHaveProperty("format");
		expect(chatBody({ ...base, response_format: { type: "json_object" }, format: schema }).format).toEqual(schema);
	});

	it("turns effort and the thinking switch into think", () => {
		const base = { model: "m", messages: [] };
		const cases = [
			["none", false],
			["minimal", "low"],
			["low", "low"],
			["medium", "medium"],
			["high", "high"],
			["xhigh", "high"],
			["max", "max"],
			["custom", "custom"]
		];
		for (const [effort, think] of cases) expect(chatBody({ ...base, reasoning_effort: effort }).think).toBe(think);
		expect(chatBody({ ...base, think: "low" }).think).toBe("low");
		expect(chatBody({ ...base, think: false }).think).toBe(false);
		expect(chatBody({ ...base, reasoning_effort: "high", think: false }).think).toBe("high");
		expect(chatBody({ ...base, chat_template_kwargs: { enable_thinking: true } }).think).toBe(true);
		expect(chatBody({ ...base, chat_template_kwargs: { enable_thinking: false } }).think).toBe(false);
		expect(chatBody({ ...base, chat_template_kwargs: { other: 1 } })).not.toHaveProperty("think");
		expect(chatBody(base)).not.toHaveProperty("think");
	});

	it("sets stream, keeps keep_alive, and names the fields it leaves out", () => {
		const dropped = [];
		const out = chatBody(
			{
				model: "m",
				messages: [],
				stream: true,
				keep_alive: "10m",
				n: 2,
				logit_bias: { 1: 2 },
				logprobs: true,
				stream_options: { include_usage: true },
				user: "u",
				metadata: {},
				store: false,
				service_tier: "auto",
				parallel_tool_calls: false
			},
			{ dropped }
		);
		expect(out).toMatchObject({ stream: true, keep_alive: "10m" });
		expect(dropped).toEqual(["n", "logit_bias", "logprobs", "parallel_tool_calls"]);
		const one = [];
		chatBody({ model: "m", messages: [], n: 1 }, { dropped: one });
		expect(one).toEqual([]);
	});
});

describe("reply helpers", () => {
	it("generates a tool-call id per call unless the server sent one, and numbers the calls", () => {
		const calls = callsOfReply(
			[
				{ function: { name: "A", arguments: { x: 1 } } },
				{ id: "srv_1", function: { name: "B", arguments: '{"y":2}' } },
				{ id: "", function: { name: "C" } }
			],
			3
		);
		expect(calls.map((call) => call.index)).toEqual([3, 4, 5]);
		expect(calls[0].id).toMatch(/^call_[0-9a-f]+$/);
		expect(calls[1].id).toBe("srv_1");
		expect(calls[2].id).toMatch(/^call_/);
		expect(new Set(calls.map((call) => call.id)).size).toBe(3);
		expect(calls.map((call) => call.function.arguments)).toEqual(['{"x":1}', '{"y":2}', "{}"]);
		expect(callsOfReply(undefined)).toEqual([]);
		expect(callsOfReply([null])[0].function).toEqual({ name: undefined, arguments: "{}" });
	});

	it("maps done_reason to finish_reason", () => {
		expect(finishOf({ done_reason: "stop" }, false)).toBe("stop");
		expect(finishOf({ done_reason: "length" }, false)).toBe("length");
		expect(finishOf({ done_reason: "load" }, false)).toBe("stop");
		expect(finishOf({ done_reason: "length" }, true)).toBe("tool_calls");
		expect(finishOf(undefined, false)).toBe("stop");
	});

	it("builds usage from the evaluation counts", () => {
		expect(usageOf({ prompt_eval_count: 10, eval_count: 4 })).toEqual({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 });
		expect(usageOf({ eval_count: 4 })).toEqual({ prompt_tokens: 0, completion_tokens: 4, total_tokens: 4 });
		expect(usageOf({ prompt_eval_count: 3 })).toEqual({ prompt_tokens: 3, completion_tokens: 0, total_tokens: 3 });
		expect(usageOf({})).toBeUndefined();
		expect(usageOf(undefined)).toBeUndefined();
		expect(folded({ prompt_tokens: 3, completion_tokens: 2 })).toEqual({ input_tokens: 3, output_tokens: 2 });
		expect(folded(undefined)).toBeUndefined();
		expect(errorOf({ error: "boom" })).toBe("boom");
		expect(errorOf({ error: { message: "x" } })).toBeNull();
		expect(errorOf(undefined)).toBeNull();
		expect(PROTOCOL).toBe("ollama.chat");
	});
});

describe("completion", () => {
	it("converts a reply with thinking, tool calls, finish reason and usage", () => {
		const out = completion(
			{
				model: "qwen3",
				created_at: "2026-11-13T10:00:00.5Z",
				message: {
					role: "assistant",
					content: "ok",
					thinking: "hm",
					tool_calls: [{ function: { name: "Read", arguments: { path: "/a" } } }]
				},
				done: true,
				done_reason: "stop",
				prompt_eval_count: 7,
				eval_count: 3
			},
			{ reasoningField: "reasoning_content" }
		);
		expect(out).toMatchObject({
			object: "chat.completion",
			created: 1794564000,
			model: "qwen3",
			usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
			choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: "ok", reasoning_content: "hm" } }]
		});
		expect(out.id).toMatch(/^chatcmpl-/);
		const [call] = out.choices[0].message.tool_calls;
		expect(call).toEqual({ id: expect.stringMatching(/^call_/), type: "function", function: { name: "Read", arguments: '{"path":"/a"}' } });
	});

	it("handles a bare reply: no message, no usage, no date", () => {
		const out = completion({ model: "m", done: true });
		expect(out.choices[0]).toMatchObject({ finish_reason: "stop", message: { role: "assistant", content: "" } });
		expect(out).not.toHaveProperty("usage");
		expect(out.created).toBeGreaterThan(1700000000);
		expect(completion(undefined).choices[0].message.content).toBe("");
		expect(completion({ message: { content: 5, thinking: "" } }).choices[0].message).toEqual({ role: "assistant", content: "" });
		expect(completion({ message: { thinking: "t" } }).choices[0].message.reasoning).toBe("t");
	});

	it("throws an upstream error for an error reply", () => {
		expect(() => completion({ error: "model not found" })).toThrow(
			expect.objectContaining({ message: "model not found", code: "upstream_error", status: 502 })
		);
	});
});

describe("createChunker", () => {
	const line = (message, extra = {}) => ({
		model: "m",
		created_at: "2026-11-13T10:00:00Z",
		message: { role: "assistant", ...message },
		done: false,
		...extra
	});
	const done = (extra = {}) => ({
		model: "m",
		message: { role: "assistant", content: "" },
		done: true,
		done_reason: "stop",
		prompt_eval_count: 5,
		eval_count: 2,
		...extra
	});

	it("sends one role chunk, then deltas with one id, then the finish and usage chunks", () => {
		const chunker = createChunker();
		const out = [
			...chunker.line(line({ thinking: "hm" })),
			...chunker.line(line({ content: "" })),
			...chunker.line(line({ content: "Hel" })),
			...chunker.line(line({ content: "lo" })),
			...chunker.line(done())
		];
		expect(new Set(out.map((chunk) => chunk.id)).size).toBe(1);
		expect(out.map((chunk) => chunk.choices[0]?.delta)).toEqual([
			{ role: "assistant", content: "" },
			{ reasoning: "hm" },
			{ content: "Hel" },
			{ content: "lo" },
			{},
			undefined
		]);
		expect(out.at(-2).choices[0].finish_reason).toBe("stop");
		expect(out.at(-1)).toMatchObject({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } });
		expect(chunker.finished()).toBe(true);
		expect(chunker.usage()).toEqual({ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 });
	});

	it("numbers tool calls across lines with a generated id each, and finishes with tool_calls", () => {
		const chunker = createChunker({ model: "client-model", reasoningField: "reasoning_content" });
		const first = chunker.line(line({ thinking: "t", tool_calls: [{ function: { name: "A", arguments: { x: 1 } } }] }));
		const second = chunker.line(
			line({ tool_calls: [{ function: { name: "B", arguments: {} } }, { function: { name: "C", arguments: {} } }] })
		);
		const end = chunker.line(done({ message: { role: "assistant", content: "" } }));
		const calls = [...first, ...second].flatMap((chunk) => chunk.choices[0]?.delta.tool_calls ?? []);
		expect(calls.map((call) => call.index)).toEqual([0, 1, 2]);
		expect(new Set(calls.map((call) => call.id)).size).toBe(3);
		expect(calls[0].function).toEqual({ name: "A", arguments: '{"x":1}' });
		expect(first[1].choices[0].delta).toMatchObject({ reasoning_content: "t" });
		expect(first.every((chunk) => chunk.model === "client-model")).toBe(true);
		expect(end[0].choices[0].finish_reason).toBe("tool_calls");
	});

	it("leaves out the usage chunk when asked or when the final line has no counts", () => {
		const quiet = createChunker({ includeUsage: false });
		expect(quiet.line(done())).toHaveLength(2);
		expect(quiet.usage()).toBeDefined();
		const none = createChunker();
		expect(none.line(done({ prompt_eval_count: undefined, eval_count: undefined }))).toHaveLength(2);
		expect(none.usage()).toBeUndefined();
	});

	it("takes the model name from the lines and handles sparse lines", () => {
		const chunker = createChunker();
		const [first] = chunker.line({ done: false });
		expect(first.model).toBeUndefined();
		const [content] = chunker.line({ model: "named", message: { content: "x" } });
		expect(content.model).toBe("named");
		expect(chunker.line(undefined)).toEqual([]);
		expect(chunker.finished()).toBe(false);
	});

	it("turns an error line into an error chunk and finishes", () => {
		const chunker = createChunker();
		expect(chunker.line({ error: "model runner stopped" })).toEqual([
			{ error: { message: "model runner stopped", type: "api_error", param: null, code: null } }
		]);
		expect(chunker.finished()).toBe(true);
	});
});

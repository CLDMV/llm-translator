/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/cohere.test.vitest.mjs
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
 * @fileoverview Cohere v2 chat as Chat Completions: the request body (messages, tools, tool choice, sampling, response format, thinking), the reply, the finish reasons and failures, usage, and the stream chunker.
 */
import { describe, expect, it } from "vitest";
import { chatBody, completion, createChunker, failureOf, finishOf, folded, rootOf, usageOf } from "../../src/lib/cohere.mjs";

const tool = (name, extra = {}) => ({ type: "function", function: { name, parameters: { type: "object" }, ...extra } });
const user = [{ role: "user", content: "hi" }];

describe("rootOf", () => {
	it("removes the Compatibility API's path root and nothing else", () => {
		expect(rootOf("https://api.cohere.com/compatibility")).toBe("https://api.cohere.com");
		expect(rootOf("https://api.cohere.com")).toBe("https://api.cohere.com");
	});
});

describe("chatBody messages", () => {
	it("keeps system text, user text and images, and names parts it cannot send", () => {
		const dropped = [];
		const out = chatBody(
			{
				model: "m",
				messages: [
					{ role: "system", content: "be brief" },
					{ role: "developer", content: [{ type: "text", text: "a" }, { type: "audio" }, null] },
					{ role: "system", content: "" },
					{
						role: "user",
						content: [
							{ type: "text", text: "look" },
							{ type: "text", text: "" },
							{ type: "text", text: 4 },
							{ type: "image_url", image_url: { url: "data:image/png;base64,AA", detail: "low" } },
							{ type: "image_url", image_url: "https://a.test/x.png" },
							{ type: "input_audio" },
							null
						]
					},
					{ role: "user", content: "" },
					{ role: "user", content: [] },
					{ role: "user" },
					{ role: "critic", content: "x" },
					{ content: "no role" }
				]
			},
			{ dropped }
		);
		expect(out.messages).toEqual([
			{ role: "system", content: "be brief" },
			{ role: "system", content: "a" },
			{
				role: "user",
				content: [
					{ type: "text", text: "look" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,AA", detail: "low" } },
					{ type: "image_url", image_url: { url: "https://a.test/x.png" } }
				]
			}
		]);
		expect(dropped).toEqual(["content.audio", "content.part", "content.input_audio", "messages.critic", "messages.undefined"]);
		expect(chatBody({ model: "m", messages: user }, {}).messages).toEqual([{ role: "user", content: [{ type: "text", text: "hi" }] }]);
	});

	it("sends an assistant turn as text, with its reasoning as a thinking block, and its tool calls with JSON text arguments", () => {
		const out = chatBody({
			model: "m",
			messages: [
				{ role: "assistant", content: "plain" },
				{ role: "assistant", content: "answer", reasoning: "think" },
				{ role: "assistant", content: "", reasoning_content: "only" },
				{
					role: "assistant",
					content: null,
					tool_calls: [
						{ id: "a", type: "function", function: { name: "f", arguments: '{"x":1}' } },
						{ id: "b", type: "function", function: { name: "g", arguments: "" } },
						{ id: "c", type: "function", function: { name: "h", arguments: { y: 2 } } },
						{ id: "d", type: "function", function: { name: "i" } }
					]
				},
				{ role: "assistant", content: "" },
				{ role: "assistant", content: [{ type: "text", text: "blocks" }] }
			]
		});
		expect(out.messages).toEqual([
			{ role: "assistant", content: "plain" },
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "think" },
					{ type: "text", text: "answer" }
				]
			},
			{ role: "assistant", content: [{ type: "thinking", thinking: "only" }] },
			{
				role: "assistant",
				tool_calls: [
					{ id: "a", type: "function", function: { name: "f", arguments: '{"x":1}' } },
					{ id: "b", type: "function", function: { name: "g", arguments: "{}" } },
					{ id: "c", type: "function", function: { name: "h", arguments: '{"y":2}' } },
					{ id: "d", type: "function", function: { name: "i", arguments: "{}" } }
				]
			},
			{ role: "assistant", content: "blocks" }
		]);
	});

	it("sends a tool result as text under its call id, never empty", () => {
		const dropped = [];
		const out = chatBody(
			{
				model: "m",
				messages: [
					{ role: "tool", tool_call_id: "a", content: "result" },
					{ role: "tool", tool_call_id: "b", content: "" },
					{ role: "tool", tool_call_id: "c", content: [{ type: "text", text: "x" }, { type: "image_url" }] }
				]
			},
			{ dropped }
		);
		expect(out.messages).toEqual([
			{ role: "tool", tool_call_id: "a", content: "result" },
			{ role: "tool", tool_call_id: "b", content: "(no output)" },
			{ role: "tool", tool_call_id: "c", content: "x" }
		]);
		expect(dropped).toEqual(["content.image_url"]);
	});

	it("has no messages for a body without any", () => {
		expect(chatBody({ model: "m" }).messages).toEqual([]);
		expect(chatBody({ model: "m", messages: [], stream: true })).toMatchObject({ stream: true });
	});
});

describe("chatBody tools and sampling", () => {
	it("sends tools with their schema and requires a call for `required`, forbids it for `none`", () => {
		const tools = [tool("a", { description: "d", strict: true }), { type: "function", function: { name: "b" } }];
		const out = chatBody({ model: "m", messages: user, tools, tool_choice: "required" });
		expect(out.tools).toEqual([
			{ type: "function", function: { name: "a", description: "d", parameters: { type: "object" } } },
			{ type: "function", function: { name: "b", parameters: { type: "object", properties: {} } } }
		]);
		expect(out).toMatchObject({ tool_choice: "REQUIRED", strict_tools: true });
		expect(chatBody({ model: "m", messages: user, tools, tool_choice: "none" }).tool_choice).toBe("NONE");
		expect(chatBody({ model: "m", messages: user, tools: [tool("a")] })).not.toHaveProperty("strict_tools");
	});

	it("forces a named tool only when it is the only one, and names the choice it cannot send", () => {
		const named = { type: "function", function: { name: "a" } };
		expect(chatBody({ model: "m", messages: user, tools: [tool("a")], tool_choice: named }).tool_choice).toBe("REQUIRED");
		const dropped = [];
		const two = chatBody({ model: "m", messages: user, tools: [tool("a"), tool("b")], tool_choice: named }, { dropped });
		expect(two).not.toHaveProperty("tool_choice");
		chatBody({ model: "m", messages: user, tools: [tool("a")], tool_choice: { type: "allowed_tools" } }, { dropped });
		expect(dropped).toEqual(["tool_choice"]);
		const auto = [];
		expect(chatBody({ model: "m", messages: user, tools: [tool("a")], tool_choice: "auto" }, { dropped: auto })).not.toHaveProperty(
			"tool_choice"
		);
		expect(auto).toEqual([]);
		expect(chatBody({ model: "m", messages: user, tool_choice: "required" })).not.toHaveProperty("tool_choice");
	});

	it("maps the sampling fields to Cohere's names and lets the request override the extension fields", () => {
		const out = chatBody(
			{
				model: "m",
				messages: user,
				max_completion_tokens: 50,
				max_tokens: 60,
				temperature: 0.2,
				top_p: 0.9,
				top_k: 40,
				seed: 7,
				frequency_penalty: 0.1,
				presence_penalty: 0.2,
				stop: "END"
			},
			{ sampling: { safety_mode: "STRICT", temperature: 1 } }
		);
		expect(out).toEqual({
			safety_mode: "STRICT",
			model: "m",
			stream: false,
			messages: out.messages,
			max_tokens: 50,
			temperature: 0.2,
			p: 0.9,
			k: 40,
			seed: 7,
			frequency_penalty: 0.1,
			presence_penalty: 0.2,
			stop_sequences: ["END"]
		});
		expect(chatBody({ model: "m", messages: user, max_tokens: 9, stop: ["a", "b"] })).toMatchObject({
			max_tokens: 9,
			stop_sequences: ["a", "b"]
		});
		const nulls = chatBody({
			model: "m",
			messages: user,
			max_tokens: null,
			temperature: null,
			top_p: null,
			top_k: null,
			seed: null,
			frequency_penalty: null,
			presence_penalty: null,
			stop: null
		});
		expect(Object.keys(nulls).sort()).toEqual(["messages", "model", "stream"]);
	});

	it("maps response_format, and leaves it out (named) when tools are offered", () => {
		const schema = { type: "object", properties: { a: { type: "string" } } };
		expect(chatBody({ model: "m", messages: user, response_format: { type: "json_object" } }).response_format).toEqual({
			type: "json_object"
		});
		expect(
			chatBody({ model: "m", messages: user, response_format: { type: "json_schema", json_schema: { name: "n", schema } } }).response_format
		).toEqual({ type: "json_object", json_schema: schema });
		expect(chatBody({ model: "m", messages: user, response_format: { type: "text" } })).not.toHaveProperty("response_format");
		expect(chatBody({ model: "m", messages: user, response_format: { type: "json_schema", json_schema: {} } })).not.toHaveProperty(
			"response_format"
		);
		const dropped = [];
		const out = chatBody({ model: "m", messages: user, tools: [tool("a")], response_format: { type: "json_object" } }, { dropped });
		expect(out).not.toHaveProperty("response_format");
		expect(dropped).toEqual(["response_format"]);
	});

	it("sets thinking from the Anthropic request's mode and budget, else from the reasoning effort", () => {
		const base = { model: "m", messages: user };
		expect(chatBody(base, { thinking: "disabled" }).thinking).toEqual({ type: "disabled" });
		expect(chatBody(base, { thinking: "enabled", thinkingBudget: 2048 }).thinking).toEqual({ type: "enabled", token_budget: 2048 });
		expect(chatBody(base, { thinking: "enabled" }).thinking).toEqual({ type: "enabled" });
		expect(chatBody({ ...base, reasoning_effort: "none" }, { thinking: "adaptive" }).thinking).toEqual({ type: "disabled" });
		expect(chatBody({ ...base, reasoning_effort: "high" }).thinking).toEqual({ type: "enabled" });
		expect(chatBody(base, { thinking: "adaptive" })).not.toHaveProperty("thinking");
		expect(chatBody(base)).not.toHaveProperty("thinking");
	});

	it("names what Cohere has no field for, once, and stays quiet about fields that mean nothing to it", () => {
		const dropped = [];
		chatBody(
			{
				model: "m",
				messages: user,
				n: 2,
				logit_bias: {},
				parallel_tool_calls: true,
				user: "u",
				metadata: {},
				store: true,
				stream_options: {},
				service_tier: "x"
			},
			{ dropped }
		);
		expect(dropped).toEqual(["n", "logit_bias", "parallel_tool_calls"]);
		const quiet = [];
		chatBody({ model: "m", messages: user, n: 1 }, { dropped: quiet });
		expect(quiet).toEqual([]);
	});
});

describe("finish reasons, failures and usage", () => {
	it("maps the finish reasons, and a reply that called tools is tool_calls", () => {
		expect(finishOf("COMPLETE", false)).toBe("stop");
		expect(finishOf("STOP_SEQUENCE", false)).toBe("stop");
		expect(finishOf("MAX_TOKENS", false)).toBe("length");
		expect(finishOf("MAX_TOKENS", true)).toBe("length");
		expect(finishOf("TOOL_CALL", false)).toBe("tool_calls");
		expect(finishOf("COMPLETE", true)).toBe("tool_calls");
		expect(finishOf(undefined, false)).toBe("stop");
		expect(finishOf("toString", false)).toBe("stop");
	});

	it("turns ERROR, TIMEOUT and an error message into translator errors", () => {
		expect(failureOf("TIMEOUT")).toMatchObject({ status: 504, code: "upstream_timeout" });
		expect(failureOf("ERROR")).toMatchObject({ status: 502, code: "upstream_error", message: "Upstream generation failed" });
		expect(failureOf("COMPLETE", "boom")).toMatchObject({ status: 502, message: "boom" });
		expect(failureOf("COMPLETE", { code: 1 })).toMatchObject({ message: "Upstream generation failed" });
		expect(failureOf("COMPLETE", "")).toMatchObject({ message: "Upstream generation failed" });
		expect(failureOf("COMPLETE")).toBeNull();
		expect(failureOf("COMPLETE", null)).toBeNull();
	});

	it("counts the model's tokens, falls back to the billed ones, and has nothing for neither", () => {
		const tokens = { input_tokens: 71, output_tokens: 26 };
		const billed = { input_tokens: 5, output_tokens: 3 };
		expect(usageOf({ tokens, billed_units: billed })).toEqual({ prompt_tokens: 71, completion_tokens: 26, total_tokens: 97 });
		expect(usageOf({ billed_units: billed })).toEqual({ prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 });
		expect(usageOf({ tokens: { output_tokens: 4 } })).toEqual({ prompt_tokens: 0, completion_tokens: 4, total_tokens: 4 });
		expect(usageOf({ tokens: { input_tokens: 4 } })).toEqual({ prompt_tokens: 4, completion_tokens: 0, total_tokens: 4 });
		expect(usageOf({ tokens: {}, billed_units: {} })).toBeUndefined();
		expect(usageOf(undefined)).toBeUndefined();
		expect(folded({ tokens })).toEqual({ input_tokens: 71, output_tokens: 26 });
		expect(folded({})).toBeUndefined();
	});
});

describe("completion", () => {
	it("reads text, thinking, tool calls, the finish reason and the usage", () => {
		const out = completion(
			{
				finish_reason: "TOOL_CALL",
				message: {
					role: "assistant",
					tool_plan: "I will look.",
					content: [{ type: "thinking", thinking: "hm" }, { type: "text", text: "so " }, { type: "text", text: "far" }, null],
					tool_calls: [
						{ id: "t1", type: "function", function: { name: "Read", arguments: '{"p":1}' } },
						{ id: "t2", type: "function", function: { name: "Ls" } },
						null
					]
				},
				usage: { tokens: { input_tokens: 3, output_tokens: 2 } }
			},
			{ model: "asked", reasoningField: "reasoning_content" }
		);
		expect(out).toMatchObject({
			object: "chat.completion",
			model: "asked",
			usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
			choices: [
				{
					finish_reason: "tool_calls",
					message: {
						role: "assistant",
						content: "so far",
						reasoning_content: "hm",
						tool_calls: [
							{ id: "t1", type: "function", function: { name: "Read", arguments: '{"p":1}' } },
							{ id: "t2", type: "function", function: { name: "Ls", arguments: "{}" } },
							{ type: "function", function: { arguments: "{}" } }
						]
					}
				}
			]
		});
		expect(out.choices[0].message).not.toHaveProperty("tool_plan");
	});

	it("reads a plain reply, with the default reasoning field, and none of the optional parts", () => {
		const out = completion({
			finish_reason: "MAX_TOKENS",
			message: {
				content: [
					{ type: "thinking", thinking: "t" },
					{ type: "text", text: "x" }
				]
			}
		});
		expect(out.choices[0]).toMatchObject({ finish_reason: "length", message: { content: "x", reasoning: "t" } });
		expect(out).not.toHaveProperty("usage");
		expect(completion({ message: {} }).choices[0].message).toEqual({ role: "assistant", content: "" });
	});

	it("throws for a reply with no message or one that ended in a failure", () => {
		expect(() => completion({})).toThrow(/no message/);
		expect(() => completion(null)).toThrow(/no message/);
		expect(() => completion({ message: "x" })).toThrow(/no message/);
		expect(() => completion({ finish_reason: "ERROR", message: { content: [] } })).toThrow(/failed/);
		expect(() => completion({ finish_reason: "TIMEOUT", message: { content: [] } })).toThrow(/timed out/);
	});
});

describe("createChunker", () => {
	const ev = (type, extra = {}) => ({ name: type, data: { type, ...extra } });
	const run = (chunker, list) => list.flatMap(({ name, data }) => chunker.event(name, data));
	const textDelta = (text) => ev("content-delta", { index: 0, delta: { message: { content: { text } } } });

	it("streams text and thinking under one id, and finishes with usage", () => {
		const chunker = createChunker({ model: "asked", reasoningField: "reasoning_content" });
		const chunks = run(chunker, [
			ev("message-start", { delta: { message: { role: "assistant" } } }),
			ev("content-start", { index: 0, delta: { message: { content: { type: "thinking", thinking: "" } } } }),
			ev("content-delta", { index: 0, delta: { message: { content: { thinking: "hm" } } } }),
			ev("content-end", { index: 0 }),
			ev("content-start", { index: 1 }),
			textDelta("hel"),
			textDelta(""),
			ev("content-delta", { index: 0, delta: { message: { content: {} } } }),
			ev("content-delta", { index: 0 }),
			ev("citation-start", { index: 0 }),
			ev("debug"),
			ev("tool-plan-delta", { delta: { message: { tool_plan: "I" } } }),
			ev("message-end", { delta: { finish_reason: "COMPLETE", usage: { tokens: { input_tokens: 4, output_tokens: 2 } } } })
		]);
		expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(1);
		expect(chunks.map((chunk) => chunk.choices[0]?.delta)).toEqual([
			{ role: "assistant", content: "" },
			{ reasoning_content: "hm" },
			{ content: "hel" },
			{},
			undefined
		]);
		expect(chunks[3].choices[0].finish_reason).toBe("stop");
		expect(chunks[4]).toMatchObject({ model: "asked", choices: [], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } });
		expect(chunker.finished()).toBe(true);
		expect(chunker.usage()).toEqual({ tokens: { input_tokens: 4, output_tokens: 2 } });
	});

	it("streams tool calls: the start carries the id and name, deltas carry the arguments", () => {
		const chunker = createChunker();
		const chunks = run(chunker, [
			ev("tool-call-start", {
				index: 0,
				delta: { message: { tool_calls: { id: "t1", type: "function", function: { name: "Read", arguments: "" } } } }
			}),
			ev("tool-call-delta", { index: 0, delta: { message: { tool_calls: { function: { arguments: '{"p"' } } } } }),
			ev("tool-call-delta", { index: 0, delta: { message: { tool_calls: { function: { arguments: "" } } } } }),
			ev("tool-call-delta", { index: 0 }),
			ev("tool-call-start", { index: 1 }),
			ev("tool-call-end", { index: 0 }),
			ev("message-end", { delta: { finish_reason: "TOOL_CALL" } })
		]);
		const deltas = chunks.map((chunk) => chunk.choices[0].delta);
		expect(deltas[0]).toEqual({ role: "assistant", content: "" });
		expect(deltas[1].tool_calls).toEqual([{ index: 0, id: "t1", type: "function", function: { name: "Read", arguments: "" } }]);
		expect(deltas[2].tool_calls).toEqual([{ index: 0, function: { arguments: '{"p"' } }]);
		expect(deltas[3].tool_calls[0]).toMatchObject({ index: 1, function: { arguments: "" } });
		expect(chunks.at(-1).choices[0].finish_reason).toBe("tool_calls");
		expect(chunks.some((chunk) => chunk.usage)).toBe(false);
	});

	it("leaves out the usage chunk when asked, and names the event from the SSE line when the data has no type", () => {
		const quiet = createChunker({ includeUsage: false });
		const chunks = run(quiet, [
			{ name: "content-delta", data: { index: 0, delta: { message: { content: { text: "x" } } } } },
			ev("message-end", { delta: { finish_reason: "MAX_TOKENS", usage: { billed_units: { input_tokens: 1, output_tokens: 1 } } } })
		]);
		expect(chunks.some((chunk) => chunk.usage)).toBe(false);
		expect(chunks.at(-1).choices[0].finish_reason).toBe("length");
		expect(createChunker().event("message-start", undefined)).toHaveLength(1);
	});

	it("ends in an error chunk for ERROR, TIMEOUT and an error message, and says nothing finished before then", () => {
		for (const [delta, message] of [
			[{ finish_reason: "ERROR" }, "Upstream generation failed"],
			[{ finish_reason: "TIMEOUT" }, "Upstream generation timed out"],
			[{ finish_reason: "COMPLETE", error: "boom" }, "boom"]
		]) {
			const chunker = createChunker();
			expect(chunker.finished()).toBe(false);
			expect(chunker.event("message-end", { type: "message-end", delta })).toEqual([
				{ error: { message, type: "api_error", param: null, code: null } }
			]);
			expect(chunker.finished()).toBe(true);
		}
		const bare = createChunker();
		expect(bare.event("message-end", undefined).at(-1).choices[0].finish_reason).toBe("stop");
	});
});

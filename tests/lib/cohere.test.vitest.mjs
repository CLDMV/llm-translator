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
import {
	chatBody,
	chunksOf,
	citationsOf,
	completion,
	createChunker,
	failureOf,
	finishOf,
	folded,
	logprobsOf,
	needsNative,
	promptText,
	rootOf,
	unmark,
	usageOf
} from "../../src/lib/cohere.mjs";
import { tag } from "../../src/lib/citations.mjs";

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

	it("forces a named tool by offering only that tool and requiring a call, and names a choice it cannot send", () => {
		const named = { type: "function", function: { name: "a" } };
		expect(chatBody({ model: "m", messages: user, tools: [tool("a")], tool_choice: named }).tool_choice).toBe("REQUIRED");
		const dropped = [];
		const two = chatBody({ model: "m", messages: user, tools: [tool("a"), tool("b")], tool_choice: named }, { dropped });
		expect(two).toMatchObject({ tool_choice: "REQUIRED" });
		expect(two.tools.map((entry) => entry.function.name)).toEqual(["a"]);
		const missing = chatBody(
			{ model: "m", messages: user, tools: [tool("a")], tool_choice: { type: "function", function: { name: "zzz" } } },
			{ dropped }
		);
		expect(missing).not.toHaveProperty("tool_choice");
		expect(missing.tools).toHaveLength(1);
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

	it("maps response_format, and asks for the JSON in a system instruction when tools or documents are offered", () => {
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
		const out = chatBody(
			{ model: "m", messages: [{ role: "system", content: "s" }, ...user], tools: [tool("a")], response_format: { type: "json_object" } },
			{ dropped }
		);
		expect(out).not.toHaveProperty("response_format");
		expect(out.messages.map((message) => message.role)).toEqual(["system", "system", "user"]);
		expect(out.messages[1].content).toMatch(/only a valid JSON object/);
		expect(dropped).toEqual([]);
		const withSchema = chatBody(
			{ model: "m", messages: user, tools: [tool("a")], response_format: { type: "json_schema", json_schema: { schema } } },
			{ dropped }
		);
		expect(withSchema.messages[0]).toEqual({ role: "system", content: expect.stringContaining(JSON.stringify(schema)) });
		const withDocuments = chatBody(
			{ model: "m", messages: user, documents: [{ id: "d", data: { text: "t" } }], response_format: { type: "json_object" } },
			{ dropped }
		);
		expect(withDocuments).not.toHaveProperty("response_format");
		expect(withDocuments.messages[0].role).toBe("system");
		const bare = chatBody({ model: "m", messages: [], tools: [tool("a")], response_format: { type: "json_object" } });
		expect(bare.messages).toHaveLength(1);
	});

	it("sets thinking from the Anthropic request's mode and budget, else from the reasoning effort", () => {
		const base = { model: "m", messages: user };
		expect(chatBody(base, { thinking: "disabled" }).thinking).toEqual({ type: "disabled" });
		expect(chatBody(base, { thinking: "enabled", thinkingBudget: 2048 }).thinking).toEqual({ type: "enabled", token_budget: 2048 });
		expect(chatBody(base, { thinking: "enabled" }).thinking).toEqual({ type: "enabled" });
		expect(chatBody({ ...base, reasoning_effort: "none" }, { thinking: "adaptive" }).thinking).toEqual({ type: "disabled" });
		expect(chatBody({ ...base, reasoning_effort: "high" }).thinking).toEqual({ type: "enabled", token_budget: 16384 });
		for (const [effort, budget] of Object.entries({ minimal: 1024, low: 2048, medium: 8192, xhigh: 24576, max: 31000 })) {
			expect(chatBody({ ...base, reasoning_effort: effort }).thinking).toEqual({ type: "enabled", token_budget: budget });
		}
		expect(chatBody({ ...base, reasoning_effort: "custom" }).thinking).toEqual({ type: "enabled" });
		expect(chatBody({ ...base, reasoning_effort: "low" }, { thinking: "enabled", thinkingBudget: 5000 }).thinking).toEqual({
			type: "enabled",
			token_budget: 2048
		});
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
				top_logprobs: 3,
				user: "u",
				metadata: {},
				store: true,
				stream_options: {},
				service_tier: "x"
			},
			{ dropped }
		);
		expect(dropped).toEqual(["n", "logit_bias", "top_logprobs"]);
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
		expect(folded({ tokens })).toEqual({ input_tokens: 71, output_tokens: 26, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
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
						content: "I will look.\n\nso far",
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
		expect(out.choices[0].message).not.toHaveProperty("annotations");
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
			{ content: "I" },
			{},
			undefined
		]);
		expect(chunks[4].choices[0].finish_reason).toBe("stop");
		expect(chunks[5]).toMatchObject({ model: "asked", choices: [], usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 } });
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

const part = (text, source) => (source === undefined ? { type: "text", text } : tag({ type: "text", text }, source));
const docSource = (index, extra = {}) => ({ kind: "document", index, title: `Doc ${index}`, citations: true, ...extra });
const resultSource = (index, extra = {}) => ({
	kind: "search_result",
	index,
	title: "S",
	source: "https://s.test",
	citations: true,
	blocks: 2,
	text: "body",
	...extra
});

describe("documents from request sources", () => {
	it("moves the sources that asked for citations out of a user message into documents, and keeps the rest", () => {
		const state = {};
		const out = chatBody(
			{
				model: "m",
				messages: [
					{
						role: "user",
						content: [
							part("<document>page one</document>", docSource(0)),
							part("page two", docSource(0)),
							part("[Search result: S (https://s.test)]\nbody", resultSource(1)),
							part("not cited", docSource(2, { citations: false })),
							{ type: "image_url", image_url: { url: "data:image/png;base64,AA" } },
							part("question?")
						]
					}
				]
			},
			{ state }
		);
		expect(out.documents).toEqual([
			{ id: "doc_0", data: { title: "Doc 0", text: "<document>page one</document>\n\npage two" } },
			{ id: "result_1", data: { title: "S", source: "https://s.test", text: "body" } }
		]);
		expect(out.messages).toEqual([
			{
				role: "user",
				content: [
					{ type: "text", text: "not cited" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,AA" } },
					{ type: "text", text: "question?" }
				]
			}
		]);
		expect(state.documents).toEqual({
			doc_0: { kind: "document", index: 0, title: "Doc 0", length: 39 },
			result_1: { kind: "search_result", index: 1, title: "S", source: "https://s.test", length: 4, blocks: 2 }
		});
	});

	it("leaves a user message that was only documents out, and untitled documents have no title", () => {
		const out = chatBody({
			model: "m",
			messages: [{ role: "user", content: [part("text", { kind: "document", index: 0, citations: true })] }, ...user]
		});
		expect(out.messages).toHaveLength(1);
		expect(out.documents).toEqual([{ id: "doc_0", data: { text: "text" } }]);
		const result = chatBody({
			model: "m",
			messages: [{ role: "user", content: [part("[Search result]", { kind: "search_result", index: 0, citations: true })] }]
		});
		expect(result.documents).toEqual([{ id: "result_0", data: { text: "[Search result]" } }]);
	});

	it("sends the sources of a tool result as document blocks, once each, with plain text as text blocks", () => {
		const state = {};
		const out = chatBody(
			{
				model: "m",
				messages: [
					{
						role: "tool",
						tool_call_id: "t1",
						content: [
							part("[Search result: S (u)]\nbody", resultSource(0)),
							part("more", resultSource(0)),
							part("note"),
							part(""),
							{ type: "image_url" }
						]
					},
					{ role: "tool", tool_call_id: "t2", content: [part("only", resultSource(1, { citations: false }))] },
					{ role: "tool", tool_call_id: "t3", content: [part("cited", docSource(2))] }
				]
			},
			{ state }
		);
		const [first, second, third] = out.messages;
		expect(first.content).toEqual([
			{ type: "document", document: { id: "result_0", data: { title: "S", source: "https://s.test", text: "body\n\nbody" } } },
			{ type: "text", text: "note" }
		]);
		expect(second.content).toBe("only");
		expect(third.content[0].document.id).toBe("doc_2");
		expect(out).not.toHaveProperty("documents");
		expect(state.tools).toEqual({ t1: 0, t2: 1, t3: 2 });
		expect(state.documents.result_0.length).toBe(10);
		expect(
			chatBody({
				model: "m",
				messages: [{ role: "tool", tool_call_id: "t", content: [{ type: "image_url" }, null, part("x", resultSource(0))] }]
			}).messages[0].content
		).toHaveLength(1);
	});

	it("sends documents a client gave on the body, with its own citation options and the other Cohere fields", () => {
		const out = chatBody({
			model: "m",
			messages: [{ role: "user", content: [part("cited", docSource(0))] }, ...user],
			documents: [{ id: "mine", data: { text: "t" } }, "plain"],
			citation_options: { mode: "FAST" },
			safety_mode: "STRICT",
			priority: 3,
			strict_tools: true
		});
		expect(out.documents.map((entry) => entry.id ?? entry)).toEqual(["mine", "plain", "doc_0"]);
		expect(out).toMatchObject({ citation_options: { mode: "FAST" }, safety_mode: "STRICT", priority: 3, strict_tools: true });
		expect(chatBody({ model: "m", messages: user, strict_tools: false, documents: "x" })).toMatchObject({ strict_tools: false });
		expect(chatBody({ model: "m", messages: user, documents: "x" })).not.toHaveProperty("documents");
	});
});

describe("tool plans, tool errors, parallel calls and logprobs", () => {
	it("sends the text of an assistant turn that has tool calls as its tool plan, with the reasoning still a thinking block", () => {
		const call = { id: "a", type: "function", function: { name: "f", arguments: "{}" } };
		const out = chatBody({
			model: "m",
			messages: [
				{ role: "assistant", content: "I will look.", tool_calls: [call] },
				{ role: "assistant", content: "I will look.", reasoning: "hm", tool_calls: [call] },
				{ role: "assistant", content: "", reasoning: "hm", tool_calls: [call] }
			]
		});
		expect(out.messages[0]).toEqual({ role: "assistant", tool_plan: "I will look.", tool_calls: [call] });
		expect(out.messages[1]).toEqual({
			role: "assistant",
			content: [{ type: "thinking", thinking: "hm" }],
			tool_plan: "I will look.",
			tool_calls: [call]
		});
		expect(out.messages[2]).toEqual({ role: "assistant", content: [{ type: "thinking", thinking: "hm" }], tool_calls: [call] });
	});

	it("sends a failed tool result as an error object, whether the marker is in the text or a lone first part", () => {
		const call = (content, marker = "[error] ") =>
			chatBody({ model: "m", messages: [{ role: "tool", tool_call_id: "t", content }] }, { marker }).messages[0].content;
		expect(call("[error] file missing")).toBe('{"error":"file missing"}');
		expect(call("[error] ")).toBe('{"error":"error"}');
		expect(call("fine")).toBe("fine");
		expect(chatBody({ model: "m", messages: [{ role: "tool", tool_call_id: "t", content: "[error] x" }] }).messages[0].content).toBe(
			"[error] x"
		);
		expect(
			call([
				{ type: "text", text: "[error]" },
				{ type: "text", text: "disk full" }
			])
		).toBe('{"error":"disk full"}');
		expect(call([{ type: "text", text: "[error]" }])).toBe('{"error":"error"}');
		expect(call([{ type: "text", text: "[error] " }])).toBe('{"error":"error"}');
		expect(call([{ type: "text", text: "plain" }])).toBe("plain");
	});

	it("keeps parallel_tool_calls: false on the state, and sends logprobs", () => {
		const state = {};
		const out = chatBody({ model: "m", messages: user, parallel_tool_calls: false, logprobs: true, top_logprobs: 2 }, { state });
		expect(state.singleCall).toBe(true);
		expect(out.logprobs).toBe(true);
		const dropped = [];
		chatBody({ model: "m", messages: user, parallel_tool_calls: false, logprobs: true, top_logprobs: 2 }, { dropped });
		expect(dropped).toEqual(["top_logprobs"]);
		const other = {};
		chatBody({ model: "m", messages: user, parallel_tool_calls: true, logprobs: false }, { state: other });
		expect(other).not.toHaveProperty("singleCall");
		expect(chatBody({ model: "m", messages: user, logprobs: false })).not.toHaveProperty("logprobs");
	});

	it("moves values into Cohere's ranges and says which moved", () => {
		const clamped = [];
		const out = chatBody(
			{
				model: "m",
				messages: user,
				temperature: -1,
				top_p: 1,
				top_k: 900.4,
				frequency_penalty: 1.5,
				presence_penalty: -0.5,
				stop: ["1", "2", "3", "4", "5", "6", "7"]
			},
			{ clamped }
		);
		expect(out).toMatchObject({
			temperature: 0,
			p: 0.99,
			k: 500,
			frequency_penalty: 1,
			presence_penalty: 0,
			stop_sequences: ["1", "2", "3", "4", "5"]
		});
		expect(clamped).toEqual(["temperature", "p", "k", "frequency_penalty", "presence_penalty", "stop_sequences"]);
		const fine = [];
		const kept = chatBody(
			{ model: "m", messages: user, temperature: 5, top_p: 0.5, top_k: 40, frequency_penalty: 0.2, stop: "x" },
			{ clamped: fine }
		);
		expect(kept).toMatchObject({ temperature: 5, p: 0.5, k: 40 });
		expect(fine).toEqual([]);
		expect(chatBody({ model: "m", messages: user, top_p: 0, top_k: 3.6 }, { clamped: fine })).toMatchObject({ p: 0.01, k: 4 });
		expect(chatBody({ model: "m", messages: user }, { sampling: { temperature: "hot" } }).temperature).toBe("hot");
	});
});

describe("needsNative", () => {
	it("is true for what only Cohere's own protocol has, from either front", () => {
		expect(needsNative({ model: "m", messages: [{ role: "user", content: "hi" }] })).toBe(false);
		expect(needsNative({ model: "m", reasoning_effort: "high" })).toBe(false);
		expect(needsNative({ reasoning_effort: "none" })).toBe(false);
		expect(needsNative({ reasoning_effort: "low" })).toBe(true);
		expect(needsNative({ output_config: { effort: "medium" } })).toBe(true);
		expect(needsNative({ thinking: { type: "enabled", budget_tokens: 2000 } })).toBe(true);
		expect(needsNative({ thinking: { type: "enabled" } })).toBe(false);
		expect(needsNative({ thinking: { type: "adaptive" } })).toBe(false);
		for (const key of ["documents", "citation_options", "safety_mode", "priority", "strict_tools", "logprobs"])
			expect(needsNative({ [key]: true })).toBe(true);
		expect(needsNative({ logprobs: false })).toBe(false);
		expect(needsNative({ tool_choice: "auto" })).toBe(false);
		expect(needsNative({ tool_choice: "required" })).toBe(true);
		expect(needsNative({ tool_choice: { type: "function", function: { name: "f" } } })).toBe(true);
		expect(needsNative({ tool_choice: { type: "auto" } })).toBe(false);
		expect(needsNative({ tool_choice: { type: "auto", disable_parallel_tool_use: true } })).toBe(true);
		expect(needsNative({ tool_choice: {} })).toBe(false);
		expect(needsNative({ parallel_tool_calls: false })).toBe(true);
		expect(needsNative({ parallel_tool_calls: true })).toBe(false);
		const tools = [{ type: "function", function: { name: "f" } }];
		expect(needsNative({ tools, response_format: { type: "json_object" } })).toBe(true);
		expect(needsNative({ tools, output_config: { format: {} } })).toBe(true);
		expect(needsNative({ tools })).toBe(false);
		expect(needsNative({ tools: [], response_format: {} })).toBe(false);
		expect(needsNative({ response_format: {} })).toBe(false);
		expect(needsNative(null)).toBe(false);
		expect(needsNative("x")).toBe(false);
	});

	it("is true for a document or search result that asks for citations, also inside a tool result", () => {
		const doc = (extra) => ({ type: "document", source: { type: "text" }, ...extra });
		const ask = (content) => needsNative({ messages: [{ role: "user", content }] });
		expect(ask([doc({ citations: { enabled: true } })])).toBe(true);
		expect(ask([doc({ citations: { enabled: false } })])).toBe(false);
		expect(ask([doc({})])).toBe(false);
		expect(ask([{ type: "search_result", citations: { enabled: true } }])).toBe(true);
		expect(ask([{ type: "tool_result", content: [{ type: "search_result", citations: { enabled: true } }] }])).toBe(true);
		expect(ask([{ type: "tool_result", content: "text" }, null])).toBe(false);
		expect(ask("plain")).toBe(false);
		expect(needsNative({ messages: [null, { role: "user", content: [doc({ citations: { enabled: true } })] }] })).toBe(true);
		expect(needsNative({ messages: "x" })).toBe(false);
	});
});

describe("cited replies", () => {
	const state = {
		documents: {
			doc_0: { kind: "document", index: 0, title: "Doc 0", length: 50 },
			result_1: { kind: "search_result", index: 1, title: "S", source: "https://s.test", length: 4, blocks: 2 }
		},
		tools: { call1: 3 }
	};

	it("names each source of a citation: a document, a search result, a tool result, or a document the client gave", () => {
		const found = citationsOf(
			{
				start: 2,
				end: 6,
				sources: [
					{ type: "document", id: "doc_0", document: { text: "quote" } },
					{ type: "document", id: "result_1", document: { snippet: "snip" } },
					{ type: "tool", id: "call1:2", tool_output: { a: 1 } },
					{ type: "tool", id: "call1", tool_output: { a: 1 } },
					{ type: "tool", id: "other:x" },
					{ type: "document", id: "mine", document: { title: "Mine", text: "t" } },
					{ type: "document", id: "bare" },
					null
				]
			},
			10,
			state
		);
		const span = { start: 12, end: 16 };
		expect(found).toEqual([
			{ kind: "document", index: 0, title: "Doc 0", text: "quote", location: { type: "char", start: 0, end: 50 }, span },
			{
				kind: "search_result",
				index: 1,
				title: "S",
				source: "https://s.test",
				text: "snip",
				location: { type: "block", start: 0, end: 2 },
				span
			},
			{ kind: "search_result", source: "call1", index: 3, text: '{"a":1}', location: { type: "block", start: 2, end: 3 }, span },
			{ kind: "search_result", source: "call1", index: 3, text: '{"a":1}', location: { type: "block", start: 0, end: 1 }, span },
			{ kind: "search_result", source: "other", index: 0, text: "{}", location: { type: "block", start: 0, end: 1 }, span },
			{ kind: "document", id: "mine", title: "Mine", text: "t", span },
			{ kind: "document", id: "bare", span },
			{ kind: "document", span }
		]);
		expect(citationsOf({ start: 0, end: 1 }, 0)).toEqual([]);
		expect(citationsOf({ start: 0, end: 1, sources: [{ type: "tool", id: "x:1" }] }, 0)[0]).toMatchObject({ index: 0 });
		expect(citationsOf({ start: 0, end: 1, sources: [{ type: "document", id: "d" }] }, 0, {})[0]).toMatchObject({ id: "d" });
		const untitled = citationsOf({ start: 0, end: 1, sources: [{ type: "document", id: "doc_0" }] }, 0, {
			documents: { doc_0: { kind: "document", index: 0, length: 3 } }
		});
		expect(untitled[0]).not.toHaveProperty("title");
		const noSource = citationsOf({ start: 0, end: 1, sources: [{ type: "document", id: "r" }] }, 0, {
			documents: { r: { kind: "search_result", index: 0 } }
		});
		expect(noSource[0]).toMatchObject({ kind: "search_result", location: { type: "block", start: 0, end: 1 } });
		expect(noSource[0]).not.toHaveProperty("source");
	});

	it("puts citations on the reply as annotations spanning the cited text, counting the tool plan and the content blocks before it", () => {
		const out = completion(
			{
				finish_reason: "COMPLETE",
				message: {
					tool_plan: "Plan.",
					content: [
						{ type: "thinking", thinking: "hm" },
						{ type: "text", text: "First " },
						{ type: "text", text: "second answer" }
					],
					citations: [
						{ start: 0, end: 6, type: "TEXT_CONTENT", content_index: 1, sources: [{ type: "document", id: "doc_0", document: {} }] },
						{ start: 7, end: 13, type: "TEXT_CONTENT", content_index: 2, sources: [{ type: "document", id: "result_1", document: {} }] },
						{ start: 0, end: 5, type: "PLAN", sources: [{ type: "document", id: "doc_0", document: {} }] },
						{ start: 0, end: 3, type: "THINKING_CONTENT", sources: [{ type: "document", id: "doc_0", document: {} }] },
						{ start: 1, end: 2, sources: [{ type: "document", id: "doc_0", document: {} }] },
						{ start: 1, end: 2, type: "TEXT_CONTENT", content_index: 9, sources: [{ type: "document", id: "doc_0", document: {} }] }
					]
				}
			},
			{ state }
		);
		const message = out.choices[0].message;
		expect(message.content).toBe("Plan.\n\nFirst second answer");
		expect(message.annotations.map((entry) => entry.citation.span)).toEqual([
			{ start: 7, end: 13 },
			{ start: 20, end: 26 },
			{ start: 0, end: 5 },
			{ start: 8, end: 9 },
			{ start: 8, end: 9 }
		]);
		const noBody = completion({ message: { tool_plan: "Only a plan.", content: [] } });
		expect(noBody.choices[0].message.content).toBe("Only a plan.");
	});

	it("keeps only the first tool call when parallel calls were switched off", () => {
		const calls = [
			{ id: "a", type: "function", function: { name: "f", arguments: "{}" } },
			{ id: "b", type: "function", function: { name: "g", arguments: "{}" } }
		];
		const reply = { finish_reason: "TOOL_CALL", message: { tool_calls: calls, content: [] } };
		expect(completion(reply, { state: { singleCall: true } }).choices[0].message.tool_calls.map((call) => call.id)).toEqual(["a"]);
		expect(completion(reply, { state: {} }).choices[0].message.tool_calls).toHaveLength(2);
		expect(completion(reply).choices[0].message.tool_calls).toHaveLength(2);
	});

	it("reports the log probabilities as chat logprobs, and the cached tokens in the usage", () => {
		expect(
			logprobsOf([
				{ token_ids: [1, 2], text: "hé", logprobs: [-0.1, -0.2] },
				{ text: "x", logprobs: [-1] },
				{ logprobs: [-2] },
				{ token_ids: [] }
			])
		).toEqual([
			{ token: "hé", logprob: -0.1, bytes: [104, 195, 169], top_logprobs: [] },
			{ token: "", logprob: -0.2, bytes: [], top_logprobs: [] },
			{ token: "x", logprob: -1, bytes: [120], top_logprobs: [] },
			{ token: "", logprob: -2, bytes: [], top_logprobs: [] }
		]);
		expect(logprobsOf({ text: "a", logprobs: [-3] })).toHaveLength(1);
		expect(logprobsOf(undefined)).toEqual([]);
		const out = completion({
			finish_reason: "COMPLETE",
			message: { content: [{ type: "text", text: "x" }] },
			logprobs: [{ text: "x", logprobs: [-0.5] }]
		});
		expect(out.choices[0].logprobs).toEqual({ content: [{ token: "x", logprob: -0.5, bytes: [120], top_logprobs: [] }] });
		expect(completion({ message: {}, logprobs: [] }).choices[0]).not.toHaveProperty("logprobs");
		const cached = { tokens: { input_tokens: 100, output_tokens: 5 }, cached_tokens: 40 };
		expect(usageOf(cached)).toEqual({
			prompt_tokens: 100,
			completion_tokens: 5,
			total_tokens: 105,
			prompt_tokens_details: { cached_tokens: 40 }
		});
		expect(folded(cached)).toEqual({ input_tokens: 60, output_tokens: 5, cache_read_input_tokens: 40, cache_creation_input_tokens: 0 });
		expect(usageOf({ tokens: { input_tokens: 1, output_tokens: 1 }, cached_tokens: 0 })).not.toHaveProperty("prompt_tokens_details");
		expect(folded({ tokens: { input_tokens: 5, output_tokens: 1 }, cached_tokens: 9 }).input_tokens).toBe(0);
	});
});

describe("createChunker: plans, citations, log probabilities and single calls", () => {
	const ev = (type, extra = {}) => ({ name: type, data: { type, ...extra } });
	const run = (chunker, list) => list.flatMap(({ name, data }) => chunker.event(name, data));
	const state = { documents: { doc_0: { kind: "document", index: 0, title: "D", length: 9 } } };
	const cite = (extra = {}) =>
		ev("citation-start", {
			index: 1,
			delta: {
				message: {
					citations: { start: 0, end: 4, type: "TEXT_CONTENT", sources: [{ type: "document", id: "doc_0", document: {} }], ...extra }
				}
			}
		});

	it("streams the tool plan as content, with a break before the content that follows it, and counts citations from it", () => {
		const chunker = createChunker({ state });
		const chunks = run(chunker, [
			ev("tool-plan-delta", { delta: { message: { tool_plan: "Plan" } } }),
			ev("tool-plan-delta", { delta: { message: { tool_plan: "" } } }),
			ev("tool-plan-delta", { delta: {} }),
			ev("content-delta", { index: 1, delta: { message: { content: { text: "Answer" } } } }),
			ev("content-delta", { index: 1, delta: { message: { content: { text: " more" } } } }),
			cite(),
			cite({ type: "PLAN", start: 1, end: 3 }),
			cite({ type: "THINKING_CONTENT" }),
			ev("citation-start", { index: 1 }),
			ev("citation-start", { index: 1, delta: { message: { citations: { start: 0, end: 1, sources: [] } } } }),
			ev("citation-end", { index: 1 })
		]);
		expect(chunks.map((chunk) => chunk.choices[0].delta.content).filter((value) => value !== undefined)).toEqual([
			"",
			"Plan",
			"\n\nAnswer",
			" more"
		]);
		const annotated = chunks.filter((chunk) => chunk.choices[0].delta.annotations);
		expect(annotated.map((chunk) => chunk.choices[0].delta.annotations[0].citation.span)).toEqual([
			{ start: 6, end: 10 },
			{ start: 1, end: 3 }
		]);
	});

	it("counts a citation from the start of the text when no content block started, and works with no state", () => {
		const chunks = run(createChunker(), [cite({ start: 2, end: 5 }), cite({ type: "PLAN", start: 0, end: 2 })]);
		expect(
			chunks.filter((chunk) => chunk.choices[0].delta.annotations).map((chunk) => chunk.choices[0].delta.annotations[0].citation.span)
		).toEqual([
			{ start: 2, end: 5 },
			{ start: 0, end: 2 }
		]);
	});

	it("streams log probabilities with the text they belong to", () => {
		const chunks = run(createChunker(), [
			ev("content-delta", {
				index: 0,
				delta: { message: { content: { text: "hi" } } },
				logprobs: { token_ids: [1], text: "hi", logprobs: [-0.3] }
			}),
			ev("content-delta", { index: 0, delta: { message: { content: { thinking: "hm" } } }, logprobs: { text: "hm", logprobs: [-0.4] } })
		]);
		expect(chunks[1].choices[0].logprobs.content[0]).toMatchObject({ token: "hi", logprob: -0.3 });
		expect(chunks[2].choices[0].logprobs.content[0]).toMatchObject({ token: "hm" });
	});

	it("goes on with the first tool call only when parallel calls were switched off", () => {
		const start = (index, id) =>
			ev("tool-call-start", {
				index,
				delta: { message: { tool_calls: { id, type: "function", function: { name: "f", arguments: "" } } } }
			});
		const delta = (index) => ev("tool-call-delta", { index, delta: { message: { tool_calls: { function: { arguments: "{}" } } } } });
		const run2 = (options) =>
			run(createChunker(options), [
				start(0, "a"),
				delta(0),
				start(1, "b"),
				delta(1),
				ev("message-end", { delta: { finish_reason: "TOOL_CALL" } })
			]);
		expect(
			run2({ state: { singleCall: true } })
				.flatMap((chunk) => chunk.choices[0]?.delta.tool_calls ?? [])
				.map((call) => call.index)
		).toEqual([0, 0]);
		expect(
			run2({ state: {} })
				.flatMap((chunk) => chunk.choices[0]?.delta.tool_calls ?? [])
				.map((call) => call.index)
		).toEqual([0, 0, 1, 1]);
	});

	it("reports cached tokens in the final usage chunk", () => {
		const chunks = run(createChunker(), [
			ev("message-end", {
				delta: { finish_reason: "COMPLETE", usage: { tokens: { input_tokens: 10, output_tokens: 1 }, cached_tokens: 4 } }
			})
		]);
		expect(chunks.at(-1).usage.prompt_tokens_details).toEqual({ cached_tokens: 4 });
	});
});

describe("promptText and chunksOf", () => {
	it("collects the text the model reads from a Cohere body, and from a Chat Completions body", () => {
		const text = promptText({
			messages: [
				{ role: "system", content: "sys" },
				{ role: "user", content: [{ type: "text", text: "hi" }, { type: "image_url" }, null] },
				{
					role: "assistant",
					content: [{ type: "thinking", thinking: "hm" }],
					tool_plan: "plan",
					tool_calls: [{ function: { name: "f", arguments: "{}" } }, {}]
				},
				{ role: "assistant", content: "", reasoning: "why" },
				{
					role: "tool",
					content: [
						{ type: "document", document: { id: "d", data: { text: "doc" } } },
						{ type: "document", document: { id: "e" } }
					]
				}
			],
			tools: [{ type: "function", function: { name: "f" } }, { name: "bare" }],
			documents: ["plain", { id: "x", data: { text: "dd" } }, { id: "y" }]
		});
		expect(text).toEqual([
			"sys",
			"hi",
			"hm",
			"plan",
			"f",
			"{}",
			"why",
			'{"text":"doc"}',
			'{"id":"e"}',
			'{"name":"f"}',
			'{"name":"bare"}',
			"plain",
			'{"text":"dd"}',
			'{"id":"y"}'
		]);
		expect(promptText({})).toEqual([]);
		expect(promptText(undefined)).toEqual([]);
		expect(promptText({ messages: [{ role: "user", content: 5 }] })).toEqual([]);
	});

	it("cuts a text into pieces, never between the halves of a surrogate pair", () => {
		expect(chunksOf("", 4)).toEqual([]);
		expect(chunksOf("abcdef", 4)).toEqual(["abcd", "ef"]);
		expect(chunksOf("abcd", 4)).toEqual(["abcd"]);
		const pieces = chunksOf("abc😀def", 4);
		expect(pieces).toEqual(["abc", "😀de", "f"]);
		expect(pieces.join("")).toBe("abc😀def");
	});
});

describe("citations of the model's thinking", () => {
	const doc = (id, document = {}) => ({ type: "document", id, document });
	const thought = (end, sources, extra = {}) => ({ type: "THINKING_CONTENT", start: 0, end, content_index: 0, sources, ...extra });
	const state = { documents: { doc_0: { kind: "document", index: 0, title: "Doc  0", length: 9, source: "https://info.test/x" } } };
	const reasoningOf = (citations, thinking = "Let me check the notes", options = {}) =>
		completion(
			{
				finish_reason: "COMPLETE",
				message: {
					content: [
						{ type: "thinking", thinking },
						{ type: "text", text: "ok" }
					],
					citations
				}
			},
			{ state, ...options }
		).choices[0].message.reasoning;

	it("writes [n] markers at the cited spans and lists the sources, numbered in the order they are cited", () => {
		const out = reasoningOf([
			thought(22, [doc("doc_0", { title: "Ignored" }), doc("b", { title: "B" })]),
			thought(6, [doc("b", { title: "B", url: "https://b.test" })])
		]);
		expect(out).toBe("Let me[1] check the notes[2][1]\n\nSources:\n[1] B (https://b.test)\n[2] Doc 0 (https://info.test/x)");
		expect(unmark(out)).toBe("Let me check the notes");
	});

	it("names a source by its title, its id, or its tool call, with the URL the document gives", () => {
		const out = reasoningOf([
			thought(3, [doc("only-id")]),
			thought(3, [doc("d2", { title: "Two", source: "https://two.test" })]),
			thought(3, [doc("d3", { title: "Three", source: "not a url", url: 5 })]),
			thought(3, [{ type: "tool", id: "call7:2", tool_output: {} }]),
			thought(3, [{ type: "tool", id: "call7:3" }]),
			thought(3, [{ type: "document" }, null])
		]);
		expect(out.split("\n\nSources:\n")[1].split("\n")).toEqual([
			"[1] only-id",
			"[2] Two (https://two.test)",
			"[3] Three",
			"[4] tool result call7",
			"[5] document"
		]);
	});

	it("marks the end of the text when a citation has no usable end, keeps within the text, and only marks the block it names", () => {
		const out = completion(
			{
				finish_reason: "COMPLETE",
				message: {
					content: [
						{ type: "thinking", thinking: "one" },
						{ type: "text", text: "x" },
						{ type: "thinking", thinking: "two" }
					],
					citations: [
						thought(undefined, [doc("a", { title: "A" })]),
						thought(-4, [doc("a", { title: "A" })]),
						thought(99, [doc("c", { title: "C" })], { content_index: 2 }),
						{ type: "THINKING_CONTENT", end: 1, sources: "x" },
						{ type: "THINKING_CONTENT", end: 1, content_index: 7, sources: [doc("z")] }
					]
				}
			},
			{ state }
		);
		expect(out.choices[0].message.reasoning).toBe("[1]one[1]two[2]\n\nSources:\n[1] A\n[2] C");
	});

	it("leaves thinking with no citations, and a list-less text, as it is", () => {
		expect(reasoningOf([])).toBe("Let me check the notes");
		expect(reasoningOf(undefined)).toBe("Let me check the notes");
		expect(unmark("plain [1] text")).toBe("plain [1] text");
	});

	it("takes out only the markers the list accounts for, and only after a list in the translator's form", () => {
		expect(unmark("a[1]b[2]c[3] d[0]\n\nSources:\n[1] A\n[2] B")).toBe("abc[3] d[0]");
		expect(unmark("a[1]\n\nSources:\n[1] A\n")).toBe("a");
		expect(unmark("a[1]\n\nSources:\nnot a list")).toBe("a[1]\n\nSources:\nnot a list");
	});

	it("reads the source list the way the old pattern did: one trailing newline at most, the whole tail a list", () => {
		expect(unmark("a[1]\n\nSources:\n[1] A")).toBe("a");
		expect(unmark("a[1]\n\nSources:\n[1] A\n\n")).toBe("a[1]\n\nSources:\n[1] A\n\n");
		expect(unmark("a[1]\n\nSources:\n[1] A\nafter")).toBe("a[1]\n\nSources:\n[1] A\nafter");
		expect(unmark("a[1]\n\nSources:\n")).toBe("a[1]\n\nSources:\n");
		expect(unmark("a[1]\n\nSources:\n[1] A\n\nb")).toBe("a[1]\n\nSources:\n[1] A\n\nb");
	});

	it("uses the first Sources block whose tail is a list, and skips an earlier one that is not", () => {
		expect(unmark("x[1]\n\nSources:\nnote\n\nSources:\n[1] A\n[2] B")).toBe("x\n\nSources:\nnote");
		expect(unmark("x[1]\n\nSources:\n[1] A\n\nSources:\n[1] B")).toBe("x\n\nSources:\n A");
	});

	it("scans a pathological source list in linear time", () => {
		const text = "\n\nSources:\n[9] " + "[0] ".repeat(50000) + "x\ny";
		const start = Date.now();
		expect(unmark(text)).toBe(text);
		expect(Date.now() - start).toBeLessThan(1000);
	});

	it("sends thinking back as Cohere wrote it", () => {
		const marked = "Let me[1] check\n\nSources:\n[1] Doc";
		const out = chatBody({ model: "m", messages: [{ role: "assistant", content: "hi", reasoning: marked }] });
		expect(out.messages[0].content[0]).toEqual({ type: "thinking", thinking: "Let me check" });
	});

	it("sets state.cites when the request has documents, and not otherwise", () => {
		const withDocs = {};
		chatBody({ model: "m", messages: user, documents: [{ id: "d", data: {} }] }, { state: withDocs });
		expect(withDocs.cites).toBe(true);
		const without = {};
		chatBody({ model: "m", messages: user }, { state: without });
		expect(without).not.toHaveProperty("cites");
	});

	describe("streamed", () => {
		const ev = (type, extra = {}) => ({ name: type, data: { type, ...extra } });
		const think = (text, index = 0) => ev("content-delta", { index, delta: { message: { content: { thinking: text } } } });
		const cite = (end, sources, index = 0) =>
			ev("citation-start", { index, delta: { message: { citations: { type: "THINKING_CONTENT", start: 0, end, sources } } } });
		const answer = (text) => ev("content-delta", { index: 1, delta: { message: { content: { text } } } });
		const run = (list, options) => {
			const chunker = createChunker({ state: { cites: true, ...state }, ...options });
			return list.flatMap(({ name, data }) => chunker.event(name, data));
		};
		const reasoning = (chunks) => chunks.map((chunk) => chunk.choices?.[0]?.delta.reasoning ?? "");

		it("holds a thinking block until it ends, then sends it marked, then the sources before the answer", () => {
			const chunks = run([
				ev("message-start"),
				think("Let me "),
				think("check"),
				cite(6, [doc("doc_0")]),
				ev("citation-start", { index: 9 }),
				ev("content-end", { index: 0 }),
				answer("ok"),
				ev("message-end", { delta: { finish_reason: "COMPLETE" } })
			]);
			expect(reasoning(chunks).filter((text) => text !== "")).toEqual(["Let me[1] check", "\n\nSources:\n[1] Doc 0 (https://info.test/x)"]);
			const kinds = chunks.map((chunk) => (chunk.choices?.[0]?.delta.reasoning ? "r" : chunk.choices?.[0]?.delta.content ? "c" : "-"));
			expect(kinds.join("").replace(/-/g, "")).toBe("rrc");
		});

		it("settles a thinking block that has no content-end before the plan, a tool call and the end of the reply", () => {
			const plan = ev("tool-plan-delta", { delta: { message: { tool_plan: "plan" } } });
			const call = ev("tool-call-start", { index: 2, delta: { message: { tool_calls: { id: "t", function: { name: "f" } } } } });
			const end = ev("message-end", { delta: { finish_reason: "TOOL_CALL" } });
			for (const next of [plan, call, end]) {
				const chunks = run([think("abc"), cite(2, [doc("x", { title: "X" })]), next]);
				expect(reasoning(chunks).filter((text) => text !== "")).toEqual(["ab[1]c", "\n\nSources:\n[1] X"]);
			}
		});

		it("sends no list when nothing was cited, sends the sources once, and ignores citations of a block it does not hold", () => {
			const plain = run([think("abc"), ev("content-end", { index: 0 }), ev("content-end", { index: 5 }), answer("a"), answer("b")]);
			expect(reasoning(plain).filter((text) => text !== "")).toEqual(["abc"]);
			const twice = run([think("abc"), cite(1, [doc("x")]), answer("a"), answer("b"), cite(1, [doc("y")], 7), cite(1, "no")]);
			expect(reasoning(twice).filter((text) => text !== "")).toHaveLength(2);
			const odd = run([think("abc"), cite(1, "no"), ev("content-end", { index: 0 })]);
			expect(reasoning(odd).filter((text) => text !== "")).toEqual(["abc"]);
		});

		it("streams thinking live when no citations are possible", () => {
			const chunks = run([think("abc"), cite(1, [doc("x")])], { state: {} });
			expect(reasoning(chunks)).toContain("abc");
		});
	});
});

describe("dropped fields", () => {
	it("names a part Cohere cannot take once, however many messages have one", () => {
		const dropped = [];
		const audio = { role: "user", content: [{ type: "input_audio" }, { type: "text", text: "x" }] };
		chatBody({ model: "m", messages: [audio, audio] }, { dropped });
		expect(dropped).toEqual(["content.input_audio"]);
	});
});

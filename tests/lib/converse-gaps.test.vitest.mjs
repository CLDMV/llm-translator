/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/converse-gaps.test.vitest.mjs
 *	@Date: 2026-11-22T09:00:00-08:00 (1795370400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T09:00:00-08:00 (1795370400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Converse: cache points, reasoning with its signature in both directions, and `response_format` sent as a tool and read back as text.
 */
import { describe, expect, it } from "vitest";
import { chatBody, completion, createChunker } from "../../src/lib/converse.mjs";
import { ANTHROPIC_FORMAT } from "../../src/lib/thinking.mjs";

const point = { cachePoint: { type: "default" } };
const chunker = (options) => {
	const c = createChunker(options);
	return (name, data) => c.event(name, data);
};

describe("cache points", () => {
	const messages = [
		{ role: "system", content: "sys", cache_point: {} },
		{
			role: "user",
			content: [
				{ type: "text", text: "a", cache_point: { ttl: "1h" } },
				{ type: "text", text: "b" }
			]
		},
		{ role: "assistant", content: "ok", cache_point: { ttl: "5m" }, tool_calls: [{ id: "t", function: { name: "R", arguments: "{}" } }] },
		{ role: "tool", tool_call_id: "t", content: "done" }
	];
	const tools = [
		{ type: "function", function: { name: "R", parameters: { type: "object" } }, cache_point: {} },
		{ type: "function", function: { name: "S" } }
	];

	it("puts a cache point after the marked tool, system block, content part, assistant turn and tool result", () => {
		const out = chatBody({ model: "m", messages, tools }, { cache: true });
		expect(out.toolConfig.tools.map((entry) => Object.keys(entry)[0])).toEqual(["toolSpec", "cachePoint", "toolSpec"]);
		expect(out.system).toEqual([{ text: "sys" }, point]);
		expect(out.messages[0].content).toEqual([{ text: "a" }, { cachePoint: { type: "default", ttl: "1h" } }, { text: "b" }]);
		expect(out.messages[1].content.map((block) => Object.keys(block)[0])).toEqual(["text", "toolUse", "cachePoint"]);
		expect(out.messages[1].content.at(-1)).toEqual(point);
		expect(out.messages[2].content.map((block) => Object.keys(block)[0])).toEqual(["toolResult"]);
	});

	it("puts a cache point right after a marked tool call", () => {
		const out = chatBody(
			{
				model: "m",
				messages: [
					{
						role: "assistant",
						content: "",
						tool_calls: [
							{ id: "t", function: { name: "R", arguments: "{}" }, cache_point: {} },
							{ id: "u", function: { name: "R", arguments: "{}" } }
						]
					}
				],
				tools
			},
			{ cache: true }
		);
		expect(out.messages[0].content.map((block) => Object.keys(block)[0])).toEqual(["toolUse", "cachePoint", "toolUse"]);
	});

	it("puts a cache point after a marked tool result", () => {
		const out = chatBody(
			{ model: "m", messages: [{ role: "tool", tool_call_id: "t", content: "done", cache_point: {} }], tools },
			{ cache: true }
		);
		expect(out.messages[0].content.map((block) => Object.keys(block)[0])).toEqual(["toolResult", "cachePoint"]);
	});

	it("leaves the markers alone unless asked, and keeps no point for a part that is left out", () => {
		const plain = chatBody({ model: "m", messages, tools });
		expect(JSON.stringify(plain)).not.toContain("cachePoint");
		const empty = chatBody(
			{
				model: "m",
				messages: [
					{
						role: "user",
						content: [
							{ type: "text", text: "", cache_point: {} },
							{ type: "text", text: "x" }
						]
					},
					{ role: "system", content: "", cache_point: {} }
				]
			},
			{ cache: true }
		);
		expect(empty).toEqual({ messages: [{ role: "user", content: [{ text: "x" }] }] });
	});

	it("follows an image with its point", () => {
		const out = chatBody(
			{
				model: "m",
				messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" }, cache_point: {} }] }]
			},
			{ cache: true }
		);
		expect(out.messages[0].content).toEqual([{ image: { format: "png", source: { bytes: "AAAA" } } }, point]);
	});

	it("keeps the last four points and says that cache_control went", () => {
		const many = [];
		for (let at = 0; at < 4; at++) many.push({ role: at % 2 === 0 ? "user" : "assistant", content: `m${at}`, cache_point: {} });
		const dropped = [];
		const out = chatBody(
			{ model: "m", messages: [{ role: "system", content: "s", cache_point: {} }, ...many], tools },
			{ cache: true, dropped }
		);
		const points = (list) => list.filter((block) => block.cachePoint).length;
		const total = points(out.toolConfig.tools) + points(out.system) + out.messages.reduce((n, message) => n + points(message.content), 0);
		expect(total).toBe(4);
		// The earliest, the tool's and the system's, went.
		expect(points(out.toolConfig.tools) + points(out.system)).toBe(0);
		expect(dropped).toEqual(["cache_control"]);
		const four = chatBody({ model: "m", messages: many }, { cache: true, dropped: [] });
		expect(four.messages.length).toBe(4);
		expect(four.messages.flatMap((message) => message.content).filter((block) => block.cachePoint)).toHaveLength(4);
	});
});

describe("reasoning sent back", () => {
	const text = { type: "reasoning.text", text: "hmm", signature: "sig", format: ANTHROPIC_FORMAT, index: 0 };
	const redacted = { type: "reasoning.encrypted", data: "QUJD", format: ANTHROPIC_FORMAT, index: 0 };

	it("sends signed reasoning and redacted reasoning as reasoningContent before the text", () => {
		const dropped = [];
		const out = chatBody(
			{
				model: "m",
				messages: [
					{ role: "user", content: "hi" },
					{
						role: "assistant",
						content: "answer",
						reasoning: "hmm",
						reasoning_details: [text, redacted, { type: "reasoning.text", text: "x", format: "other" }]
					}
				]
			},
			{ dropped }
		);
		expect(out.messages[1].content).toEqual([
			{ reasoningContent: { reasoningText: { text: "hmm", signature: "sig" } } },
			{ reasoningContent: { redactedContent: "QUJD" } },
			{ text: "answer" }
		]);
		expect(dropped).toEqual([]);
	});

	it("names reasoning text that has no signature, and sends nothing for it", () => {
		const dropped = [];
		const out = chatBody({ model: "m", messages: [{ role: "assistant", content: "a", reasoning: "unsigned" }] }, { dropped });
		expect(out.messages[0].content).toEqual([{ text: "a" }]);
		expect(dropped).toEqual(["reasoning"]);
	});
});

describe("reasoning read from a reply", () => {
	it("carries the signature and the redacted content as reasoning_details with their positions", () => {
		const message = completion({
			output: {
				message: {
					content: [
						{ reasoningContent: { reasoningText: { text: "first", signature: "s1" } } },
						{ reasoningContent: { redactedContent: "QUJD" } },
						{ text: "answer" },
						{ reasoningContent: { reasoningText: { signature: "s2" } } },
						{ reasoningContent: { reasoningText: { text: "unsigned" } } },
						{ reasoningContent: { redactedContent: "" } },
						{ toolUse: { toolUseId: "t", name: "R", input: {} } }
					]
				}
			},
			stopReason: "tool_use"
		}).choices[0].message;
		expect(message.reasoning).toBe("firstunsigned");
		expect(message.reasoning_details).toEqual([
			{ type: "reasoning.text", text: "first", signature: "s1", format: ANTHROPIC_FORMAT, index: 0 },
			{ type: "reasoning.encrypted", data: "QUJD", format: ANTHROPIC_FORMAT, index: 0 },
			{ type: "reasoning.text", text: "", signature: "s2", format: ANTHROPIC_FORMAT, index: 1 }
		]);
	});

	it("has no details for reasoning that is not signed", () => {
		const message = completion({ output: { message: { content: [{ reasoningContent: { reasoningText: { text: "r" } } }] } } }).choices[0]
			.message;
		expect(message.reasoning_details).toBeUndefined();
	});

	it("streams text, the signature and redacted content as reasoning_details fragments at the right position", () => {
		const event = chunker({ reasoningField: "reasoning_content" });
		const delta = (index, fields) => ["contentBlockDelta", { contentBlockIndex: index, delta: fields }];
		const first = event(...delta(0, { reasoningContent: { text: "hm" } }));
		expect(first[0].choices[0].delta).toEqual({ role: "assistant", content: "" });
		expect(first[1].choices[0].delta).toEqual({
			reasoning_details: [{ type: "reasoning.text", text: "hm", format: ANTHROPIC_FORMAT, index: 0 }],
			reasoning_content: "hm"
		});
		expect(event(...delta(0, { reasoningContent: { signature: "sg" } }))[0].choices[0].delta.reasoning_details).toEqual([
			{ type: "reasoning.text", text: "", signature: "sg", format: ANTHROPIC_FORMAT, index: 0 }
		]);
		expect(event(...delta(1, { reasoningContent: { redactedContent: "QUJD" } }))[0].choices[0].delta.reasoning_details).toEqual([
			{ type: "reasoning.encrypted", data: "QUJD", format: ANTHROPIC_FORMAT, index: 0 }
		]);
		event(...delta(2, { text: "answer" }));
		expect(event(...delta(3, { reasoningContent: { signature: "late" } }))[0].choices[0].delta.reasoning_details[0].index).toBe(1);
		expect(event(...delta(3, { reasoningContent: { text: "" } }))).toEqual([]);
		expect(event(...delta(3, { reasoningContent: { signature: "" } }))).toEqual([]);
		expect(event(...delta(3, { reasoningContent: { redactedContent: "" } }))).toEqual([]);
		expect(event(...delta(3, { other: true }))).toEqual([]);
	});
});

describe("response_format as a tool", () => {
	const schema = { type: "object", properties: { n: { type: "number" } }, required: ["n"] };
	const format = { type: "json_schema", json_schema: { name: "x", schema } };
	const messages = [{ role: "user", content: "hi" }];
	const fn = (name) => ({ type: "function", function: { name, parameters: { type: "object" } } });

	it("offers the schema as a tool, forces it, and tells the reply converters its name", () => {
		const state = {};
		const out = chatBody({ model: "m", messages, response_format: format }, { state });
		expect(out.toolConfig).toEqual({
			tools: [{ toolSpec: { name: "json_response", description: expect.any(String), inputSchema: { json: schema } } }],
			toolChoice: { tool: { name: "json_response" } }
		});
		expect(state.jsonTool).toBe("json_response");
		expect(out.system).toBeUndefined();
	});

	it("works without a state, takes json_object as any object and a json_schema without a schema the same way, and leaves text alone", () => {
		expect(chatBody({ model: "m", messages, response_format: { type: "json_object" } }).toolConfig.tools[0].toolSpec.inputSchema).toEqual({
			json: { type: "object" }
		});
		expect(chatBody({ model: "m", messages, response_format: { type: "json_schema" } }).toolConfig.tools[0].toolSpec.inputSchema).toEqual({
			json: { type: "object" }
		});
		expect(chatBody({ model: "m", messages, response_format: { type: "text" } }).toolConfig).toBeUndefined();
		expect(chatBody({ model: "m", messages, response_format: null }).toolConfig).toBeUndefined();
	});

	it("names a format it cannot send", () => {
		const dropped = [];
		expect(chatBody({ model: "m", messages, response_format: { type: "regex" } }, { dropped }).toolConfig).toBeUndefined();
		expect(dropped).toEqual(["response_format"]);
	});

	it("lets any tool be called when the request has tools of its own, and picks a name they do not use", () => {
		const state = {};
		const out = chatBody({ model: "m", messages, tools: [fn("json_response"), fn("R")], response_format: format }, { state });
		expect(out.toolConfig.toolChoice).toEqual({ any: {} });
		expect(out.toolConfig.tools.map((entry) => entry.toolSpec.name)).toEqual(["json_response", "R", "json_response_"]);
		expect(state.jsonTool).toBe("json_response_");
		expect(
			chatBody({ model: "m", messages, tools: [fn("R")], tool_choice: "required", response_format: format }).toolConfig.toolChoice
		).toEqual({
			any: {}
		});
	});

	it("forces the tool when tool_choice is none, with no instruction against tools", () => {
		const out = chatBody({ model: "m", messages, tools: [fn("R")], tool_choice: "none", response_format: format });
		expect(out.toolConfig.toolChoice).toEqual({ tool: { name: "json_response" } });
		expect(out.system).toBeUndefined();
	});

	it("leaves the format out when a named tool is forced, and names an unknown tool_choice", () => {
		const dropped = [];
		const out = chatBody(
			{ model: "m", messages, tools: [fn("R")], tool_choice: { type: "function", function: { name: "R" } }, response_format: format },
			{ dropped }
		);
		expect(out.toolConfig.toolChoice).toEqual({ tool: { name: "R" } });
		expect(out.toolConfig.tools).toHaveLength(1);
		expect(dropped).toEqual(["response_format"]);
		const odd = [];
		chatBody({ model: "m", messages, tools: [fn("R")], tool_choice: "weird", response_format: format }, { dropped: odd });
		expect(odd).toEqual(["tool_choice"]);
	});

	it("asks for the tool in the system prompt while thinking is on, because Claude cannot be forced then", () => {
		const out = chatBody({ model: "m", messages, response_format: format }, { thinkingBudget: 2048 });
		expect(out.toolConfig.toolChoice).toBeUndefined();
		expect(out.system).toEqual([{ text: expect.stringContaining("json_response") }]);
	});

	it("keeps the forced choice, the none instruction and the unknown choice of a request without a format as they were", () => {
		expect(chatBody({ model: "m", messages, tools: [fn("R")], tool_choice: "none" }).system).toEqual([{ text: expect.any(String) }]);
		expect(chatBody({ model: "m", messages, tools: [fn("R")], tool_choice: "required" }).toolConfig.toolChoice).toEqual({ any: {} });
	});

	it("reads a call of the tool as the content, as JSON text, and a plain stop", () => {
		const reply = (content, stopReason = "tool_use") =>
			completion({ output: { message: { content } }, stopReason }, { jsonTool: "json_response" }).choices[0];
		const answered = reply([{ toolUse: { toolUseId: "t", name: "json_response", input: { n: 1 } } }]);
		expect(answered.message.content).toBe('{"n":1}');
		expect(answered.message.tool_calls).toBeUndefined();
		expect(answered.finish_reason).toBe("stop");
		expect(reply([{ toolUse: { toolUseId: "t", name: "json_response" } }]).message.content).toBe("{}");
		expect(reply([{ toolUse: { toolUseId: "t", name: "json_response", input: {} } }], "max_tokens").finish_reason).toBe("length");
		const mixed = reply([
			{ toolUse: { toolUseId: "t", name: "json_response", input: { n: 2 } } },
			{ toolUse: { toolUseId: "u", name: "R", input: {} } }
		]);
		expect(mixed.message.tool_calls).toHaveLength(1);
		expect(mixed.finish_reason).toBe("tool_calls");
		// Without the name nothing is special.
		const plain = completion({
			output: { message: { content: [{ toolUse: { toolUseId: "t", name: "json_response", input: {} } }] } },
			stopReason: "tool_use"
		});
		expect(plain.choices[0].message.tool_calls).toHaveLength(1);
	});

	it("streams a call of the tool as content text, and every other call as before", () => {
		const event = chunker({ jsonTool: "json_response" });
		const start = event("contentBlockStart", { contentBlockIndex: 0, start: { toolUse: { toolUseId: "t", name: "json_response" } } });
		expect(start).toHaveLength(1);
		expect(start[0].choices[0].delta).toEqual({ role: "assistant", content: "" });
		const delta = (index, input) => event("contentBlockDelta", { contentBlockIndex: index, delta: { toolUse: { input } } });
		expect(delta(0, '{"n"')[0].choices[0].delta).toEqual({ content: '{"n"' });
		expect(delta(0, ":1}")[0].choices[0].delta).toEqual({ content: ":1}" });
		expect(delta(0, "")).toEqual([]);
		const stop = event("messageStop", { stopReason: "tool_use" });
		expect(stop.at(-1).choices[0].finish_reason).toBe("stop");
		const mixed = chunker({ jsonTool: "json_response" });
		mixed("contentBlockStart", { contentBlockIndex: 0, start: { toolUse: { toolUseId: "t", name: "R" } } });
		expect(mixed("messageStop", { stopReason: "tool_use" }).at(-1).choices[0].finish_reason).toBe("tool_calls");
	});
});

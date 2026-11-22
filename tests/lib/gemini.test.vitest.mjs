/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/gemini.test.vitest.mjs
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
 * @fileoverview Chat Completions to and from Google Gemini's `generateContent` API: the request body, the reply, usage, finish reasons, thought signatures and the stream chunker.
 */
import { describe, expect, it } from "vitest";
import {
	FORMAT,
	SKIP_SIGNATURE,
	chatBody,
	completion,
	countBody,
	createChunker,
	finishOf,
	folded,
	modelPath,
	route,
	usageOf
} from "../../src/lib/gemini.mjs";

const PNG = "iVBORw0KGgo=";
const tool = {
	type: "function",
	function: { name: "Read", description: "read a file", parameters: { type: "object", properties: { path: { type: "string" } } } }
};

describe("modelPath, route and countBody", () => {
	it("names the model resource, encoded, without doubling the prefix", () => {
		expect(modelPath("gemini-2.5-flash")).toBe("models/gemini-2.5-flash");
		expect(modelPath("models/gemini-2.5-flash")).toBe("models/gemini-2.5-flash");
		expect(modelPath("a/b c")).toBe("models/a%2Fb%20c");
	});

	it("puts calls under /v1beta unless the URL already ends in it", () => {
		expect(route({ url: "https://g.example" }, "models")).toBe("/v1beta/models");
		expect(route({ url: "https://g.example/v1beta" }, "models")).toBe("/models");
	});

	it("builds a countTokens body from the prompt fields only", () => {
		const request = { contents: [1], systemInstruction: { parts: [] }, tools: [2], toolConfig: { a: 1 }, generationConfig: { x: 1 } };
		expect(countBody(request, "gemini-x")).toEqual({
			generateContentRequest: {
				model: "models/gemini-x",
				contents: [1],
				systemInstruction: { parts: [] },
				tools: [2],
				toolConfig: { a: 1 }
			}
		});
		expect(countBody({ contents: [] }, "m").generateContentRequest).toEqual({ model: "models/m", contents: [] });
	});
});

describe("chatBody: messages", () => {
	it("maps text, system and developer messages, sampling, the output cap and the model roles", () => {
		const dropped = [];
		const out = chatBody(
			{
				model: "m",
				stream: true,
				messages: [
					{ role: "system", content: "be brief" },
					{ role: "developer", content: [{ type: "text", text: "be kind" }] },
					{ role: "user", content: "hi" },
					{ role: "assistant", content: "hello" },
					{
						role: "user",
						content: [
							{ type: "text", text: "again" },
							{ type: "text", text: "" }
						]
					},
					{ role: "user", content: "" },
					{ role: "other", content: "x" }
				],
				max_tokens: 10,
				max_completion_tokens: 20,
				temperature: 0.5,
				top_p: 0.9,
				top_k: 40,
				seed: 7,
				presence_penalty: 0.1,
				frequency_penalty: 0.2,
				stop: "END",
				stream_options: { include_usage: true },
				user: "u",
				logprobs: true
			},
			{ dropped, sampling: { candidateCount: 1, temperature: 2 } }
		);
		expect(out).toEqual({
			contents: [
				{ role: "user", parts: [{ text: "hi" }] },
				{ role: "model", parts: [{ text: "hello" }] },
				{ role: "user", parts: [{ text: "again" }] }
			],
			systemInstruction: { parts: [{ text: "be brief" }, { text: "be kind" }] },
			generationConfig: {
				candidateCount: 1,
				temperature: 0.5,
				maxOutputTokens: 20,
				topP: 0.9,
				topK: 40,
				seed: 7,
				presencePenalty: 0.1,
				frequencyPenalty: 0.2,
				stopSequences: ["END"]
			}
		});
		expect(dropped).toEqual(["messages.other", "logprobs"]);
		expect(chatBody({ messages: [{ role: "user", content: "x" }], max_tokens: 3, stop: ["a", "b"], n: 3 }).generationConfig).toEqual({
			maxOutputTokens: 3,
			stopSequences: ["a", "b"],
			candidateCount: 3
		});
		expect(chatBody({ messages: [{ role: "user", content: "x" }], n: 1, temperature: null, stop: null }).generationConfig).toBeUndefined();
		expect(chatBody({}).contents).toEqual([]);
		expect(
			chatBody({
				messages: [
					{ role: "user", content: null },
					{ role: "user", content: 5 }
				]
			}).contents
		).toEqual([]);
	});

	it("sends base64 images and files as bytes and says so when it cannot send an image", () => {
		const dropped = [];
		const out = chatBody(
			{
				messages: [
					{
						role: "user",
						content: [
							{ type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } },
							{ type: "image_url", image_url: `data:image/jpeg;base64,${PNG}` },
							{ type: "image_url", image_url: { url: "https://example.com/a.png" } },
							{ type: "image_url" },
							{ type: "image_url", image_url: { url: `data:image/gif;base64,${PNG}` } },
							{ type: "image_url", image_url: { url: `data:application/pdf;base64,${PNG}` } },
							{ type: "file", file: { file_data: `data:application/pdf;base64,${PNG}` } },
							{ type: "file", file: { file_id: "f" } },
							{ type: "input_audio" },
							{}
						]
					}
				]
			},
			{ dropped }
		);
		const parts = out.contents[0].parts;
		expect(parts[0]).toEqual({ inlineData: { mimeType: "image/png", data: PNG } });
		expect(parts[1]).toEqual({ inlineData: { mimeType: "image/jpeg", data: PNG } });
		expect(parts[2].text).toMatch(/does not fetch URLs/);
		expect(parts[3].text).toMatch(/does not fetch URLs/);
		expect(parts[4].text).toMatch(/does not fetch URLs/);
		expect(parts[5]).toEqual({ inlineData: { mimeType: "application/pdf", data: PNG } });
		expect(parts[6]).toEqual({ inlineData: { mimeType: "application/pdf", data: PNG } });
		expect(parts).toHaveLength(7);
		expect(dropped).toEqual(["image_url", "content.file", "content.input_audio", "content.part"]);
	});
});

describe("chatBody: tools", () => {
	const messages = [
		{ role: "user", content: "read it" },
		{
			role: "assistant",
			content: "ok",
			reasoning: "thinking",
			tool_calls: [
				{ id: "c1", type: "function", function: { name: "Read", arguments: '{"path":"a"}' } },
				{ id: "c2", type: "function", function: { name: "Read", arguments: "not json" } }
			]
		},
		{ role: "tool", tool_call_id: "c1", content: "file a" },
		{ role: "tool", tool_call_id: "c2", content: "[error] missing" },
		{ role: "tool", tool_call_id: "zz", name: "Named", content: "" },
		{
			role: "tool",
			tool_call_id: "yy",
			content: [
				{ type: "text", text: "x" },
				{ type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } }
			]
		}
	];

	it("declares tools with their JSON Schema, and sends calls and results in turns", () => {
		const dropped = [];
		const out = chatBody({ messages, tools: [tool] }, { dropped, marker: "[error] " });
		expect(out.tools).toEqual([
			{
				functionDeclarations: [
					{ name: "Read", description: "read a file", parametersJsonSchema: { type: "object", properties: { path: { type: "string" } } } }
				]
			}
		]);
		expect(out.contents).toEqual([
			{ role: "user", parts: [{ text: "read it" }] },
			{
				role: "model",
				parts: [
					{ text: "ok" },
					{ functionCall: { id: "c1", name: "Read", args: { path: "a" } }, thoughtSignature: SKIP_SIGNATURE },
					{ functionCall: { id: "c2", name: "Read", args: { _raw_arguments: "not json" } } }
				]
			},
			{
				role: "user",
				parts: [
					{ functionResponse: { id: "c1", name: "Read", response: { output: "file a" } } },
					{ functionResponse: { id: "c2", name: "Read", response: { error: "missing" } } },
					{ functionResponse: { id: "zz", name: "Named", response: { output: "(no output)" } } },
					{ functionResponse: { id: "yy", name: "tool", response: { output: "x" } } },
					{ inlineData: { mimeType: "image/png", data: PNG } }
				]
			}
		]);
		expect(dropped).toEqual(["reasoning"]);
		const unmarked = chatBody({ messages, tools: [tool] });
		expect(unmarked.contents[2].parts[1].functionResponse.response).toEqual({ output: "[error] missing" });
		expect(
			chatBody({ messages: [{ role: "tool", tool_call_id: "q", content: "[error] ", name: "N" }], tools: [tool] }, { marker: "[error] " })
				.contents[0].parts[0].functionResponse.response
		).toEqual({ error: "(no output)" });
	});

	it("writes past tool calls and results as text when the request has no tools", () => {
		const out = chatBody({ messages });
		expect(out.tools).toBeUndefined();
		const text = JSON.stringify(out.contents);
		expect(text).not.toMatch(/functionCall|functionResponse/);
		expect(text).toContain('[Called tool Read with input {\\"path\\":\\"a\\"}]');
		expect(text).toContain("[Result of tool Read: file a]");
		const failed = chatBody({ messages }, { marker: "[error] " });
		expect(JSON.stringify(failed.contents)).toContain("[Tool Read failed: missing]");
	});

	it("leaves a schema out when the tool takes nothing, drops $schema, and keeps the rest", () => {
		const out = chatBody({
			messages: [{ role: "user", content: "x" }],
			tools: [
				{ type: "function", function: { name: "a", parameters: { type: "object", properties: {} } } },
				{ type: "function", function: { name: "b", parameters: { type: "object" } } },
				{ type: "function", function: { name: "c" } },
				{ type: "function", function: { name: "d", parameters: null } },
				{
					type: "function",
					function: {
						name: "e",
						parameters: { $schema: "x", type: "object", properties: { v: { type: "string" } }, additionalProperties: false }
					}
				},
				{ type: "function", function: { name: "f", parameters: { anyOf: [{ type: "string" }] } } }
			]
		});
		expect(out.tools[0].functionDeclarations).toEqual([
			{ name: "a" },
			{ name: "b" },
			{ name: "c" },
			{ name: "d" },
			{ name: "e", parametersJsonSchema: { type: "object", properties: { v: { type: "string" } }, additionalProperties: false } },
			{ name: "f", parametersJsonSchema: { anyOf: [{ type: "string" }] } }
		]);
	});

	it("maps tool_choice to the calling mode", () => {
		const call = (tool_choice, dropped = []) =>
			chatBody({ messages: [{ role: "user", content: "x" }], tools: [tool], tool_choice }, { dropped }).toolConfig;
		expect(call("required")).toEqual({ functionCallingConfig: { mode: "ANY" } });
		expect(call("none")).toEqual({ functionCallingConfig: { mode: "NONE" } });
		expect(call({ type: "function", function: { name: "Read" } })).toEqual({
			functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["Read"] }
		});
		expect(call("auto")).toBeUndefined();
		expect(call(undefined)).toBeUndefined();
		const dropped = [];
		expect(call({ type: "allowed_tools" }, dropped)).toBeUndefined();
		expect(dropped).toEqual(["tool_choice"]);
		expect(chatBody({ messages: [], tool_choice: "required" }).toolConfig).toBeUndefined();
	});
});

describe("chatBody: thinking and structured output", () => {
	const ask = (extra, context, dropped = []) => chatBody({ messages: [{ role: "user", content: "x" }], ...extra }, { dropped, ...context });

	it("an explicit budget wins over an effort", () => {
		expect(ask({ reasoning_effort: "low" }, { thinkingBudget: 2000 }).generationConfig.thinkingConfig).toEqual({
			includeThoughts: true,
			thinkingBudget: 2000
		});
	});

	it("an effort is a budget, none is zero, and an unknown one is dropped", () => {
		const budget = (effort) => ask({ reasoning_effort: effort }).generationConfig?.thinkingConfig;
		expect(budget("none")).toEqual({ thinkingBudget: 0 });
		expect(budget("minimal")).toEqual({ includeThoughts: true, thinkingBudget: 512 });
		expect(budget("low")).toEqual({ includeThoughts: true, thinkingBudget: 1024 });
		expect(budget("medium")).toEqual({ includeThoughts: true, thinkingBudget: 8192 });
		expect(budget("high")).toEqual({ includeThoughts: true, thinkingBudget: 24576 });
		expect(budget("xhigh")).toEqual({ includeThoughts: true, thinkingBudget: 24576 });
		expect(budget("max")).toEqual({ includeThoughts: true, thinkingBudget: 24576 });
		expect(budget(null)).toBeUndefined();
		const dropped = [];
		expect(ask({ reasoning_effort: "toString" }, {}, dropped).generationConfig).toBeUndefined();
		expect(dropped).toEqual(["reasoning_effort"]);
	});

	it("a Gemini 3 model gets a thinking level, moved to one the model has, and never a budget", () => {
		const level = (model, extra, context) => ask({ model, ...extra }, context).generationConfig?.thinkingConfig;
		const flash = "gemini-3-flash-preview";
		expect(level(flash, { reasoning_effort: "minimal" })).toEqual({ includeThoughts: true, thinkingLevel: "MINIMAL" });
		expect(level(flash, { reasoning_effort: "low" })).toEqual({ includeThoughts: true, thinkingLevel: "LOW" });
		expect(level(flash, { reasoning_effort: "medium" })).toEqual({ includeThoughts: true, thinkingLevel: "MEDIUM" });
		expect(level(flash, { reasoning_effort: "max" })).toEqual({ includeThoughts: true, thinkingLevel: "HIGH" });
		expect(level(flash, { reasoning_effort: "none" })).toEqual({ thinkingLevel: "MINIMAL" });
		expect(level("models/gemini-3.1-pro-preview", { reasoning_effort: "minimal" })).toEqual({
			includeThoughts: true,
			thinkingLevel: "LOW"
		});
		expect(level("gemini-3.1-pro-preview", { reasoning_effort: "medium" })).toEqual({ includeThoughts: true, thinkingLevel: "MEDIUM" });
		expect(level("gemini-3-pro-preview", { reasoning_effort: "medium" })).toEqual({ includeThoughts: true, thinkingLevel: "LOW" });
		expect(level("gemini-3-pro-preview", { reasoning_effort: "none" })).toEqual({ thinkingLevel: "LOW" });
		expect(level("gemini-4-hydrogen", { reasoning_effort: "xhigh" })).toEqual({ includeThoughts: true, thinkingLevel: "XHIGH" });
		expect(level("gemini-4-hydrogen", { reasoning_effort: "minimal" })).toEqual({ includeThoughts: true, thinkingLevel: "LOW" });
		expect(level(flash, {}, { thinkingBudget: 512 })).toEqual({ includeThoughts: true, thinkingLevel: "MINIMAL" });
		expect(level(flash, {}, { thinkingBudget: 2000 })).toEqual({ includeThoughts: true, thinkingLevel: "LOW" });
		expect(level(flash, {}, { thinkingBudget: 8000 })).toEqual({ includeThoughts: true, thinkingLevel: "MEDIUM" });
		expect(level(flash, {}, { thinkingBudget: 30000 })).toEqual({ includeThoughts: true, thinkingLevel: "HIGH" });
		expect(level(flash, {})).toBeUndefined();
		expect(level(flash, { reasoning_effort: null })).toBeUndefined();
		const dropped = [];
		expect(ask({ model: flash, reasoning_effort: "toString" }, {}, dropped).generationConfig).toBeUndefined();
		expect(dropped).toEqual(["reasoning_effort"]);
		expect(level("gemini-2.5-pro", { reasoning_effort: "high" })).toEqual({ includeThoughts: true, thinkingBudget: 24576 });
		expect(level("gemini-pro", { reasoning_effort: "high" })).toEqual({ includeThoughts: true, thinkingBudget: 24576 });
		expect(level("gemma-3", { reasoning_effort: "high" })).toEqual({ includeThoughts: true, thinkingBudget: 24576 });
		expect(level("alias", { reasoning_effort: "low" }, { model: flash })).toEqual({ includeThoughts: true, thinkingLevel: "LOW" });
	});

	it("maps response_format to a MIME type and a JSON Schema", () => {
		const format = (response_format, dropped = []) => ask({ response_format }, {}, dropped).generationConfig;
		expect(format({ type: "json_object" })).toEqual({ responseMimeType: "application/json" });
		expect(format({ type: "json_schema", json_schema: { name: "o", schema: { type: "object" } } })).toEqual({
			responseMimeType: "application/json",
			responseJsonSchema: { type: "object" }
		});
		expect(format({ type: "json_schema", json_schema: { name: "o" } })).toEqual({ responseMimeType: "application/json" });
		expect(format({ type: "text" })).toBeUndefined();
		expect(format(null)).toBeUndefined();
		const dropped = [];
		expect(format({ type: "xml" }, dropped)).toBeUndefined();
		expect(dropped).toEqual(["response_format"]);
	});
});

describe("chatBody: thought signatures", () => {
	const detail = (extra) => ({ type: "reasoning.encrypted", format: FORMAT, index: 0, ...extra });

	it("sends each signature back on the part it came from", () => {
		const dropped = [];
		const out = chatBody(
			{
				messages: [
					{ role: "user", content: "x" },
					{
						role: "assistant",
						content: [
							{ type: "text", text: "a" },
							{ type: "text", text: "b" }
						],
						reasoning: "kept out",
						reasoning_details: [
							detail({ data: "T", for: "text" }),
							detail({ data: "C1", for: "call", id: "c1" }),
							detail({ data: "", for: "call", id: "c2" }),
							detail({ data: "X", for: "call" }),
							{ type: "reasoning.text", format: "anthropic-claude-v1", text: "t", signature: "s" },
							null
						],
						tool_calls: [
							{ id: "c1", type: "function", function: { name: "Read", arguments: "{}" } },
							{ id: "c2", type: "function", function: { name: "Read", arguments: "{}" } }
						]
					},
					{ role: "assistant", content: "", reasoning_details: [detail({ data: "T", for: "text" })] }
				],
				tools: [tool]
			},
			{ dropped }
		);
		expect(out.contents[1].parts).toEqual([
			{ text: "a" },
			{ text: "b", thoughtSignature: "T" },
			{ functionCall: { id: "c1", name: "Read", args: {} }, thoughtSignature: "C1" },
			{ functionCall: { id: "c2", name: "Read", args: {} } }
		]);
		expect(out.contents).toHaveLength(2);
		expect(dropped).toEqual([]);
	});

	it("a first function call with no signature gets Google's placeholder, once per model turn, and a real signature is kept", () => {
		const call = (id) => ({ id, type: "function", function: { name: "Read", arguments: "{}" } });
		const out = chatBody(
			{
				messages: [
					{ role: "user", content: "x" },
					{ role: "assistant", content: "", tool_calls: [call("a"), call("b")] },
					{ role: "tool", tool_call_id: "a", content: "1" },
					{ role: "tool", tool_call_id: "b", content: "2" },
					{ role: "assistant", content: "", tool_calls: [call("c")], reasoning_details: [detail({ data: "REAL", for: "call", id: "c" })] },
					{ role: "tool", tool_call_id: "c", content: "3" }
				],
				tools: [tool]
			},
			{}
		);
		const calls = out.contents.filter((entry) => entry.role === "model").map((entry) => entry.parts.map((part) => part.thoughtSignature));
		expect(calls).toEqual([[SKIP_SIGNATURE, undefined], ["REAL"]]);
		expect(SKIP_SIGNATURE).toBe("skip_thought_signature_validator");
		const plain = chatBody({ messages: [{ role: "assistant", content: "", tool_calls: [call("a")] }] });
		expect(JSON.stringify(plain)).not.toContain(SKIP_SIGNATURE);
	});

	it("notes reasoning text it has no signature for, and ignores details that are not its own", () => {
		const dropped = [];
		chatBody({ messages: [{ role: "assistant", content: "x", reasoning_content: "why", reasoning_details: "nope" }] }, { dropped });
		expect(dropped).toEqual(["reasoning"]);
	});
});

describe("finishOf, usageOf and folded", () => {
	it("maps the finish reasons", () => {
		expect(finishOf(undefined, false)).toBe("stop");
		expect(finishOf("STOP", false)).toBe("stop");
		expect(finishOf("STOP", true)).toBe("tool_calls");
		expect(finishOf("FINISH_REASON_UNSPECIFIED", false)).toBe("stop");
		expect(finishOf("MAX_TOKENS", true)).toBe("length");
		for (const reason of ["SAFETY", "RECITATION", "LANGUAGE", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "IMAGE_SAFETY"]) {
			expect(finishOf(reason, false), reason).toBe("content_filter");
		}
		for (const reason of ["MALFORMED_FUNCTION_CALL", "OTHER", "MISSING_THOUGHT_SIGNATURE", "SOMETHING_NEW", "toString"]) {
			expect(finishOf(reason, false), reason).toBe("error");
		}
	});

	it("counts cached tokens in the prompt, thinking tokens in the completion", () => {
		expect(usageOf(undefined)).toBeUndefined();
		expect(usageOf({})).toBeUndefined();
		expect(usageOf({ promptTokenCount: 10, candidatesTokenCount: 4 })).toEqual({
			prompt_tokens: 10,
			completion_tokens: 4,
			total_tokens: 14
		});
		expect(
			usageOf({
				promptTokenCount: 20,
				toolUsePromptTokenCount: 2,
				candidatesTokenCount: 4,
				thoughtsTokenCount: 5,
				cachedContentTokenCount: 8
			})
		).toEqual({
			prompt_tokens: 22,
			completion_tokens: 9,
			total_tokens: 31,
			prompt_tokens_details: { cached_tokens: 8 },
			completion_tokens_details: { reasoning_tokens: 5 }
		});
		expect(usageOf({ candidatesTokenCount: 3 })).toMatchObject({ prompt_tokens: 0, completion_tokens: 3 });
		expect(folded(undefined)).toBeUndefined();
		expect(folded({ promptTokenCount: 20, candidatesTokenCount: 4, thoughtsTokenCount: 5, cachedContentTokenCount: 8 })).toEqual({
			input_tokens: 12,
			output_tokens: 9,
			cache_read_input_tokens: 8,
			cache_creation_input_tokens: 0
		});
		expect(folded({ promptTokenCount: 1, candidatesTokenCount: 1 })).toMatchObject({ input_tokens: 1, cache_read_input_tokens: 0 });
	});
});

describe("completion", () => {
	const reply = (parts, extra = {}) => ({
		candidates: [{ index: 0, content: { role: "model", parts }, finishReason: "STOP", ...extra }],
		usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 }
	});

	it("joins text, splits thoughts, makes tool calls and carries signatures", () => {
		const out = completion(
			reply([
				{ text: "plan", thought: true },
				{ text: "Hello " },
				{ text: "world", thoughtSignature: "T" },
				{ functionCall: { id: "fc1", name: "Read", args: { path: "a" } }, thoughtSignature: "C" },
				{ functionCall: { name: "Read" } },
				{ inlineData: { mimeType: "image/png", data: PNG } },
				null
			]),
			{ model: "asked", reasoningField: "reasoning_content" }
		);
		expect(out).toMatchObject({ object: "chat.completion", model: "asked", usage: { prompt_tokens: 3, completion_tokens: 4 } });
		const message = out.choices[0].message;
		expect(message).toMatchObject({ role: "assistant", content: "Hello world", reasoning_content: "plan" });
		expect(message.tool_calls[0]).toEqual({ id: "fc1", type: "function", function: { name: "Read", arguments: '{"path":"a"}' } });
		expect(message.tool_calls[1].id).toMatch(/^call_/);
		expect(message.tool_calls[1].function.arguments).toBe("{}");
		expect(message.reasoning_details).toEqual([
			{ type: "reasoning.encrypted", format: FORMAT, index: 0, data: "T", for: "text" },
			{ type: "reasoning.encrypted", format: FORMAT, index: 1, data: "C", for: "call", id: "fc1" }
		]);
		expect(out.choices[0].finish_reason).toBe("tool_calls");
		expect(completion(reply([{ text: "x" }])).choices[0].message.content).toBe("x");
		expect(completion(reply([{ text: "x" }])).model).toBeUndefined();
	});

	it("reads every candidate, an empty one and one filtered with its own explanation", () => {
		const out = completion({
			candidates: [
				{ content: { parts: [{ text: "a" }] }, finishReason: "MAX_TOKENS" },
				{ index: 5, finishReason: "SAFETY", finishMessage: "not allowed" },
				{ finishReason: "RECITATION" },
				{ content: { parts: "nope" } }
			]
		});
		expect(out.choices.map((choice) => [choice.index, choice.finish_reason, choice.message.refusal])).toEqual([
			[0, "length", undefined],
			[5, "content_filter", "not allowed"],
			[2, "content_filter", "Gemini blocked the reply (RECITATION)."],
			[3, "stop", undefined]
		]);
		expect(out.usage).toBeUndefined();
	});

	it("a blocked prompt is a filtered, empty reply, and a reply with nothing at all is an error", () => {
		const blocked = completion({ promptFeedback: { blockReason: "SAFETY", blockReasonMessage: "unsafe prompt" } });
		expect(blocked.choices).toEqual([
			{ index: 0, message: { role: "assistant", content: "", refusal: "unsafe prompt" }, finish_reason: "content_filter" }
		]);
		expect(completion({ candidates: [], promptFeedback: { blockReason: "OTHER" } }).choices[0].message.refusal).toBe(
			"Gemini blocked the prompt (OTHER)."
		);
		for (const bad of [{}, null, { candidates: [] }, { promptFeedback: {} }]) {
			expect(() => completion(bad)).toThrow(/no message/);
		}
	});
});

describe("createChunker", () => {
	const chunk = (parts, extra = {}, more = {}) => ({ candidates: [{ index: 0, content: { role: "model", parts }, ...extra }], ...more });

	it("streams text, thoughts and a whole function call, one id, then the usage chunk", () => {
		const chunker = createChunker({ model: "asked", reasoningField: "reasoning_content" });
		const out = [
			...chunker.event(chunk([{ text: "think", thought: true }, { text: "Hel" }])),
			...chunker.event(
				chunk([
					{ text: "lo", thoughtSignature: "T" },
					{ text: "" },
					{ functionCall: { name: "Read", args: { p: 1 } }, thoughtSignature: "C" }
				])
			),
			...chunker.event(
				chunk(
					[{ functionCall: { id: "fc2", name: "Read" } }],
					{ finishReason: "STOP" },
					{ usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } }
				)
			)
		];
		expect(chunker.finished()).toBe(true);
		expect(new Set(out.map((entry) => entry.id)).size).toBe(1);
		expect(out[0].choices[0].delta).toEqual({ role: "assistant", content: "" });
		const deltas = out.filter((entry) => entry.choices.length > 0).map((entry) => entry.choices[0].delta);
		expect(deltas.filter((delta) => delta.reasoning_content).map((delta) => delta.reasoning_content)).toEqual(["think"]);
		expect(deltas.filter((delta) => delta.content).map((delta) => delta.content)).toEqual(["Hel", "lo"]);
		expect(deltas.filter((delta) => delta.reasoning_details).map((delta) => delta.reasoning_details[0])).toEqual([
			{ type: "reasoning.encrypted", format: FORMAT, index: 0, data: "T", for: "text" },
			expect.objectContaining({ index: 1, data: "C", for: "call", id: expect.stringMatching(/^call_/) })
		]);
		const calls = deltas.flatMap((delta) => delta.tool_calls ?? []);
		expect(calls.map((call) => call.index)).toEqual([0, 1]);
		expect(calls[0]).toMatchObject({ type: "function", function: { name: "Read", arguments: '{"p":1}' } });
		expect(calls[1]).toMatchObject({ id: "fc2", function: { arguments: "{}" } });
		expect(out.find((entry) => entry.choices[0]?.finish_reason).choices[0].finish_reason).toBe("tool_calls");
		expect(out.at(-1)).toMatchObject({ choices: [], model: "asked", usage: { prompt_tokens: 5, completion_tokens: 2 } });
		expect(chunker.usage()).toEqual({ promptTokenCount: 5, candidatesTokenCount: 2 });
	});

	it("sends the usage once, even when it arrives after the finish, and not when it is not asked for", () => {
		const late = createChunker();
		expect(late.event(chunk([{ text: "a" }], { finishReason: "STOP" }))).toHaveLength(3);
		const more = late.event({ usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } });
		expect(more).toHaveLength(1);
		expect(more[0].usage).toEqual({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 });
		expect(late.event({ usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 9 } })).toEqual([]);
		const quiet = createChunker({ includeUsage: false });
		expect(
			quiet
				.event(chunk([{ text: "a" }], { finishReason: "STOP" }, { usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } }))
				.some((entry) => entry.usage)
		).toBe(false);
	});

	it("ends with a refusal when the reply is filtered, and with an error finish for a failure", () => {
		const filtered = createChunker();
		const out = filtered.event(chunk([], { finishReason: "SAFETY", finishMessage: "no" }));
		expect(out.map((entry) => entry.choices[0].delta.refusal ?? entry.choices[0].finish_reason)).toEqual([null, "no", "content_filter"]);
		const failed = createChunker();
		const end = failed.event(chunk([], { finishReason: "MALFORMED_FUNCTION_CALL" }));
		expect(end.at(-1).choices[0].finish_reason).toBe("error");
		expect(failed.finished()).toBe(true);
	});

	it("a blocked prompt ends the reply, and an error object in the stream is one error chunk", () => {
		const blocked = createChunker();
		const out = blocked.event({ promptFeedback: { blockReason: "SAFETY" } });
		expect(out.map((entry) => entry.choices[0].delta.refusal ?? entry.choices[0].finish_reason)).toEqual([
			null,
			"Gemini blocked the prompt (SAFETY).",
			"content_filter"
		]);
		expect(blocked.finished()).toBe(true);
		const throttled = createChunker();
		expect(throttled.event({ error: { code: 429, message: "slow", status: "RESOURCE_EXHAUSTED" } })).toEqual([
			{ error: { message: "slow", type: "invalid_request_error", param: null, code: 429 } }
		]);
		expect(throttled.finished()).toBe(true);
		expect(createChunker().event({ error: { message: "boom" } })[0].error).toMatchObject({ type: "server_error", code: 500 });
	});

	it("ignores other candidates and chunks it has nothing to say about", () => {
		const chunker = createChunker();
		expect(chunker.event({ candidates: [{ index: 1, content: { parts: [{ text: "other" }] }, finishReason: "STOP" }] })).toEqual([]);
		expect(chunker.event({ candidates: "nope" })).toEqual([]);
		expect(chunker.event({ promptFeedback: {} })).toEqual([]);
		expect(chunker.event(chunk("nope"))).toEqual([]);
		expect(chunker.event({ candidates: [{ content: { parts: [{ text: "no index" }] } }] })).toHaveLength(2);
		expect(chunker.event(null)).toEqual([]);
		expect(chunker.event("[DONE]")).toEqual([]);
		expect(chunker.finished()).toBe(false);
		expect(chunker.event(chunk([{ text: "x" }]))).toHaveLength(1);
	});
});

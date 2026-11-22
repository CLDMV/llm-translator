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
				logit_bias: { 1: 5 }
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
		expect(dropped).toEqual(["messages.other", "logit_bias"]);
		expect(chatBody({ messages: [{ role: "user", content: "x" }], max_tokens: 3, stop: ["a", "b"], n: 3 }).generationConfig).toEqual({
			maxOutputTokens: 3,
			stopSequences: ["a", "b"],
			candidateCount: 3
		});
		expect(chatBody({ messages: [{ role: "user", content: "x" }], n: 1, temperature: null, stop: null }).generationConfig).toBeUndefined();
		expect(chatBody({}).contents).toEqual([]);
		const quiet = [];
		chatBody({ messages: [], metadata: { a: 1 }, store: true, service_tier: "auto", user: "u", stream_options: {} }, { dropped: quiet });
		expect(quiet).toEqual([]);
		expect(
			chatBody({
				messages: [
					{ role: "user", content: null },
					{ role: "user", content: 5 }
				]
			}).contents
		).toEqual([]);
	});

	it("sends images, files and audio as bytes or as references, and says so when it cannot send one", () => {
		const dropped = [];
		const out = chatBody(
			{
				messages: [
					{
						role: "user",
						content: [
							{ type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } },
							{ type: "image_url", image_url: `data:image/jpeg;base64,${PNG}` },
							{ type: "image_url", image_url: { url: "https://example.com/a.png?sig=1" } },
							{ type: "image_url" },
							{ type: "image_url", image_url: { url: `data:image/gif;base64,${PNG}` } },
							{ type: "image_url", image_url: { url: `data:application/pdf;base64,${PNG}` } },
							{ type: "image_url", image_url: { url: "https://example.com/image" } },
							{ type: "image_url", image_url: { url: "https://example.com/a.gif" } },
							{ type: "image_url", image_url: { url: "gs://bucket/o.webp" } },
							{ type: "image_url", image_url: { url: "https://generativelanguage.googleapis.com/v1beta/files/abc" } },
							{ type: "image_url", image_url: { url: "https://example.com/doc", mime_type: "application/pdf" } },
							{ type: "image_url", image_url: { url: "https://example.com/x", mime_type: "image/gif" } },
							{ type: "image_url", image_url: { url: "ftp://example.com/a.png" } },
							{ type: "file", file: { file_data: `data:application/pdf;base64,${PNG}` } },
							{ type: "file", file: { file_id: "https://example.com/a.pdf" } },
							{ type: "file", file: { file_id: "https://www.youtube.com/watch?v=abc" } },
							{ type: "file", file: { file_id: "f" } },
							{ type: "file" },
							{ type: "input_audio", input_audio: { data: "QUJD", format: "MP3" } },
							{ type: "input_audio", input_audio: { data: "QUJD" } },
							{ type: "input_audio", input_audio: { data: "QUJD", format: "xyz" } },
							{ type: "input_audio", input_audio: {} },
							{}
						]
					}
				]
			},
			{ dropped }
		);
		const note = expect.stringMatching(/Gemini cannot read it/);
		expect(out.contents[0].parts).toEqual([
			{ inlineData: { mimeType: "image/png", data: PNG } },
			{ inlineData: { mimeType: "image/jpeg", data: PNG } },
			{ fileData: { fileUri: "https://example.com/a.png?sig=1", mimeType: "image/png" } },
			{ text: note },
			{ text: note },
			{ inlineData: { mimeType: "application/pdf", data: PNG } },
			{ fileData: { fileUri: "https://example.com/image", mimeType: "image/jpeg" } },
			{ text: note },
			{ fileData: { fileUri: "gs://bucket/o.webp", mimeType: "image/webp" } },
			{ fileData: { fileUri: "https://generativelanguage.googleapis.com/v1beta/files/abc" } },
			{ fileData: { fileUri: "https://example.com/doc", mimeType: "application/pdf" } },
			{ text: note },
			{ text: note },
			{ inlineData: { mimeType: "application/pdf", data: PNG } },
			{ fileData: { fileUri: "https://example.com/a.pdf", mimeType: "application/pdf" } },
			{ fileData: { fileUri: "https://www.youtube.com/watch?v=abc" } },
			{ inlineData: { mimeType: "audio/mp3", data: "QUJD" } },
			{ inlineData: { mimeType: "audio/wav", data: "QUJD" } },
			{ inlineData: { mimeType: "audio/xyz", data: "QUJD" } }
		]);
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

	it("gives each tool schema as Gemini takes it, and leaves it out when the tool takes nothing", () => {
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
						parameters: {
							$schema: "x",
							type: "object",
							properties: { v: { type: "string", pattern: "^a", default: "a" } },
							additionalProperties: false
						}
					}
				},
				{ type: "function", function: { name: "f", parameters: { oneOf: [{ type: "string" }] } } }
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

	it("maps tool_choice to the calling mode, and allowed_tools to a mode or to the tools it lists", () => {
		const two = [tool, { type: "function", function: { name: "Write", parameters: { type: "object" } } }];
		const ask = (tool_choice, dropped = []) =>
			chatBody({ messages: [{ role: "user", content: "x" }], tools: two, tool_choice }, { dropped });
		const call = (tool_choice, dropped) => ask(tool_choice, dropped).toolConfig;
		expect(call("required")).toEqual({ functionCallingConfig: { mode: "ANY" } });
		expect(call("none")).toEqual({ functionCallingConfig: { mode: "NONE" } });
		expect(call({ type: "function", function: { name: "Read" } })).toEqual({
			functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["Read"] }
		});
		expect(call("auto")).toBeUndefined();
		expect(call(undefined)).toBeUndefined();
		const only = (mode) => ({
			type: "allowed_tools",
			allowed_tools: { mode, tools: [{ type: "function", function: { name: "Read" } }, {}, null] }
		});
		expect(call(only("required"))).toEqual({ functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["Read"] } });
		expect(call(only("auto"))).toBeUndefined();
		expect(ask(only("auto")).tools[0].functionDeclarations.map((entry) => entry.name)).toEqual(["Read"]);
		expect(ask(only("required")).tools[0].functionDeclarations).toHaveLength(2);
		const bare = ask({ type: "allowed_tools" });
		expect(bare.tools).toBeUndefined();
		expect(bare.toolConfig).toBeUndefined();
		const dropped = [];
		expect(call({ type: "weird" }, dropped)).toBeUndefined();
		expect(dropped).toEqual(["tool_choice"]);
		expect(chatBody({ messages: [], tool_choice: "required" }).toolConfig).toBeUndefined();
	});

	it("adds the built-in tools of the setting and of the request, with or without function tools", () => {
		const gemini = { tools: [{ googleSearch: {} }], builtin: [{ codeExecution: {} }] };
		const mixed = chatBody({ messages: [{ role: "user", content: "x" }], tools: [tool] }, { gemini });
		expect(mixed.tools.map((entry) => Object.keys(entry)[0])).toEqual(["functionDeclarations", "googleSearch", "codeExecution"]);
		const alone = chatBody({ messages, tool_choice: "required" }, { gemini });
		expect(alone.tools).toEqual([{ googleSearch: {} }, { codeExecution: {} }]);
		expect(alone.toolConfig).toBeUndefined();
		expect(JSON.stringify(alone.contents)).not.toContain("functionCall");
		expect(chatBody({ messages: [{ role: "user", content: "x" }] }, { gemini: { builtin: [{ urlContext: {} }] } }).tools).toEqual([
			{ urlContext: {} }
		]);
	});
});

describe("chatBody: thinking", () => {
	const ask = (extra, context, dropped = []) => chatBody({ messages: [{ role: "user", content: "x" }], ...extra }, { dropped, ...context });
	const thinking = (model, extra, context) => ask({ model, ...extra }, context).generationConfig?.thinkingConfig;

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

	it("keeps a budget inside the range of its 2.5 family: Pro cannot be switched off, Flash-Lite thinks in at least 512 tokens", () => {
		expect(thinking("gemini-2.5-pro", { reasoning_effort: "none" })).toEqual({ thinkingBudget: 128 });
		expect(thinking("gemini-2.5-pro", { reasoning_effort: "minimal" })).toEqual({ includeThoughts: true, thinkingBudget: 512 });
		expect(thinking("gemini-2.5-pro", {}, { thinkingBudget: 50 })).toEqual({ includeThoughts: true, thinkingBudget: 128 });
		expect(thinking("gemini-2.5-pro", {}, { thinkingBudget: 0 })).toEqual({ includeThoughts: true, thinkingBudget: 128 });
		expect(thinking("gemini-2.5-pro", {}, { thinkingBudget: 99999 })).toEqual({ includeThoughts: true, thinkingBudget: 32768 });
		expect(thinking("models/gemini-2.5-flash-lite", { reasoning_effort: "none" })).toEqual({ thinkingBudget: 512 });
		expect(thinking("gemini-2.5-flash-lite", {}, { thinkingBudget: 100 })).toEqual({ includeThoughts: true, thinkingBudget: 512 });
		expect(thinking("gemini-2.5-flash", { reasoning_effort: "none" })).toEqual({ thinkingBudget: 0 });
		expect(thinking("gemini-2.5-flash", {}, { thinkingBudget: 30000 })).toEqual({ includeThoughts: true, thinkingBudget: 24576 });
		expect(thinking("gemini-2.5-flash-preview-05-20", {}, { thinkingBudget: 30000 })).toEqual({
			includeThoughts: true,
			thinkingBudget: 24576
		});
		expect(thinking("gemini-2.5-flashy", {}, { thinkingBudget: 30000 })).toEqual({ includeThoughts: true, thinkingBudget: 30000 });
	});

	it("asks for dynamic thinking: a budget of -1, or the model's own default level", () => {
		expect(thinking("gemini-2.5-flash", {}, { thinkingDynamic: true })).toEqual({ includeThoughts: true, thinkingBudget: -1 });
		expect(thinking("gemini-2.5-pro", { reasoning_effort: "dynamic" })).toEqual({ includeThoughts: true, thinkingBudget: -1 });
		expect(thinking("gemini-3-flash-preview", {}, { thinkingDynamic: true })).toEqual({ includeThoughts: true });
		expect(thinking("gemini-3-flash-preview", { reasoning_effort: "dynamic" })).toEqual({ includeThoughts: true });
	});

	it("a Gemini 3 model gets a thinking level, moved to one the model has, and never a budget", () => {
		const flash = "gemini-3-flash-preview";
		const level = (model, extra, context) => thinking(model, extra, context);
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

	it("the gemini.thinking setting says what a model that is not recognized by its name takes", () => {
		const control = (thinking_, model, extra = { reasoning_effort: "medium" }) =>
			thinking(model, extra, { gemini: { thinking: thinking_ } });
		expect(control("level", "my-tuned-model")).toEqual({ includeThoughts: true, thinkingLevel: "MEDIUM" });
		expect(control("level", "gemini-exp-1206")).toEqual({ includeThoughts: true, thinkingLevel: "MEDIUM" });
		expect(control("level", "gemini-2.0-flash")).toEqual({ includeThoughts: true, thinkingLevel: "MEDIUM" });
		expect(control("budget", "gemini-3-flash-preview")).toEqual({ includeThoughts: true, thinkingBudget: 8192 });
		expect(control("auto", "my-tuned-model")).toEqual({ includeThoughts: true, thinkingBudget: 8192 });
		expect(control("auto", "gemini-2.0-flash")).toEqual({ includeThoughts: true, thinkingBudget: 8192 });
	});
});

describe("chatBody: structured output, logprobs, modalities, audio and the settings", () => {
	const ask = (extra, context, dropped = []) => chatBody({ messages: [{ role: "user", content: "x" }], ...extra }, { dropped, ...context });

	it("maps response_format to a MIME type and a JSON Schema as Gemini takes it", () => {
		const format = (response_format, dropped = []) => ask({ response_format }, {}, dropped).generationConfig;
		expect(format({ type: "json_object" })).toEqual({ responseMimeType: "application/json" });
		expect(
			format({ type: "json_schema", json_schema: { name: "o", schema: { $schema: "x", type: "object", oneOf: [{ type: "string" }] } } })
		).toEqual({
			responseMimeType: "application/json",
			responseJsonSchema: { type: "object", anyOf: [{ type: "string" }] }
		});
		expect(format({ type: "json_schema", json_schema: { name: "o" } })).toEqual({ responseMimeType: "application/json" });
		expect(format({ type: "text" })).toBeUndefined();
		expect(format(null)).toBeUndefined();
		const dropped = [];
		expect(format({ type: "xml" }, dropped)).toBeUndefined();
		expect(dropped).toEqual(["response_format"]);
	});

	it("maps logprobs and top_logprobs", () => {
		const config = (extra, dropped = []) => ask(extra, {}, dropped).generationConfig;
		expect(config({ logprobs: true })).toEqual({ responseLogprobs: true });
		expect(config({ logprobs: true, top_logprobs: 5 })).toEqual({ responseLogprobs: true, logprobs: 5 });
		expect(config({ logprobs: true, top_logprobs: 99 })).toEqual({ responseLogprobs: true, logprobs: 20 });
		expect(config({ logprobs: true, top_logprobs: -3 })).toEqual({ responseLogprobs: true, logprobs: 0 });
		expect(config({ logprobs: true, top_logprobs: "x" })).toEqual({ responseLogprobs: true });
		expect(config({ logprobs: false })).toBeUndefined();
		expect(config({ logprobs: null })).toBeUndefined();
		const dropped = [];
		expect(config({ logprobs: "yes" }, dropped)).toBeUndefined();
		expect(dropped).toEqual(["logprobs"]);
	});

	it("maps modalities, audio output and the image model default", () => {
		const config = (extra, context, dropped = []) => ask(extra, context, dropped).generationConfig;
		expect(config({ modalities: ["text", "image"] })).toEqual({ responseModalities: ["TEXT", "IMAGE"] });
		const dropped = [];
		expect(config({ modalities: ["text", "video"] }, {}, dropped)).toEqual({ responseModalities: ["TEXT"] });
		expect(config({ modalities: ["video"] }, {}, dropped)).toBeUndefined();
		expect(dropped).toEqual(["modalities"]);
		expect(config({ model: "gemini-2.5-flash-image" })).toEqual({ responseModalities: ["TEXT", "IMAGE"] });
		expect(config({ model: "gemini-2.5-flash" })).toBeUndefined();
		expect(config({ model: "x" }, { model: "gemini-3-pro-image-preview" })).toEqual({ responseModalities: ["TEXT", "IMAGE"] });
		expect(config({ model: "gemini-2.5-flash-image", modalities: ["image"] })).toEqual({ responseModalities: ["IMAGE"] });
		expect(config({ audio: { voice: "Kore", format: "wav" } })).toEqual({
			responseModalities: ["AUDIO"],
			speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } }
		});
		expect(config({ modalities: ["text", "audio"], audio: { format: "pcm16" } })).toEqual({ responseModalities: ["TEXT", "AUDIO"] });
		expect(config({ audio: { voice: "", format: "PCM" } })).toEqual({ responseModalities: ["AUDIO"] });
		expect(config({ audio: {} }, { gemini: { responseModalities: ["TEXT", "AUDIO"] } })).toEqual({ responseModalities: ["TEXT", "AUDIO"] });
		expect(() => ask({ audio: { format: "aac" } })).toThrow(/audio\.format/);
		expect(chatBody({ messages: [], audio: null }).generationConfig).toBeUndefined();
	});

	it("sends the settings: modalities, image and speech config, media resolution, safety settings", () => {
		const safety = [{ category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" }];
		const out = ask(
			{ audio: { voice: "Puck" } },
			{
				gemini: {
					responseModalities: ["TEXT"],
					imageConfig: { aspectRatio: "1:1" },
					speechConfig: { languageCode: "en-US" },
					mediaResolution: "MEDIA_RESOLUTION_LOW",
					safetySettings: safety
				}
			}
		);
		expect(out.generationConfig).toEqual({
			responseModalities: ["TEXT"],
			imageConfig: { aspectRatio: "1:1" },
			speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
			mediaResolution: "MEDIA_RESOLUTION_LOW"
		});
		expect(out.safetySettings).toEqual(safety);
		expect(ask({}, { gemini: { safetySettings: [], speechConfig: { a: 1 } } }).safetySettings).toBeUndefined();
		expect(ask({}, { gemini: { speechConfig: { a: 1 } } }).generationConfig).toEqual({ speechConfig: { a: 1 } });
	});

	it("a cached content replaces what it holds: the system instruction, the tools and the tool config", () => {
		const dropped = [];
		const out = chatBody(
			{
				messages: [
					{ role: "system", content: "s" },
					{ role: "user", content: "x" }
				],
				tools: [tool],
				tool_choice: "required"
			},
			{ dropped, gemini: { cachedContent: "cachedContents/abc" } }
		);
		expect(out.cachedContent).toBe("cachedContents/abc");
		expect(out.systemInstruction).toBeUndefined();
		expect(out.tools).toBeUndefined();
		expect(out.toolConfig).toBeUndefined();
		expect(dropped).toEqual(["systemInstruction", "tools", "toolConfig"]);
		const bare = [];
		expect(chatBody({ messages: [{ role: "user", content: "x" }] }, { dropped: bare, gemini: { cachedContent: "c" } })).toEqual({
			contents: [{ role: "user", parts: [{ text: "x" }] }],
			cachedContent: "c"
		});
		expect(bare).toEqual([]);
	});
});

describe("chatBody: thought signatures", () => {
	const detail = (extra) => ({ type: "reasoning.encrypted", format: FORMAT, index: 0, ...extra });
	const assistant = (extra) =>
		chatBody({
			messages: [
				{ role: "user", content: "x" },
				{ role: "assistant", ...extra }
			]
		}).contents[1]?.parts;

	it("sends each signature back on the part it came from, and the first call of a turn with none gets the placeholder", () => {
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

	it("puts a signature where its part ended in the text, counted from the end, so trimmed text still lines up", () => {
		expect(
			assistant({
				content: "ABCDEF",
				reasoning_details: [detail({ data: "S1", for: "text", rest: 3 }), detail({ data: "S2", for: "text", rest: 0 })]
			})
		).toEqual([
			{ text: "ABC", thoughtSignature: "S1" },
			{ text: "DEF", thoughtSignature: "S2" }
		]);
		expect(assistant({ content: "ABCDEF", reasoning_details: [detail({ data: "S", for: "text", rest: 2 })] })).toEqual([
			{ text: "ABCD", thoughtSignature: "S" },
			{ text: "EF" }
		]);
		expect(assistant({ content: "CDEF", reasoning_details: [detail({ data: "S", for: "text", rest: 2 })] })).toEqual([
			{ text: "CD", thoughtSignature: "S" },
			{ text: "EF" }
		]);
		expect(assistant({ content: "AB", reasoning_details: [detail({ data: "S", for: "text", rest: 9 })] })).toEqual([
			{ text: "", thoughtSignature: "S" },
			{ text: "AB" }
		]);
		expect(
			assistant({
				content: [
					{ type: "text", text: "AB" },
					{ type: "text", text: "CD" }
				],
				reasoning_details: [detail({ data: "S", for: "text", rest: 0 }), detail({ data: "Z", for: "text", rest: -1 })]
			})
		).toEqual([{ text: "ABCD", thoughtSignature: "S" }]);
		expect(assistant({ content: "", reasoning_details: [detail({ data: "S", for: "text", rest: 0 })] })).toBeUndefined();
	});

	it("sends a signed thought back as a thought part and leaves unsigned thought text out", () => {
		expect(assistant({ content: "A", reasoning: "think", reasoning_details: [detail({ data: "TH", for: "thought", rest: 0 })] })).toEqual([
			{ text: "think", thought: true, thoughtSignature: "TH" },
			{ text: "A" }
		]);
		expect(assistant({ content: "A", reasoning: "onetwo", reasoning_details: [detail({ data: "TH", for: "thought", rest: 3 })] })).toEqual([
			{ text: "one", thought: true, thoughtSignature: "TH" },
			{ text: "A" }
		]);
		expect(
			assistant({ content: "A", reasoning_content: "think", reasoning_details: [detail({ data: "S", for: "text", rest: 0 })] })
		).toEqual([{ text: "A", thoughtSignature: "S" }]);
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
			expect(finishOf(reason, false), reason).toBe("stop");
			expect(finishOf(reason, true), reason).toBe("tool_calls");
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

describe("cache creation tokens", () => {
	const meta = { promptTokenCount: 1600, candidatesTokenCount: 5, cachedContentTokenCount: 1500 };

	it("reports what a request wrote as cache_write_tokens, out of the cached count, and as creation in the Anthropic shape", () => {
		expect(usageOf(meta)).toMatchObject({ prompt_tokens: 1600, prompt_tokens_details: { cached_tokens: 1500 } });
		expect(usageOf(meta, 1500)).toEqual({
			prompt_tokens: 1600,
			completion_tokens: 5,
			total_tokens: 1605,
			prompt_tokens_details: { cache_write_tokens: 1500 }
		});
		expect(usageOf(meta, 1000).prompt_tokens_details).toEqual({ cached_tokens: 500, cache_write_tokens: 1000 });
		expect(usageOf({ promptTokenCount: 5, candidatesTokenCount: 1 }, 7).prompt_tokens_details).toEqual({ cache_write_tokens: 7 });
		expect(folded(meta, 1500)).toEqual({
			input_tokens: 100,
			output_tokens: 5,
			cache_read_input_tokens: 0,
			cache_creation_input_tokens: 1500
		});
		expect(folded(meta)).toMatchObject({ cache_read_input_tokens: 1500, cache_creation_input_tokens: 0 });
	});

	it("puts them on a completion and on the stream's usage chunk", () => {
		const reply = { candidates: [{ content: { parts: [{ text: "x" }] }, finishReason: "STOP" }], usageMetadata: meta };
		expect(completion(reply, { cacheCreated: 1500 }).usage.prompt_tokens_details).toEqual({ cache_write_tokens: 1500 });
		const chunker = createChunker({ cacheCreated: 1500 });
		const out = chunker.event({ ...reply });
		expect(out.at(-1).usage.prompt_tokens_details).toEqual({ cache_write_tokens: 1500 });
	});
});

describe("completion", () => {
	const reply = (parts, extra = {}) => ({
		candidates: [{ index: 0, content: { role: "model", parts }, finishReason: "STOP", ...extra }],
		usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 }
	});

	it("joins text, splits thoughts, makes tool calls and carries signatures with where they were", () => {
		const out = completion(
			reply([
				{ text: "plan", thought: true, thoughtSignature: "TH" },
				{ text: "Hello " },
				{ text: "world", thoughtSignature: "T" },
				{ functionCall: { id: "fc1", name: "Read", args: { path: "a" } }, thoughtSignature: "C" },
				{ functionCall: { name: "Read" } },
				{ inlineData: { mimeType: "video/mp4", data: "AAAA" } },
				{ inlineData: { mimeType: "image/png" } },
				{ inlineData: { data: "AAAA" } },
				{ fileData: { fileUri: "x" } },
				{ thoughtSignature: "" },
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
		expect(message.images).toBeUndefined();
		expect(message.reasoning_details).toEqual([
			{ type: "reasoning.encrypted", format: FORMAT, index: 0, data: "TH", for: "thought", rest: 0 },
			{ type: "reasoning.encrypted", format: FORMAT, index: 1, data: "T", for: "text", rest: 0 },
			{ type: "reasoning.encrypted", format: FORMAT, index: 2, data: "C", for: "call", id: "fc1" }
		]);
		expect(out.choices[0].finish_reason).toBe("tool_calls");
		expect(completion(reply([{ text: "x" }])).choices[0].message.content).toBe("x");
		expect(completion(reply([{ text: "x" }])).model).toBeUndefined();
	});

	it("counts the text that follows a signed part, so it can be put back where it was", () => {
		const out = completion(reply([{ text: "ab", thoughtSignature: "S" }, { text: "cd" }]));
		expect(out.choices[0].message.reasoning_details).toEqual([
			{ type: "reasoning.encrypted", format: FORMAT, index: 0, data: "S", for: "text", rest: 2 }
		]);
	});

	it("keeps only the first function call without parallel calls", () => {
		const parts = [
			{ functionCall: { id: "a", name: "Read" }, thoughtSignature: "A" },
			{ functionCall: { id: "b", name: "Read" }, thoughtSignature: "B" }
		];
		const kept = completion(reply(parts), { parallel: false }).choices[0].message;
		expect(kept.tool_calls.map((call) => call.id)).toEqual(["a"]);
		expect(kept.reasoning_details.map((item) => item.data)).toEqual(["A"]);
		expect(completion(reply(parts), { parallel: true }).choices[0].message.tool_calls).toHaveLength(2);
	});

	it("writes code and its output as fenced blocks in the text", () => {
		const out = completion(
			reply([
				{ text: "Let me compute." },
				{ executableCode: { language: "PYTHON", code: "print(1)" } },
				{ codeExecutionResult: { outcome: "OUTCOME_OK", output: "1" } },
				{ executableCode: { language: "LANGUAGE_UNSPECIFIED", code: "x" } },
				{ executableCode: {} },
				{ codeExecutionResult: { outcome: "OUTCOME_FAILED", output: "boom" } },
				{ codeExecutionResult: {} }
			])
		);
		expect(out.choices[0].message.content).toBe(
			"Let me compute.\n```python\nprint(1)\n```\n\n```text\n1\n```\n\n```\nx\n```\n\n```\n\n```\n\n```text (failed)\nboom\n```\n\n```text\n\n```\n"
		);
	});

	it("returns generated images as images, or as markdown in the text for a front that has no place for them", () => {
		const parts = [{ text: "here" }, { inlineData: { mimeType: "image/png", data: "AAAA" } }];
		const message = completion(reply(parts)).choices[0].message;
		expect(message.images).toEqual([{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }]);
		expect(message.content).toBe("here");
		const text = completion(reply(parts), { images: "text" }).choices[0].message;
		expect(text.images).toBeUndefined();
		expect(text.content).toBe("here\n\n![image](data:image/png;base64,AAAA)");
		expect(
			completion(reply([{ inlineData: { mimeType: "image/png", data: "AAAA" } }]), { images: "text" }).choices[0].message.content
		).toBe("![image](data:image/png;base64,AAAA)");
	});

	it("returns audio as a WAV file, or as the raw PCM, from every audio part", () => {
		const parts = [
			{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=16000", data: Buffer.from([1, 2, 3, 4]).toString("base64") } },
			{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=16000", data: Buffer.from([5, 6]).toString("base64") } }
		];
		const wav = completion(reply(parts)).choices[0].message.audio;
		expect(wav).toMatchObject({ id: expect.stringMatching(/^audio_/), expires_at: 0, transcript: "" });
		const bytes = Buffer.from(wav.data, "base64");
		expect(bytes.subarray(0, 4).toString()).toBe("RIFF");
		expect(bytes.subarray(8, 12).toString()).toBe("WAVE");
		expect(bytes.readUInt32LE(24)).toBe(16000);
		expect(bytes.readUInt32LE(40)).toBe(6);
		expect([...bytes.subarray(44)]).toEqual([1, 2, 3, 4, 5, 6]);
		const raw = completion(reply(parts), { audio: "pcm16" }).choices[0].message.audio;
		expect([...Buffer.from(raw.data, "base64")]).toEqual([1, 2, 3, 4, 5, 6]);
		expect([...Buffer.from(completion(reply(parts), { audio: "pcm" }).choices[0].message.audio.data, "base64")]).toHaveLength(6);
		const defaulted = completion(reply([{ inlineData: { mimeType: "audio/wav", data: "AAAA" } }]), { audio: "wav" }).choices[0].message
			.audio;
		expect(Buffer.from(defaulted.data, "base64").readUInt32LE(24)).toBe(24000);
	});

	it("returns log probabilities", () => {
		const out = completion(
			reply([{ text: "hi" }], {
				logprobsResult: {
					chosenCandidates: [{ token: "h", tokenId: 1, logProbability: -0.1 }, { token: "i" }, null],
					topCandidates: [
						{
							candidates: [
								{ token: "h", logProbability: -0.1 },
								{ token: "j", logProbability: -2 }
							]
						},
						{ candidates: "x" }
					]
				}
			})
		);
		expect(out.choices[0].logprobs).toEqual({
			content: [
				{
					token: "h",
					logprob: -0.1,
					bytes: [104],
					top_logprobs: [
						{ token: "h", logprob: -0.1, bytes: [104] },
						{ token: "j", logprob: -2, bytes: [106] }
					]
				},
				{ token: "i", logprob: 0, bytes: [105], top_logprobs: [] },
				{ token: "", logprob: 0, bytes: [], top_logprobs: [] }
			],
			refusal: null
		});
		expect(completion(reply([{ text: "hi" }], { logprobsResult: { chosenCandidates: [] } })).choices[0].logprobs).toBeUndefined();
		expect(completion(reply([{ text: "hi" }], { logprobsResult: {} })).choices[0].logprobs).toBeUndefined();
		const bare = completion(reply([{ text: "hi" }], { logprobsResult: { chosenCandidates: [{ token: "a", logProbability: -1 }] } }));
		expect(bare.choices[0].logprobs.content[0].top_logprobs).toEqual([]);
	});

	it("ends a reply that stopped for another reason with what it has and a note, not a failure", () => {
		const note = (extra, parts = [{ text: "partial" }]) => completion(reply(parts, extra)).choices[0];
		const message = note({ finishReason: "MALFORMED_FUNCTION_CALL", finishMessage: "bad call" });
		expect(message).toMatchObject({
			finish_reason: "stop",
			message: { content: "partial\n\n[Gemini ended the reply early (MALFORMED_FUNCTION_CALL): bad call]" }
		});
		expect(note({ finishReason: "OTHER" }, []).message.content).toBe("[Gemini ended the reply early (OTHER)]");
		expect(note({ finishReason: "NEW_REASON", finishMessage: "" }, []).message.content).toBe("[Gemini ended the reply early (NEW_REASON)]");
		expect(note({ finishReason: "TOO_MANY_TOOL_CALLS" }, [{ functionCall: { id: "a", name: "R" } }])).toMatchObject({
			finish_reason: "tool_calls"
		});
		expect(note({ finishReason: "STOP" }).message.content).toBe("partial");
		expect(note({ finishReason: undefined }).message.content).toBe("partial");
		expect(note({ finishReason: "MAX_TOKENS" })).toMatchObject({ finish_reason: "length", message: { content: "partial" } });
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

	it("streams text, thoughts and a whole function call, one id, the signatures at the end, then the usage chunk", () => {
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
		const calls = deltas.flatMap((delta) => delta.tool_calls ?? []);
		expect(calls.map((call) => call.index)).toEqual([0, 1]);
		expect(calls[0]).toMatchObject({ type: "function", function: { name: "Read", arguments: '{"p":1}' } });
		expect(calls[1]).toMatchObject({ id: "fc2", function: { arguments: "{}" } });
		const signatures = deltas.flatMap((delta) => delta.reasoning_details ?? []);
		expect(signatures).toEqual([
			{ type: "reasoning.encrypted", format: FORMAT, index: 0, data: "T", for: "text", rest: 0 },
			{ type: "reasoning.encrypted", format: FORMAT, index: 1, data: "C", for: "call", id: calls[0].id }
		]);
		// The signatures come after the text, in the chunk before the finish chunk.
		const at = out.findIndex((entry) => entry.choices[0]?.delta?.reasoning_details);
		expect(out[at + 1].choices[0].finish_reason).toBe("tool_calls");
		expect(out.at(-1)).toMatchObject({ choices: [], model: "asked", usage: { prompt_tokens: 5, completion_tokens: 2 } });
		expect(chunker.usage()).toEqual({ promptTokenCount: 5, candidatesTokenCount: 2 });
	});

	it("streams several candidates with their own index, tool calls and finish, and ends when every one has", () => {
		const chunker = createChunker({ candidates: 2 });
		const first = chunker.event({
			candidates: [
				{ index: 0, content: { parts: [{ text: "a" }] } },
				{ index: 1, content: { parts: [{ functionCall: { id: "x", name: "R" } }] } },
				{ index: 2, content: { parts: [{ text: "ignored" }] }, finishReason: "STOP" }
			]
		});
		expect(first.map((entry) => entry.choices[0].index)).toEqual([0, 0, 1, 1]);
		expect(chunker.finished()).toBe(false);
		const second = chunker.event({
			candidates: [{ index: 0, finishReason: "STOP" }],
			usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }
		});
		expect(second.map((entry) => entry.choices[0]?.finish_reason)).toEqual(["stop"]);
		expect(chunker.finished()).toBe(false);
		const third = chunker.event({
			candidates: [
				{ index: 1, finishReason: "STOP" },
				{ index: 0, content: { parts: [{ text: "late" }] } }
			]
		});
		expect(third.map((entry) => [entry.choices[0]?.index, entry.choices[0]?.finish_reason])).toEqual([
			[1, "tool_calls"],
			[undefined, undefined]
		]);
		expect(third.at(-1).usage).toEqual({ prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 });
		expect(chunker.finished()).toBe(true);
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

	it("ends with a refusal when the reply is filtered, and with a note and a normal finish for another reason", () => {
		const filtered = createChunker();
		const out = filtered.event(chunk([], { finishReason: "SAFETY", finishMessage: "no" }));
		expect(out.map((entry) => entry.choices[0].delta.refusal ?? entry.choices[0].finish_reason)).toEqual([null, "no", "content_filter"]);
		const odd = createChunker();
		const end = odd.event(chunk([{ text: "so far" }], { finishReason: "MALFORMED_FUNCTION_CALL", finishMessage: "bad call" }));
		expect(end.at(-1).choices[0].finish_reason).toBe("stop");
		expect(end.find((entry) => entry.choices[0].delta.content?.includes("ended the reply early")).choices[0].delta.content).toBe(
			"\n\n[Gemini ended the reply early (MALFORMED_FUNCTION_CALL): bad call]"
		);
		expect(odd.finished()).toBe(true);
		const bare = createChunker();
		expect(bare.event(chunk([], { finishReason: "OTHER" })).find((entry) => entry.choices[0].delta.content).choices[0].delta.content).toBe(
			"[Gemini ended the reply early (OTHER)]"
		);
	});

	it("streams log probabilities, generated images and audio, and keeps only the first call without parallel calls", () => {
		const chunker = createChunker({ images: "images", audio: "wav", parallel: false });
		const out = [
			...chunker.event(
				chunk(
					[
						{ inlineData: { mimeType: "image/png", data: "AAAA" } },
						{ inlineData: { mimeType: "audio/L16;rate=24000", data: "AQI=" } },
						{ functionCall: { id: "a", name: "R" } },
						{ functionCall: { id: "b", name: "R" } }
					],
					{
						logprobsResult: { chosenCandidates: [{ token: "x", logProbability: -1 }] }
					}
				)
			),
			...chunker.event(chunk([], { finishReason: "STOP" }))
		];
		expect(out.find((entry) => entry.choices[0].delta.images).choices[0].delta.images[0].image_url.url).toBe("data:image/png;base64,AAAA");
		expect(out.flatMap((entry) => entry.choices[0]?.delta?.tool_calls ?? []).map((call) => call.id)).toEqual(["a"]);
		expect(out.find((entry) => entry.choices[0].logprobs).choices[0].logprobs.content[0].token).toBe("x");
		const audio = out.find((entry) => entry.choices[0].delta.audio).choices[0].delta.audio;
		expect(Buffer.from(audio.data, "base64").subarray(0, 4).toString()).toBe("RIFF");
		const text = createChunker({ images: "text", audio: "pcm16" });
		const second = [
			...text.event(
				chunk(
					[{ inlineData: { mimeType: "image/png", data: "AAAA" } }, { inlineData: { mimeType: "audio/L16;rate=24000", data: "AQI=" } }],
					{ finishReason: "STOP" }
				)
			)
		];
		expect(second.find((entry) => entry.choices[0].delta.content?.includes("![image]")).choices[0].delta.content).toBe(
			"![image](data:image/png;base64,AAAA)"
		);
		expect([...Buffer.from(second.find((entry) => entry.choices[0].delta.audio).choices[0].delta.audio.data, "base64")]).toEqual([1, 2]);
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
		expect(throttled.event({ usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } })).toEqual([]);
		expect(createChunker().event({ error: { message: "boom" } })[0].error).toMatchObject({ type: "server_error", code: 500 });
	});

	it("ignores chunks it has nothing to say about, and a candidate that already ended", () => {
		const chunker = createChunker();
		expect(chunker.event({ candidates: [{ index: 1, content: { parts: [{ text: "other" }] }, finishReason: "STOP" }] })).toEqual([]);
		expect(chunker.event({ candidates: "nope" })).toEqual([]);
		expect(chunker.event({ promptFeedback: {} })).toEqual([]);
		expect(chunker.event(chunk("nope"))).toEqual([]);
		expect(chunker.event(null)).toEqual([]);
		expect(chunker.event("[DONE]")).toEqual([]);
		expect(chunker.finished()).toBe(false);
		expect(chunker.event({ candidates: [{ content: { parts: [{ text: "no index" }] } }] })).toHaveLength(2);
		expect(chunker.event(chunk([{ text: "x" }]))).toHaveLength(1);
		chunker.event(chunk([], { finishReason: "STOP" }));
		expect(chunker.event(chunk([{ text: "after the end" }]))).toEqual([]);
	});
});

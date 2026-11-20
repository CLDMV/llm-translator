/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/converse.test.vitest.mjs
 *	@Date: 2026-11-19T09:00:00-08:00 (1795107600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-19T09:00:00-08:00 (1795107600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Chat Completions to and from Amazon Bedrock's Converse API: the request body, the reply, usage, stop reasons and the stream chunker.
 */
import { describe, expect, it } from "vitest";
import { chatBody, completion, createChunker, finishOf, folded, usageOf } from "../../src/lib/converse.mjs";

const PNG = "iVBORw0KGgo=";

describe("chatBody", () => {
	it("maps text, system and developer messages, sampling and the output cap", () => {
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
					}
				],
				max_tokens: 100,
				temperature: 0.2,
				top_p: 0.9,
				stop: "END"
			},
			{ dropped }
		);
		expect(out).toEqual({
			system: [{ text: "be brief" }, { text: "be kind" }],
			messages: [
				{ role: "user", content: [{ text: "hi" }] },
				{ role: "assistant", content: [{ text: "hello" }] },
				{ role: "user", content: [{ text: "again" }] }
			],
			inferenceConfig: { maxTokens: 100, temperature: 0.2, topP: 0.9, stopSequences: ["END"] }
		});
		expect(dropped).toEqual([]);
		expect(chatBody({ messages: [], max_completion_tokens: 7, max_tokens: 9, stop: ["a", "b"] }).inferenceConfig).toEqual({
			maxTokens: 7,
			stopSequences: ["a", "b"]
		});
		expect(chatBody({ messages: [], max_tokens: null, temperature: null, top_p: null, stop: null })).toEqual({ messages: [] });
	});

	it("sends base64 images as bytes, and replaces anything else with a note", () => {
		const dropped = [];
		const out = chatBody(
			{
				messages: [
					{
						role: "user",
						content: [
							{ type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } },
							{ type: "image_url", image_url: { url: `data:image/jpg;base64,${PNG}` } },
							{ type: "image_url", image_url: `data:image/webp;base64,${PNG}` },
							{ type: "image_url", image_url: { url: "https://example.com/a.png" } },
							{ type: "image_url", image_url: { url: `data:image/svg;base64,${PNG}` } },
							{ type: "image_url" },
							{ type: "audio" },
							{}
						]
					}
				]
			},
			{ dropped }
		);
		const [png, jpg, webp, url, svg, none] = out.messages[0].content;
		expect(png).toEqual({ image: { format: "png", source: { bytes: PNG } } });
		expect(jpg.image.format).toBe("jpeg");
		expect(webp.image.format).toBe("webp");
		for (const note of [url, svg, none]) expect(note.text).toMatch(/Converse accepts base64 PNG/);
		expect(dropped).toEqual(["image_url", "content.audio", "content.part"]);
	});

	it("maps tool calls and results, merging consecutive messages of one role", () => {
		const out = chatBody({
			tools: [{ type: "function", function: { name: "Read" } }],
			messages: [
				{ role: "user", content: "read it" },
				{
					role: "assistant",
					content: "",
					tool_calls: [
						{ id: "t1", type: "function", function: { name: "Read", arguments: '{"path":"a"}' } },
						{ id: "t2", type: "function", function: { name: "Read", arguments: "not json" } },
						{ id: "t3", type: "function" }
					]
				},
				{ role: "tool", tool_call_id: "t1", content: "file a" },
				{ role: "tool", tool_call_id: "t2", content: [{ type: "text", text: "file b" }] },
				{ role: "tool", tool_call_id: "t3", content: "" },
				{ role: "user", content: "thanks" }
			]
		});
		expect(out.messages).toEqual([
			{ role: "user", content: [{ text: "read it" }] },
			{
				role: "assistant",
				content: [
					{ toolUse: { toolUseId: "t1", name: "Read", input: { path: "a" } } },
					{ toolUse: { toolUseId: "t2", name: "Read", input: { _raw_arguments: "not json" } } },
					{ toolUse: { toolUseId: "t3", name: undefined, input: {} } }
				]
			},
			{
				role: "user",
				content: [
					{ toolResult: { toolUseId: "t1", content: [{ text: "file a" }] } },
					{ toolResult: { toolUseId: "t2", content: [{ text: "file b" }] } },
					{ toolResult: { toolUseId: "t3", content: [{ text: "(no output)" }] } },
					{ text: "thanks" }
				]
			}
		]);
	});

	it("marks a failed tool result by the marker and strips the marker", () => {
		const tools = [{ type: "function", function: { name: "Read" } }];
		const out = chatBody(
			{
				tools,
				messages: [
					{ role: "tool", tool_call_id: "a", content: "[error] file missing" },
					{ role: "tool", tool_call_id: "b", content: "[error] " },
					{ role: "tool", tool_call_id: "c", content: "[error] but no marker given" },
					{ role: "tool", tool_call_id: "d", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${PNG}` } }] }
				]
			},
			{ marker: "[error] " }
		);
		const [a, b, c, d] = out.messages[0].content.map((block) => block.toolResult);
		expect(a).toEqual({ toolUseId: "a", content: [{ text: "file missing" }], status: "error" });
		expect(b.status).toBe("error");
		expect(b.content).toEqual([{ text: "(no output)" }]);
		expect(c.status).toBe("error");
		expect(d.status).toBeUndefined();
		const plain = chatBody({ tools, messages: [{ role: "tool", tool_call_id: "a", content: "[error] x" }] });
		expect(plain.messages[0].content[0].toolResult).toEqual({ toolUseId: "a", content: [{ text: "[error] x" }] });
	});

	it("maps tools and tool_choice, and names what has no equivalent", () => {
		const tools = [
			{
				type: "function",
				function: { name: "A", description: "first", parameters: { type: "object", properties: { x: { type: "string" } } } }
			},
			{ type: "function", function: { name: "B" } }
		];
		const spec = chatBody({ messages: [], tools, tool_choice: "auto" }).toolConfig;
		expect(spec).toEqual({
			tools: [
				{ toolSpec: { name: "A", description: "first", inputSchema: { json: { type: "object", properties: { x: { type: "string" } } } } } },
				{ toolSpec: { name: "B", inputSchema: { json: { type: "object", properties: {} } } } }
			]
		});
		expect(chatBody({ messages: [], tools, tool_choice: "required" }).toolConfig.toolChoice).toEqual({ any: {} });
		expect(chatBody({ messages: [], tools, tool_choice: { type: "function", function: { name: "A" } } }).toolConfig.toolChoice).toEqual({
			tool: { name: "A" }
		});
		expect(chatBody({ messages: [], tools }).toolConfig.toolChoice).toBeUndefined();
		const dropped = [];
		expect(chatBody({ messages: [], tools, tool_choice: "weird" }, { dropped }).toolConfig.toolChoice).toBeUndefined();
		expect(dropped).toEqual(["tool_choice"]);
		const none = [];
		const forbidden = chatBody({ messages: [{ role: "user", content: "hi" }], tools, tool_choice: "none" }, { dropped: none });
		expect(forbidden.toolConfig.tools).toHaveLength(2);
		expect(forbidden.toolConfig.toolChoice).toBeUndefined();
		expect(forbidden.system).toEqual([{ text: expect.stringMatching(/Do not call any tools/) }]);
		expect(none).toEqual([]);
		const withSystem = chatBody({ messages: [{ role: "system", content: "be brief" }], tools, tool_choice: "none" });
		expect(withSystem.system.map((block) => block.text)).toEqual(["be brief", expect.stringMatching(/Do not call any tools/)]);
		expect(chatBody({ messages: [], tool_choice: "none" }).toolConfig).toBeUndefined();
		expect(chatBody({ messages: [], tools: [] }).toolConfig).toBeUndefined();
	});

	it("puts top_k, the sampling extensions and a thinking budget in additionalModelRequestFields, the request winning", () => {
		const out = chatBody({ messages: [], top_k: 40 }, { sampling: { top_k: 5, min_p: 0.1 }, thinkingBudget: 2048 });
		expect(out.additionalModelRequestFields).toEqual({ top_k: 40, min_p: 0.1, thinking: { type: "enabled", budget_tokens: 2048 } });
		expect(chatBody({ messages: [], top_k: null }).additionalModelRequestFields).toBeUndefined();
		expect(chatBody({ messages: [] }, { sampling: { seed: 3 } }).additionalModelRequestFields).toEqual({ seed: 3 });
	});

	it("names what Converse has no field for, once, and stays quiet about client plumbing", () => {
		const dropped = [];
		const out = chatBody(
			{
				messages: [
					{ role: "user", content: "a" },
					{ role: "assistant", content: "b", reasoning: "thinking it over" },
					{ role: "assistant", content: "c", reasoning: "" },
					{ role: "function", content: "x" },
					{ role: "function", content: "y" },
					{ role: "user", content: [] }
				],
				response_format: { type: "json_object" },
				parallel_tool_calls: false,
				seed: 1,
				n: 2,
				stream_options: { include_usage: true },
				user: "u",
				metadata: {},
				store: false,
				service_tier: "auto"
			},
			{ dropped }
		);
		expect(dropped).toEqual(["reasoning", "messages.function", "response_format", "parallel_tool_calls", "seed", "n"]);
		expect(out.messages).toHaveLength(2);
		const single = [];
		chatBody({ messages: [], n: 1 }, { dropped: single });
		expect(single).toEqual([]);
		expect(chatBody({ messages: "nope" })).toEqual({ messages: [] });
	});
});

describe("tool history without tools", () => {
	const history = [
		{ role: "user", content: "read a" },
		{
			role: "assistant",
			content: "",
			tool_calls: [
				{ id: "t1", type: "function", function: { name: "Read", arguments: '{"path":"a"}' } },
				{ id: "t2", type: "function", function: { name: "Grep", arguments: "{}" } }
			]
		},
		{ role: "tool", tool_call_id: "t1", content: "file a" },
		{ role: "tool", tool_call_id: "t2", content: "[error] no match" },
		{ role: "tool", tool_call_id: "gone", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] },
		{ role: "user", content: "thanks" }
	];

	it("writes past tool calls and results as text, and sends no toolConfig", () => {
		const out = chatBody({ messages: history }, { marker: "[error] " });
		expect(out.toolConfig).toBeUndefined();
		expect(JSON.stringify(out)).not.toMatch(/toolUse|toolResult/);
		expect(out.messages.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
		expect(out.messages[1].content.map((block) => block.text)).toEqual([
			'[Called tool Read with input {"path":"a"}]',
			"[Called tool Grep with input {}]"
		]);
		expect(out.messages[2].content.map((block) => block.text)).toEqual([
			"[Result of tool Read: file a]",
			"[Tool Grep failed: no match]",
			"[Result of tool call: [image]]",
			"thanks"
		]);
	});

	it("an empty tools list counts as no tools", () => {
		expect(chatBody({ messages: history, tools: [], tool_choice: "none" }).toolConfig).toBeUndefined();
	});
});

describe("finishOf, usageOf and folded", () => {
	it("maps every stop reason", () => {
		const table = {
			end_turn: "stop",
			stop_sequence: "stop",
			max_tokens: "length",
			model_context_window_exceeded: "length",
			tool_use: "tool_calls",
			content_filtered: "content_filter",
			guardrail_intervened: "content_filter",
			malformed_model_output: "error",
			malformed_tool_use: "error",
			brand_new: "stop"
		};
		for (const [reason, finish] of Object.entries(table)) expect(finishOf(reason, false), reason).toBe(finish);
		expect(finishOf(undefined, false)).toBe("stop");
		expect(finishOf("end_turn", true)).toBe("tool_calls");
		expect(finishOf("max_tokens", true)).toBe("length");
	});

	it("counts the cache reads and writes in the prompt, and reports cached tokens", () => {
		expect(usageOf({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })).toEqual({
			prompt_tokens: 10,
			completion_tokens: 5,
			total_tokens: 15
		});
		expect(usageOf({ inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 20, cacheWriteInputTokens: 3 })).toEqual({
			prompt_tokens: 33,
			completion_tokens: 5,
			total_tokens: 38,
			prompt_tokens_details: { cached_tokens: 20 }
		});
		expect(usageOf({ outputTokens: 5 })).toEqual({ prompt_tokens: 0, completion_tokens: 5, total_tokens: 5 });
		expect(usageOf({ inputTokens: 4 })).toEqual({ prompt_tokens: 4, completion_tokens: 0, total_tokens: 4 });
		expect(usageOf({})).toBeUndefined();
		expect(usageOf(undefined)).toBeUndefined();
	});

	it("folds the counts into Anthropic usage", () => {
		expect(folded({ inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 20, cacheWriteInputTokens: 3 })).toEqual({
			input_tokens: 10,
			output_tokens: 5,
			cache_read_input_tokens: 20,
			cache_creation_input_tokens: 3
		});
		expect(folded({ outputTokens: 5 })).toEqual({
			input_tokens: 0,
			output_tokens: 5,
			cache_read_input_tokens: 0,
			cache_creation_input_tokens: 0
		});
		expect(folded(undefined)).toBeUndefined();
	});
});

describe("completion", () => {
	it("reads text, reasoning, tool calls, the stop reason and usage", () => {
		const out = completion(
			{
				output: {
					message: {
						role: "assistant",
						content: [
							{ reasoningContent: { reasoningText: { text: "hmm", signature: "sig" } } },
							{ reasoningContent: { redactedContent: "AAAA" } },
							{ text: "Hello" },
							{ text: " world" },
							{ toolUse: { toolUseId: "t1", name: "Read", input: { path: "a" } } },
							{ toolUse: { toolUseId: "t2", name: "Noop" } },
							null
						]
					}
				},
				stopReason: "tool_use",
				usage: { inputTokens: 3, outputTokens: 4 }
			},
			{ reasoningField: "reasoning_content", model: "claude" }
		);
		expect(out).toMatchObject({
			object: "chat.completion",
			model: "claude",
			usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
			choices: [
				{
					index: 0,
					finish_reason: "tool_calls",
					message: {
						role: "assistant",
						content: "Hello world",
						reasoning_content: "hmm",
						tool_calls: [
							{ id: "t1", type: "function", function: { name: "Read", arguments: '{"path":"a"}' } },
							{ id: "t2", type: "function", function: { name: "Noop", arguments: "{}" } }
						]
					}
				}
			]
		});
		expect(out.id).toMatch(/^chatcmpl-/);
	});

	it("a plain reply has no reasoning, tool calls or usage, and defaults the reasoning field", () => {
		const out = completion({ output: { message: { content: [{ text: "hi" }] } }, stopReason: "end_turn" });
		expect(out.choices[0].message).toEqual({ role: "assistant", content: "hi" });
		expect(out.usage).toBeUndefined();
		expect(
			completion({ output: { message: { content: [{ reasoningContent: { reasoningText: { text: "r" } } }] } } }).choices[0].message
				.reasoning
		).toBe("r");
	});

	it("rejects a reply without a message", () => {
		for (const reply of [{}, undefined, { output: {} }, { output: { message: { content: "text" } } }]) {
			expect(() => completion(reply)).toThrow(/contained no message/);
		}
	});
});

describe("createChunker", () => {
	const run = (list, options) => {
		const chunker = createChunker(options);
		return { chunker, chunks: list.flatMap(([name, data]) => chunker.event(name, data)) };
	};

	it("turns a text reply into chunks with one id, a finish chunk and a usage chunk", () => {
		const { chunker, chunks } = run(
			[
				["messageStart", { role: "assistant" }],
				["contentBlockDelta", { contentBlockIndex: 0, delta: { text: "Hel" } }],
				["contentBlockDelta", { contentBlockIndex: 0, delta: { text: "lo" } }],
				["contentBlockDelta", { contentBlockIndex: 0, delta: { text: "" } }],
				["contentBlockStop", { contentBlockIndex: 0 }],
				["messageStop", { stopReason: "end_turn" }],
				["metadata", { usage: { inputTokens: 5, outputTokens: 2 }, metrics: { latencyMs: 9 } }]
			],
			{ model: "m" }
		);
		expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(1);
		expect(chunks.map((chunk) => chunk.choices[0]?.delta ?? "usage")).toEqual([
			{ role: "assistant", content: "" },
			{ content: "Hel" },
			{ content: "lo" },
			{},
			"usage"
		]);
		expect(chunks[3].choices[0].finish_reason).toBe("stop");
		expect(chunks[4]).toMatchObject({ choices: [], model: "m", usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } });
		expect(chunker.finished()).toBe(true);
		expect(chunker.usage()).toEqual({ inputTokens: 5, outputTokens: 2 });
	});

	it("streams a tool call in pieces under its own index, and the reasoning in its field", () => {
		const { chunks } = run(
			[
				["contentBlockDelta", { contentBlockIndex: 0, delta: { reasoningContent: { text: "think" } } }],
				["contentBlockDelta", { contentBlockIndex: 0, delta: { reasoningContent: { signature: "sig" } } }],
				["contentBlockDelta", { contentBlockIndex: 0, delta: { reasoningContent: { text: "" } } }],
				["contentBlockStart", { contentBlockIndex: 1, start: { text: {} } }],
				["contentBlockStart", { contentBlockIndex: 2, start: { toolUse: { toolUseId: "t1", name: "Read" } } }],
				["contentBlockDelta", { contentBlockIndex: 2, delta: { toolUse: { input: '{"pa' } } }],
				["contentBlockDelta", { contentBlockIndex: 2, delta: { toolUse: { input: 'th":"a"}' } } }],
				["contentBlockStart", { contentBlockIndex: 3, start: { toolUse: { toolUseId: "t2", name: "Grep" } } }],
				["contentBlockDelta", { contentBlockIndex: 3, delta: { toolUse: { input: "{}" } } }],
				["messageStop", { stopReason: "tool_use" }]
			],
			{ reasoningField: "reasoning_content" }
		);
		const deltas = chunks.map((chunk) => chunk.choices[0].delta);
		expect(deltas[0]).toEqual({ role: "assistant", content: "" });
		expect(deltas[1]).toEqual({ reasoning_content: "think" });
		expect(deltas[2]).toEqual({ tool_calls: [{ index: 0, id: "t1", type: "function", function: { name: "Read", arguments: "" } }] });
		expect(deltas[3]).toEqual({ tool_calls: [{ index: 0, function: { arguments: '{"pa' } }] });
		expect(deltas[4]).toEqual({ tool_calls: [{ index: 0, function: { arguments: 'th":"a"}' } }] });
		expect(deltas[5].tool_calls[0]).toMatchObject({ index: 1, id: "t2" });
		expect(deltas[6]).toEqual({ tool_calls: [{ index: 1, function: { arguments: "{}" } }] });
		expect(chunks.at(-1).choices[0].finish_reason).toBe("tool_calls");
	});

	it("leaves out the usage chunk when asked, and for a metadata event without counts", () => {
		expect(run([["metadata", { usage: { inputTokens: 1, outputTokens: 1 } }]], { includeUsage: false }).chunks).toEqual([]);
		expect(run([["metadata", {}]], {}).chunks).toEqual([]);
		expect(run([["metadata", undefined]], {}).chunks).toEqual([]);
	});

	it("turns a failure message into an error chunk and ends the reply", () => {
		const { chunker, chunks } = run([["error", { type: "error", error: { type: "rate_limit_error", message: "slow down" } }]]);
		expect(chunks).toEqual([{ error: { message: "slow down", type: "rate_limit_error", param: null, code: 429 } }]);
		expect(chunker.finished()).toBe(true);
		expect(run([["error", undefined]]).chunks[0].error.message).toBeUndefined();
	});

	it("ignores events it has no use for, and tolerates events without data", () => {
		const { chunker, chunks } = run([
			["unknownEvent", {}],
			["contentBlockStart", undefined],
			["contentBlockDelta", undefined],
			["contentBlockDelta", { delta: {} }],
			["messageStop", undefined]
		]);
		expect(chunks.map((chunk) => chunk.choices[0].delta)).toEqual([{ role: "assistant", content: "" }, {}]);
		expect(chunks[1].choices[0].finish_reason).toBe("stop");
		expect(chunker.finished()).toBe(true);
	});

	it("is not finished before messageStop", () => {
		expect(run([["messageStart", {}]]).chunker.finished()).toBe(false);
	});
});

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/convert/anthropic-to-openai-request.test.vitest.mjs
 *	@Date: 2026-10-25T12:22:53-07:00 (1792956173)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:03-07:00 (1792958343)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { describe, expect, test } from "vitest";
import { request } from "../../src/api/convert/anthropic/messages/to/openai/chat/request.mjs";
import { pdfBase64 } from "../helpers/pdf.mjs";
import { claudeCode } from "../helpers/fixtures.mjs";
import { composeApi } from "../helpers/api.mjs";

const base = (extra = {}) => ({ model: "qwen3-coder", max_tokens: 100, messages: [{ role: "user", content: "hi" }], ...extra });
const convert = async (body, settings) => (await request(body, settings)).body;
const tool = (name, extra = {}) => ({ name, description: `${name} tool`, input_schema: { type: "object", properties: {} }, ...extra });

describe("captured Claude Code traffic", () => {
	test("trivial prompt: billing header stripped, inline system folded into the user turn", async () => {
		const { body, state } = await request(claudeCode("a_trivial-1"));
		expect(body.model).toBe("claude-opus-5-5");
		expect(body.max_completion_tokens).toBe(128000);
		expect(body.stream).toBe(true);
		expect(body.stream_options).toEqual({ include_usage: true });
		const continuous = await convert(claudeCode("a_trivial-1"), { continuousUsage: true });
		expect(continuous.stream_options).toEqual({ include_usage: true, continuous_usage_stats: true });
		expect(body.messages.map((m) => m.role)).toEqual(["system", "user"]);
		expect(body.messages[0].content).not.toContain("x-anthropic-billing-header");
		expect(body.messages[0].content.startsWith("You are a Claude agent")).toBe(true);
		expect(typeof body.messages[1].content).toBe("string");
		expect(body.messages[1].content).toContain("<system-reminder>");
		expect(body.messages[1].content.trimEnd().endsWith("</system-reminder>")).toBe(true);
		expect(body.tools).toHaveLength(12);
		expect(body.tools[0]).toMatchObject({ type: "function", function: { name: expect.any(String), parameters: { type: "object" } } });
		expect(body.tools[0].function.parameters.$schema).toBeDefined();
		expect(body).not.toHaveProperty("metadata");
		expect(body).not.toHaveProperty("chat_template_kwargs");
		expect(body).not.toHaveProperty("reasoning_effort");
		expect(state).toMatchObject({
			front: "anthropic",
			model: "claude-opus-5-5",
			stream: true,
			thinking: "adaptive",
			toolNames: {},
			dropped: []
		});
		expect(() => JSON.stringify(state)).not.toThrow();
	});

	test("tool loop: tool_use becomes tool_calls, tool_result becomes a tool message, trailing system folds into a user turn", async () => {
		const { body } = await request(claudeCode("b_tool-2"));
		expect(body.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "user"]);
		const assistant = body.messages[2];
		expect(assistant.content).toBe("");
		expect(assistant.tool_calls).toHaveLength(1);
		const call = assistant.tool_calls[0];
		expect(call).toMatchObject({ id: expect.stringMatching(/^toolu_/), type: "function", function: { name: "Read" } });
		expect(JSON.parse(call.function.arguments)).toHaveProperty("file_path");
		expect(body.messages[3]).toMatchObject({ role: "tool", tool_call_id: call.id, content: expect.any(String) });
		expect(body.messages[4].content).toMatch(/^<system-reminder>/);
		// The first user turn absorbed the string-content inline system message too.
		expect(body.messages[1].content).toContain("# Environment");
	});

	test("image tool result moves the image into a following user message", async () => {
		const { body } = await request(claudeCode("f_image-2"));
		const roles = body.messages.map((m) => m.role);
		expect(roles).toEqual(["system", "user", "assistant", "tool", "user"]);
		expect(body.messages[3].content).toBe("(image output attached in the next message)");
		const followUp = body.messages[4].content;
		expect(followUp[0]).toMatchObject({ type: "text", text: expect.stringContaining("Image output of tool call") });
		expect(followUp[1]).toEqual({ type: "image_url", image_url: { url: expect.stringMatching(/^data:image\/png;base64,iVBOR/) } });
		expect(followUp.at(-1).type).toBe("text");
		const text = await request(claudeCode("f_image-2"), { images: false });
		expect(text.body.messages[3].content).toBe("[An image was omitted because this model does not accept images.]");
		expect(text.state.dropped).toEqual(["image"]);
		const twice = await request(
			base({
				messages: [
					{
						role: "user",
						content: [
							{ type: "image", source: { type: "url", url: "u" } },
							{ type: "image", source: { type: "url", url: "u" } }
						]
					}
				]
			}),
			{ images: false }
		);
		expect(twice.state.dropped).toEqual(["image"]);
	});

	test("replayed thinking becomes the reasoning field", async () => {
		const fixture = claudeCode("g_thinkback-2");
		const { body, state } = await request(fixture);
		const assistant = body.messages.find((m) => m.role === "assistant");
		expect(assistant.reasoning).toEqual(expect.any(String));
		expect(assistant).not.toHaveProperty("reasoning_content");
		expect(JSON.stringify(body)).not.toContain("SIGFAKE123");
		expect(state.reasoningField).toBe("reasoning");
		const legacy = await request(fixture, { reasoningField: "reasoning_content" });
		expect(legacy.body.messages.find((m) => m.role === "assistant").reasoning_content).toBe(assistant.reasoning);
	});

	test("effort and thinking: adaptive leaves the template alone, effort maps only when enabled", async () => {
		const fixture = claudeCode("d_effort-1");
		expect(fixture.output_config.effort).toBe("high");
		expect((await convert(fixture)).reasoning_effort).toBeUndefined();
		expect((await convert(fixture, { effort: true })).reasoning_effort).toBe("high");
	});

	test("--bare: minimal request", async () => {
		const { body } = await request(claudeCode("e_bare-1"));
		expect(body.messages.map((m) => m.role)).toEqual(["system", "user"]);
		expect(body.messages[1].content).toBe("say hi");
		expect(body.tools).toHaveLength(3);
	});

	test("every captured request converts cleanly under the sanitize + keep configuration", async () => {
		for (const name of ["a_trivial-1", "b_tool-2", "d_effort-1", "e_bare-1", "f_image-2", "g_thinkback-2"]) {
			const { body } = await request(claudeCode(name), {
				toolSchema: "sanitize",
				inlineSystem: "keep",
				thinking: "reasoning_effort",
				effort: true
			});
			expect(JSON.stringify(body)).not.toContain("$schema");
			expect(JSON.stringify(body)).not.toContain("9007199254740991");
		}
	});

	test("converts through slothlet", async () => {
		const api = await composeApi();
		const { body, state } = await api.convert.anthropic.messages.to.openai.chat.request(base({ system: "be brief" }));
		expect(body.messages).toEqual([
			{ role: "system", content: "be brief" },
			{ role: "user", content: "hi" }
		]);
		expect(state.model).toBe("qwen3-coder");
	});
});

describe("request validation and field handling", () => {
	test("rejects malformed bodies", async () => {
		await expect(request(null)).rejects.toMatchObject({ code: "invalid_request", param: "messages" });
		await expect(request({ model: "m" })).rejects.toThrow("messages: Field required");
		await expect(request({ messages: "x" })).rejects.toMatchObject({ status: 400 });
		await expect(request(base({ messages: [{ role: "tool", content: "x" }] }))).rejects.toThrow('unsupported role "tool"');
	});

	test("unknown fields are dropped and listed, or rejected", async () => {
		const { body, state } = await request(
			base({
				metadata: { user_id: "u" },
				cache_control: { type: "ephemeral" },
				service_tier: "auto",
				mcp_servers: [],
				container: "c",
				inference_geo: "eu",
				frobnicate: 1
			})
		);
		expect(state.dropped).toEqual(["mcp_servers", "container", "inference_geo", "frobnicate"]);
		expect(body).not.toHaveProperty("frobnicate");
		await expect(request(base({ frobnicate: 1 }), { unknownFields: "error" })).rejects.toMatchObject({
			code: "unsupported_field",
			param: "frobnicate"
		});
		expect((await request(base({ mcp_servers: [] }), { unknownFields: "error" })).state.dropped).toEqual(["mcp_servers"]);
	});

	test("sampling and limits", async () => {
		const body = await convert(base({ temperature: 0.2, top_p: 0.9, top_k: 40, stop_sequences: ["END"], stream: false }));
		expect(body).toMatchObject({ temperature: 0.2, top_p: 0.9, top_k: 40, stop: ["END"], max_completion_tokens: 100 });
		expect(body).not.toHaveProperty("stream");
		const legacy = await request(base({ top_k: 5, stop_sequences: [], stream: true }), {
			topK: false,
			maxTokensField: "max_tokens",
			streamUsage: false
		});
		expect(legacy.body).toMatchObject({ max_tokens: 100, stream: true });
		expect(legacy.body).not.toHaveProperty("top_k");
		expect(legacy.body).not.toHaveProperty("stop");
		expect(legacy.body).not.toHaveProperty("stream_options");
		expect(legacy.state.dropped).toEqual(["top_k"]);
		expect(await convert({ model: "m", messages: [{ role: "user", content: "x" }] })).not.toHaveProperty("max_completion_tokens");
	});

	test("system forms", async () => {
		expect(
			(await convert(base({ system: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }] }))).messages[0].content
		).toBe("a\n\nb");
		const billing = [
			{ type: "text", text: "x-anthropic-billing-header: cc_version=1;" },
			{ type: "text", text: "real" }
		];
		expect((await convert(base({ system: billing }))).messages[0].content).toBe("real");
		expect((await convert(base({ system: billing }), { stripBillingHeader: false })).messages[0].content).toContain(
			"x-anthropic-billing-header"
		);
		expect((await convert(base({ system: null }))).messages).toHaveLength(1);
		expect((await convert(base({ system: "" }))).messages).toHaveLength(1);
	});
});

describe("inline system messages", () => {
	const conversation = (extra = []) => [
		{ role: "user", content: "one" },
		{ role: "system", content: "S1" },
		{ role: "assistant", content: "ok" },
		{ role: "system", content: [{ type: "text", text: "S2", cache_control: { type: "ephemeral" } }] },
		{ role: "user", content: "two" },
		...extra
	];

	test("user (and auto): folded into the adjacent user turn as system-reminder text", async () => {
		for (const inlineSystem of ["user", "auto"]) {
			const out = await convert(base({ messages: conversation(), system: "lead" }), { inlineSystem });
			expect(out.messages).toEqual([
				{ role: "system", content: "lead" },
				{ role: "user", content: "one\n\n<system-reminder>\nS1\n</system-reminder>" },
				{ role: "assistant", content: "ok" },
				{ role: "user", content: "<system-reminder>\nS2\n</system-reminder>\n\ntwo" }
			]);
		}
	});

	test("an already wrapped reminder is not wrapped twice; empty ones vanish", async () => {
		const out = await convert(
			base({
				messages: [
					{ role: "user", content: "a" },
					{ role: "system", content: "  <system-reminder>x</system-reminder>" },
					{ role: "system", content: "" }
				]
			})
		);
		expect(out.messages[0].content).toBe("a\n\n  <system-reminder>x</system-reminder>");
	});

	test("keep: stays a system message in place", async () => {
		const out = await convert(base({ messages: conversation() }), { inlineSystem: "keep" });
		expect(out.messages.map((m) => m.role)).toEqual(["user", "system", "assistant", "system", "user"]);
		expect(out.messages[3].content).toBe("S2");
	});

	test("hoist: appended to the leading system message", async () => {
		const out = await convert(base({ messages: conversation(), system: "lead" }), { inlineSystem: "hoist" });
		expect(out.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
		expect(out.messages[0].content).toBe("lead\n\nS1\n\nS2");
	});

	test("drop: discarded", async () => {
		const out = await convert(base({ messages: conversation() }), { inlineSystem: "drop" });
		expect(out.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
	});

	test("a system message right after a tool result becomes its own user turn", async () => {
		const out = await convert(
			base({
				messages: [
					{ role: "user", content: "go" },
					{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: {} }] },
					{ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "done" }] },
					{ role: "system", content: "<total_tokens>5</total_tokens>" }
				]
			})
		);
		expect(out.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "user"]);
	});
});

describe("user content", () => {
	test("text, images (base64, url, file), search results and consecutive user turns", async () => {
		const out = await convert(
			base({
				messages: [
					{
						role: "user",
						content: [
							{ type: "text", text: "look" },
							{ type: "text", text: "" },
							{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } },
							{ type: "image", source: { type: "url", url: "https://x/y.png" } },
							{ type: "image", source: { type: "file", file_id: "f1" } },
							{
								type: "search_result",
								source: "https://s",
								title: "Title",
								content: [
									{ type: "text", text: "line a" },
									{ type: "text", text: "line b" }
								]
							},
							{ type: "search_result" }
						]
					},
					{ role: "user", content: "again" }
				]
			})
		);
		expect(out.messages).toHaveLength(1);
		expect(out.messages[0].content).toEqual([
			{ type: "text", text: "look" },
			{ type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJD" } },
			{ type: "image_url", image_url: { url: "https://x/y.png" } },
			{ type: "text", text: "[An image supplied as an uploaded file could not be forwarded.]" },
			{ type: "text", text: "[Search result: Title (https://s)]\nline a\nline b" },
			{ type: "text", text: "[Search result:  ()]\n" },
			{ type: "text", text: "again" }
		]);
	});

	test("an unknown block type is dropped, or rejected when configured", async () => {
		const messages = [
			{
				role: "user",
				content: [
					{ type: "container_upload", file_id: "x" },
					{ type: "text", text: "hi" }
				]
			}
		];
		const { body, state } = await request(base({ messages }));
		expect(body.messages[1] ?? body.messages[0]).toMatchObject({ content: "hi" });
		expect(state.dropped).toEqual(["block:container_upload"]);
		await expect(request(base({ messages }), { unknownFields: "error" })).rejects.toMatchObject({ code: "unsupported_content" });
	});

	test("user message without content", async () => {
		const out = await convert(base({ messages: [{ role: "user" }, { role: "user", content: [] }, { role: "user", content: "x" }] }));
		expect(out.messages).toEqual([{ role: "user", content: "x" }]);
	});
});

describe("tool results", () => {
	const turn = (result) => [
		{ role: "user", content: "go" },
		{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/data/spec.pdf" } }] },
		{ role: "user", content: result }
	];

	test("string and block content, error marker, tool_reference", async () => {
		const out = await convert(
			base({
				messages: turn([
					{ type: "tool_result", tool_use_id: "t1", content: "plain" },
					{
						type: "tool_result",
						tool_use_id: "t2",
						content: [
							{ type: "text", text: "a" },
							{ type: "tool_reference", tool_name: "WebSearch" }
						],
						is_error: true
					},
					{ type: "tool_result", tool_use_id: "t3" },
					{ type: "text", text: "after" }
				])
			}),
			{ toolErrors: true }
		);
		expect(out.messages.slice(2).map((m) => [m.role, m.content])).toEqual([
			["tool", "plain"],
			["tool", "[error] a\n[Tool reference: WebSearch]"],
			["tool", ""],
			["user", "after"]
		]);
		const quiet = await convert(base({ messages: turn([{ type: "tool_result", tool_use_id: "t1", content: "boom", is_error: true }]) }));
		expect(quiet.messages[2].content).toBe("boom");
	});

	test("tool_result with text and an image keeps the text on the tool message", async () => {
		const out = await convert(
			base({
				messages: turn([
					{
						type: "tool_result",
						tool_use_id: "t1",
						content: [
							{ type: "text", text: "see image" },
							{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }
						]
					},
					{ type: "text", text: "extra" }
				])
			})
		);
		expect(out.messages[2]).toEqual({ role: "tool", tool_call_id: "t1", content: "see image" });
		expect(out.messages[3].content).toHaveLength(3);
		expect(out.messages[3].content.at(-1)).toEqual({ type: "text", text: "extra" });
	});

	test("a PDF document inside a tool result is extracted", async () => {
		const out = await convert(
			base({
				messages: turn([
					{
						type: "tool_result",
						tool_use_id: "t1",
						content: [
							{ type: "document", title: "Spec", source: { type: "base64", media_type: "application/pdf", data: pdfBase64(["Spec text"]) } }
						]
					}
				])
			}),
			{ images: false }
		);
		expect(out.messages[2].content).toBe('Document "Spec" (1 page)\n\n--- Page 1 ---\nSpec text');
	});

	test("an unreadable PDF in a tool result names the file path and suggests pdftotext", async () => {
		const out = await convert(
			base({
				messages: turn([
					{
						type: "tool_result",
						tool_use_id: "t1",
						content: [
							{ type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from("junk").toString("base64") } }
						]
					}
				])
			})
		);
		expect(out.messages[2].content).toContain("could not be read by this model");
		expect(out.messages[2].content).toContain("`pdftotext -layout /data/spec.pdf -`");
	});

	test("documents in user content: converter, error and text documents", async () => {
		const document = { type: "document", title: "Notes", source: { type: "text", media_type: "text/plain", data: "body" } };
		const messages = [{ role: "user", content: [document, { type: "text", text: "summarize" }] }];
		expect((await convert(base({ messages }))).messages[0].content).toBe('<document title="Notes">\nbody\n</document>\n\nsummarize');
		const hook = async (block) => [{ type: "text", text: `hooked ${block.title}` }];
		expect((await convert(base({ messages }), { documentConverter: hook })).messages[0].content).toBe("hooked Notes\n\nsummarize");
		await expect(request(base({ messages }), { documents: "error" })).rejects.toMatchObject({ code: "unsupported_document" });
	});
});

describe("assistant content", () => {
	test("text, tool_use, thinking; consecutive assistant turns merge; unknown blocks drop", async () => {
		const { body, state } = await request(
			base({
				messages: [
					{ role: "user", content: "go" },
					{
						role: "assistant",
						content: [
							{ type: "thinking", thinking: "plan", signature: "S" },
							{ type: "thinking", thinking: "", signature: "S" },
							{ type: "redacted_thinking", data: "x" },
							{ type: "text", text: "" },
							{ type: "text", text: "first" }
						]
					},
					{
						role: "assistant",
						content: [
							{ type: "text", text: "second" },
							{ type: "tool_use", id: "t1", name: "Bash" },
							{ type: "server_tool_use", id: "s", name: "web_search", input: {} }
						]
					},
					{ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
					{ role: "assistant", content: "done" }
				]
			})
		);
		expect(body.messages[1]).toEqual({
			role: "assistant",
			content: "first\n\nsecond",
			reasoning: "plan",
			tool_calls: [{ id: "t1", type: "function", function: { name: "Bash", arguments: "{}" } }]
		});
		expect(state.dropped).toEqual(["redacted_thinking", "block:server_tool_use"]);
		expect(body.messages.at(-1)).toEqual({ role: "assistant", content: "done" });
		expect(body.continue_final_message).toBe(true);
		expect(body.add_generation_prompt).toBe(false);
	});

	test("assistant message with no content at all", async () => {
		const out = await convert(base({ messages: [{ role: "user", content: "x" }, { role: "assistant" }, { role: "user", content: "y" }] }));
		expect(out.messages[1]).toEqual({ role: "assistant", content: "" });
	});

	test("prefill detection", async () => {
		const prefilled = base({
			messages: [
				{ role: "user", content: "x" },
				{ role: "assistant", content: "The answer is" }
			]
		});
		expect(await convert(prefilled)).toMatchObject({ continue_final_message: true, add_generation_prompt: false });
		expect(await convert(prefilled, { prefill: "none" })).not.toHaveProperty("continue_final_message");
		const withTools = base({
			messages: [
				{ role: "user", content: "x" },
				{ role: "assistant", content: [{ type: "tool_use", id: "t", name: "A", input: {} }] }
			]
		});
		expect(await convert(withTools)).not.toHaveProperty("continue_final_message");
		const empty = base({
			messages: [
				{ role: "user", content: "x" },
				{ role: "assistant", content: [] }
			]
		});
		expect(await convert(empty)).not.toHaveProperty("continue_final_message");
		expect(await convert(base())).not.toHaveProperty("continue_final_message");
	});

	test("context_management clear_thinking limits replayed reasoning to the newest turns", async () => {
		const history = (extra) =>
			base({
				...extra,
				messages: [
					{ role: "user", content: "1" },
					{
						role: "assistant",
						content: [
							{ type: "thinking", thinking: "t1" },
							{ type: "text", text: "a1" }
						]
					},
					{ role: "user", content: "2" },
					{ role: "assistant", content: [{ type: "text", text: "a2 no thinking" }] },
					{ role: "user", content: "3" },
					{
						role: "assistant",
						content: [
							{ type: "thinking", thinking: "t3" },
							{ type: "text", text: "a3" }
						]
					},
					{ role: "user", content: "4" }
				]
			});
		const reasoningOf = (out) => out.messages.filter((m) => m.role === "assistant").map((m) => m.reasoning);
		expect(reasoningOf(await convert(history()))).toEqual(["t1", undefined, "t3"]);
		const keepAll = { context_management: { edits: [{ type: "clear_thinking_20251015", keep: "all" }] } };
		expect(reasoningOf(await convert(history(keepAll)))).toEqual(["t1", undefined, "t3"]);
		const defaultKeep = { context_management: { edits: [{ type: "clear_thinking_20251015" }] } };
		expect(reasoningOf(await convert(history(defaultKeep)))).toEqual([undefined, undefined, "t3"]);
		const keepTwo = { context_management: { edits: [{ type: "clear_thinking_20251015", keep: { type: "thinking_turns", value: 2 } }] } };
		expect(reasoningOf(await convert(history(keepTwo)))).toEqual(["t1", undefined, "t3"]);
		const keepZero = { context_management: { edits: [{ type: "clear_thinking_20251015", keep: { type: "thinking_turns", value: 0 } }] } };
		expect(reasoningOf(await convert(history(keepZero)))).toEqual([undefined, undefined, undefined]);
		const other = await request(history({ context_management: { edits: [{ type: "clear_tool_uses_20250919" }] } }));
		expect(other.state.dropped).toEqual(["context_management.clear_tool_uses_20250919"]);
	});
});

describe("tools", () => {
	test("function tools, schema sanitizing, strict and defaults", async () => {
		const schema = { $schema: "x", type: "object", properties: { n: { type: "integer", maximum: 9007199254740991 } } };
		const tools = [tool("A", { input_schema: schema, strict: true }), { name: "B" }, { ...tool("C"), type: "custom" }];
		const passed = await convert(base({ tools }));
		expect(passed.tools[0].function).toEqual({ name: "A", description: "A tool", parameters: schema, strict: true });
		expect(passed.tools[1].function).toEqual({ name: "B", parameters: { type: "object", properties: {} } });
		expect(passed.tools).toHaveLength(3);
		const clean = await convert(base({ tools }), { toolSchema: "sanitize" });
		expect(clean.tools[0].function.parameters).toEqual({ type: "object", properties: { n: { type: "integer" } } });
		expect(schema.$schema).toBe("x");
	});

	test("server tools are dropped; with nothing left no tools are sent", async () => {
		const { body, state } = await request(
			base({ tools: [{ type: "web_search_20250305", name: "web_search" }], tool_choice: { type: "any" } })
		);
		expect(body).not.toHaveProperty("tools");
		expect(body).not.toHaveProperty("tool_choice");
		expect(state.dropped).toEqual(["tool:web_search"]);
		expect(await convert(base({ tools: [] }))).not.toHaveProperty("tools");
	});

	test("deferred tools are forwarded as plain tools or dropped", async () => {
		const tools = [tool("Placeholder", { defer_loading: true }), tool("Real")];
		const forwarded = await convert(base({ tools }));
		expect(forwarded.tools.map((t) => t.function.name)).toEqual(["Placeholder", "Real"]);
		expect(JSON.stringify(forwarded)).not.toContain("defer_loading");
		const dropped = await request(base({ tools }), { deferredTools: "drop" });
		expect(dropped.body.tools.map((t) => t.function.name)).toEqual(["Real"]);
		expect(dropped.state.dropped).toEqual(["deferred_tools"]);
	});

	test("tool_choice mapping", async () => {
		const tools = [tool("A")];
		const choice = async (tool_choice, settings) => (await convert(base({ tools, tool_choice }), settings)).tool_choice;
		expect(await choice({ type: "auto" })).toBe("auto");
		expect(await choice({ type: "any" })).toBe("required");
		expect(await choice({ type: "none" })).toBe("none");
		expect(await choice({ type: "tool", name: "A" })).toEqual({ type: "function", function: { name: "A" } });
		expect(await choice(undefined)).toBeUndefined();
		expect(await choice({ type: "mystery" })).toBeUndefined();
		await expect(request(base({ tools, tool_choice: { type: "mystery" } }), { unknownFields: "error" })).rejects.toMatchObject({
			code: "unsupported_content"
		});
		const parallel = await convert(base({ tools, tool_choice: { type: "auto", disable_parallel_tool_use: true } }));
		expect(parallel.parallel_tool_calls).toBe(false);
		const ignored = await convert(base({ tools, tool_choice: { type: "auto", disable_parallel_tool_use: true } }), {
			parallelToolCalls: false
		});
		expect(ignored).not.toHaveProperty("parallel_tool_calls");
		expect(await convert(base({ tools, tool_choice: { type: "auto", disable_parallel_tool_use: false } }))).not.toHaveProperty(
			"parallel_tool_calls"
		);
	});

	test("long and non-conforming tool names are fitted and remembered", async () => {
		const long = `mcp__server__${"t".repeat(80)}`;
		const { body, state } = await request(
			base({
				tools: [tool(long), tool("with.dot")],
				tool_choice: { type: "tool", name: long },
				messages: [
					{ role: "user", content: "x" },
					{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: long, input: {} }] }
				]
			})
		);
		const fitted = body.tools[0].function.name;
		expect(fitted.length).toBeLessThanOrEqual(64);
		expect(body.tool_choice.function.name).toBe(fitted);
		expect(body.messages[1].tool_calls[0].function.name).toBe(fitted);
		expect(body.tools[1].function.name).toBe("with_dot");
		expect(state.toolNames).toEqual({ [fitted]: long, with_dot: "with.dot" });
	});
});

describe("thinking and output config", () => {
	const think = (thinking, extra = {}) => base({ thinking, ...extra });

	test("chat_template_kwargs mode", async () => {
		expect(await convert(think({ type: "enabled", budget_tokens: 2000 }))).toMatchObject({
			chat_template_kwargs: { enable_thinking: true }
		});
		expect(await convert(think({ type: "enabled", budget_tokens: 2000 }))).not.toHaveProperty("thinking_token_budget");
		expect((await convert(think({ type: "enabled", budget_tokens: 2000 }), { thinkingBudget: true })).thinking_token_budget).toBe(99);
		expect((await convert(think({ type: "enabled", budget_tokens: 50 }), { thinkingBudget: true })).thinking_token_budget).toBe(50);
		expect(
			(await convert(think({ type: "enabled", budget_tokens: 50 }, { max_tokens: 0 }), { thinkingBudget: true })).thinking_token_budget
		).toBe(0);
		expect(await convert(think({ type: "enabled" }), { thinkingBudget: true })).not.toHaveProperty("thinking_token_budget");
		expect(
			await convert(think({ type: "enabled", budget_tokens: 5 }, { max_tokens: undefined }), { thinkingBudget: true })
		).not.toHaveProperty("thinking_token_budget");
		expect((await convert(think({ type: "disabled" }))).chat_template_kwargs).toEqual({ enable_thinking: false });
		expect(await convert(think({ type: "adaptive", display: "omitted" }))).not.toHaveProperty("chat_template_kwargs");
		expect(await convert(base())).not.toHaveProperty("chat_template_kwargs");
	});

	test("reasoning_effort mode", async () => {
		const mode = { thinking: "reasoning_effort" };
		expect((await convert(think({ type: "enabled", budget_tokens: 10 }), mode)).reasoning_effort).toBe("medium");
		expect(
			(await convert(think({ type: "enabled", budget_tokens: 10 }, { output_config: { effort: "high" } }), { ...mode, effort: true }))
				.reasoning_effort
		).toBe("high");
		expect((await convert(think({ type: "disabled" }), mode)).reasoning_effort).toBe("none");
		const adaptive = await convert(think({ type: "adaptive" }), mode);
		expect(adaptive).not.toHaveProperty("reasoning_effort");
		expect(adaptive).not.toHaveProperty("chat_template_kwargs");
	});

	test("none mode sends nothing; effort alone maps when enabled by the client", async () => {
		const none = await convert(think({ type: "enabled", budget_tokens: 10 }, { output_config: { effort: "low" } }), { thinking: "none" });
		expect(none).not.toHaveProperty("chat_template_kwargs");
		expect(none).not.toHaveProperty("reasoning_effort");
		const disabled = await convert(think({ type: "disabled" }), { thinking: "none" });
		expect(disabled).not.toHaveProperty("chat_template_kwargs");
		const alone = await convert(base({ output_config: { effort: "xhigh" } }), { effort: true });
		expect(alone.reasoning_effort).toBe("xhigh");
		const off = await convert(think({ type: "disabled" }, { output_config: { effort: "low" } }), { effort: true });
		expect(off).not.toHaveProperty("reasoning_effort");
		expect(await convert(base({ output_config: {} }), { effort: true })).not.toHaveProperty("reasoning_effort");
	});

	test("structured output", async () => {
		const format = { type: "json_schema", schema: { type: "object", properties: { a: { type: "string" } } } };
		const out = await convert(base({ output_config: { format } }));
		expect(out.response_format).toEqual({ type: "json_schema", json_schema: { name: "output", schema: format.schema } });
		expect((await convert(base({ output_format: format }))).response_format.json_schema.schema).toEqual(format.schema);
		const disabled = await request(base({ output_config: { format } }), { responseFormat: false });
		expect(disabled.body).not.toHaveProperty("response_format");
		expect(disabled.state.dropped).toEqual(["output_config.format"]);
		const other = await request(base({ output_config: { format: { type: "regex" }, task_budget: 5, effort: "low" } }));
		expect(other.state.dropped).toEqual(["output_config.format", "output_config.task_budget"]);
	});
});

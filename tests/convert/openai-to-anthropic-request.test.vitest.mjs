/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/convert/openai-to-anthropic-request.test.vitest.mjs
 *	@Date: 2026-10-25T12:25:44-07:00 (1792956344)
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
import { request } from "../../src/api/convert/openai/chat/to/anthropic/messages/request.mjs";
import { composeApi } from "../helpers/api.mjs";
import { pdfBase64 } from "../helpers/pdf.mjs";

const base = (extra = {}) => ({ model: "claude-sonnet-5-5", messages: [{ role: "user", content: "hi" }], ...extra });
const convert = async (body, settings) => (await request(body, settings)).body;
const fn = (name, extra = {}) => ({
	type: "function",
	function: { name, description: `${name} fn`, parameters: { type: "object", properties: {} }, ...extra }
});

describe("openai chat request to anthropic request", () => {
	test("minimal", async () => {
		const { body, state } = await request(base());
		expect(body).toEqual({
			model: "claude-sonnet-5-5",
			max_tokens: 8192,
			messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }]
		});
		expect(state).toEqual({
			front: "openai",
			model: "claude-sonnet-5-5",
			stream: false,
			includeUsage: false,
			reasoningField: "reasoning",
			toolNames: {},
			dropped: []
		});
	});

	test("limits and sampling", async () => {
		expect((await convert(base({ max_tokens: 50 }))).max_tokens).toBe(50);
		expect((await convert(base({ max_tokens: 50, max_completion_tokens: 70 }))).max_tokens).toBe(70);
		expect((await convert(base(), { defaultMaxTokens: 1000 })).max_tokens).toBe(1000);
		const body = await convert(base({ temperature: 1.7, top_p: 0.5, top_k: 20, stop: "END", user: "u-1", n: 1 }));
		expect(body).toMatchObject({ temperature: 1, top_p: 0.5, top_k: 20, stop_sequences: ["END"], metadata: { user_id: "u-1" } });
		expect((await convert(base({ temperature: 0.3, stop: ["a", "b"] }))).temperature).toBe(0.3);
		expect((await convert(base({ stop: ["a", "b"] }))).stop_sequences).toEqual(["a", "b"]);
		expect(await convert(base({ stop: null, user: 5 }))).not.toHaveProperty("stop_sequences");
	});

	test("streaming flags are remembered", async () => {
		const { body, state } = await request(base({ stream: true, stream_options: { include_usage: true } }));
		expect(body.stream).toBe(true);
		expect(state).toMatchObject({ stream: true, includeUsage: true });
		expect((await request(base({ stream: true }))).state.includeUsage).toBe(false);
	});

	test("validation and unknown fields", async () => {
		await expect(request(null)).rejects.toMatchObject({ code: "invalid_request" });
		await expect(request({ model: "m" })).rejects.toThrow("messages is a required property");
		await expect(request(base({ n: 2 }))).rejects.toMatchObject({ code: "unsupported_field", param: "n" });
		await expect(request(base({ messages: [{ role: "function", content: "x" }] }))).rejects.toThrow('unsupported role "function"');
		const { state } = await request(base({ metadata: {}, store: true, service_tier: "auto", seed: 1, logprobs: true }));
		expect(state.dropped).toEqual(["seed", "logprobs"]);
		await expect(request(base({ seed: 1 }), { unknownFields: "error" })).rejects.toMatchObject({
			code: "unsupported_field",
			param: "seed"
		});
	});
});

describe("messages", () => {
	test("system and developer messages are hoisted; same-role turns merge", async () => {
		const body = await convert(
			base({
				messages: [
					{ role: "system", content: "S1" },
					{
						role: "developer",
						content: [
							{ type: "text", text: "D" },
							{ type: "text", text: "D2" }
						]
					},
					{ role: "system", content: "" },
					{ role: "user", content: "a" },
					{ role: "user", content: [{ type: "text", text: "b" }] },
					{ role: "assistant", content: "c" },
					{ role: "assistant", content: "d" }
				]
			})
		);
		expect(body.system).toBe("S1\n\nD\n\nD2");
		expect(body.messages).toEqual([
			{
				role: "user",
				content: [
					{ type: "text", text: "a" },
					{ type: "text", text: "b" }
				]
			},
			{
				role: "assistant",
				content: [
					{ type: "text", text: "c" },
					{ type: "text", text: "d" }
				]
			}
		]);
	});

	test("images and files", async () => {
		const pdf = `data:application/pdf;base64,${pdfBase64(["x"])}`;
		const body = await convert(
			base({
				messages: [
					{
						role: "user",
						content: [
							{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
							{ type: "image_url", image_url: { url: "https://x/y.png" } },
							{ type: "file", file: { file_data: pdf } },
							{ type: "file", file: { file_id: "file-1" } },
							{ type: "input_audio", input_audio: { data: "", format: "wav" } }
						]
					},
					{ role: "user", content: "" },
					{ role: "user", content: null }
				]
			})
		);
		expect(body.messages[0].content).toEqual([
			{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
			{ type: "image", source: { type: "url", url: "https://x/y.png" } },
			{ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64(["x"]) } }
		]);
		const { state } = await request(base({ messages: [{ role: "user", content: [{ type: "input_audio" }, { type: "input_audio" }] }] }));
		expect(state.dropped).toEqual(["content:input_audio"]);
	});

	test("assistant tool calls and tool results become tool_use and one user turn with results first", async () => {
		const { body, state } = await request(
			base({
				messages: [
					{ role: "user", content: "run both" },
					{
						role: "assistant",
						content: null,
						reasoning: "private thoughts",
						tool_calls: [
							{ id: "call_1", type: "function", function: { name: "Bash", arguments: '{"command":"ls"}' } },
							{ id: "functions.read:1", type: "function", function: { name: "mcp.server/read", arguments: "{oops" } }
						]
					},
					{ role: "tool", tool_call_id: "call_1", content: "file.txt" },
					{
						role: "tool",
						tool_call_id: "functions.read:1",
						content: [
							{ type: "text", text: "line 1" },
							{ type: "text", text: "line 2" }
						]
					},
					{ role: "user", content: "thanks" }
				]
			})
		);
		expect(body.messages[1]).toEqual({
			role: "assistant",
			content: [
				{ type: "tool_use", id: "call_1", name: "Bash", input: { command: "ls" } },
				{ type: "tool_use", id: "functions_read_1", name: "mcp_server_read", input: { _raw_arguments: "{oops" } }
			]
		});
		expect(body.messages[2]).toEqual({
			role: "user",
			content: [
				{ type: "tool_result", tool_use_id: "call_1", content: "file.txt" },
				{ type: "tool_result", tool_use_id: "functions_read_1", content: "line 1\n\nline 2" },
				{ type: "text", text: "thanks" }
			]
		});
		expect(state.toolNames).toEqual({ mcp_server_read: "mcp.server/read" });
		expect(state.dropped).toEqual(["reasoning"]);
	});

	test("a tool result after plain user text is placed before it; reasoning_content is also dropped; refusals are kept", async () => {
		const { body, state } = await request(
			base({
				messages: [
					{ role: "user", content: "q" },
					{ role: "assistant", content: "", refusal: "I won't.", reasoning_content: "x" },
					{ role: "assistant", content: "", refusal: "" },
					{ role: "user", content: "later" },
					{ role: "tool", tool_call_id: "t", content: "r" }
				]
			})
		);
		expect(body.messages[1].content).toEqual([{ type: "text", text: "I won't." }]);
		expect(body.messages[2].content).toEqual([
			{ type: "tool_result", tool_use_id: "t", content: "r" },
			{ type: "text", text: "later" }
		]);
		expect(state.dropped).toEqual(["reasoning"]);
	});

	test("a tool result with nothing before it starts a user turn; tool content can be absent", async () => {
		const body = await convert(
			base({
				messages: [
					{ role: "assistant", content: "x" },
					{ role: "tool", tool_call_id: "t" }
				]
			})
		);
		expect(body.messages[1]).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "" }] });
	});

	test("assistant messages with no content are skipped", async () => {
		const body = await convert(
			base({ messages: [{ role: "user", content: "x" }, { role: "assistant", content: "" }, { role: "assistant" }] })
		);
		expect(body.messages).toHaveLength(1);
	});
});

describe("tools, thinking and formats", () => {
	test("tools, schema sanitizing and name fitting", async () => {
		const schema = { $schema: "x", type: "object", properties: { n: { type: "integer", maximum: 9007199254740991 } } };
		const tools = [
			fn("A", { parameters: schema }),
			fn("with.dot", { description: undefined, parameters: undefined }),
			{ type: "custom", custom: { name: "z" } }
		];
		const { body, state } = await request(base({ tools }));
		expect(body.tools).toEqual([
			{ name: "A", description: "A fn", input_schema: schema },
			{ name: "with_dot", input_schema: { type: "object", properties: {} } }
		]);
		expect(state.dropped).toEqual(["tool:custom"]);
		expect(state.toolNames).toEqual({ with_dot: "with.dot" });
		expect((await convert(base({ tools }), { toolSchema: "sanitize" })).tools[0].input_schema).toEqual({
			type: "object",
			properties: { n: { type: "integer" } }
		});
		expect(await convert(base({ tools: [{ type: "custom" }] }))).not.toHaveProperty("tools");
	});

	test("tool_choice and parallel_tool_calls", async () => {
		const tools = [fn("A")];
		const choice = async (extra) => (await convert(base({ tools, ...extra }))).tool_choice;
		expect(await choice({})).toBeUndefined();
		expect(await choice({ tool_choice: "auto" })).toEqual({ type: "auto" });
		expect(await choice({ tool_choice: "none" })).toEqual({ type: "none" });
		expect(await choice({ tool_choice: "required" })).toEqual({ type: "any" });
		expect(await choice({ tool_choice: { type: "function", function: { name: "A" } } })).toEqual({ type: "tool", name: "A" });
		expect(await choice({ parallel_tool_calls: false })).toEqual({ type: "auto", disable_parallel_tool_use: true });
		expect(await choice({ tool_choice: "required", parallel_tool_calls: false })).toEqual({ type: "any", disable_parallel_tool_use: true });
		expect(await choice({ tool_choice: "none", parallel_tool_calls: false })).toEqual({ type: "none" });
		expect(await choice({ parallel_tool_calls: true })).toBeUndefined();
	});

	test("reasoning_effort", async () => {
		expect((await convert(base({ reasoning_effort: "none" }))).thinking).toEqual({ type: "disabled" });
		const high = await convert(base({ reasoning_effort: "high" }));
		expect(high.thinking).toEqual({ type: "adaptive" });
		expect(high.output_config).toEqual({ effort: "high" });
		expect((await convert(base({ reasoning_effort: "minimal" }))).output_config.effort).toBe("low");
		expect(await convert(base({ reasoning_effort: null }))).not.toHaveProperty("thinking");
	});

	test("response_format", async () => {
		const schema = { type: "object", properties: { a: { type: "string" } } };
		const structured = await convert(base({ response_format: { type: "json_schema", json_schema: { name: "x", schema } } }));
		expect(structured.output_config).toEqual({ format: { type: "json_schema", schema } });
		const both = await convert(
			base({ reasoning_effort: "low", response_format: { type: "json_schema", json_schema: { name: "x", schema } } })
		);
		expect(both.output_config).toEqual({ effort: "low", format: { type: "json_schema", schema } });
		const loose = await request(base({ response_format: { type: "json_object" } }));
		expect(loose.state.dropped).toEqual(["response_format"]);
		expect(await convert(base({ response_format: { type: "text" } }))).not.toHaveProperty("output_config");
	});

	test("through slothlet", async () => {
		const api = await composeApi();
		const { body } = await api.convert.openai.chat.to.anthropic.messages.request(
			base({
				messages: [
					{ role: "system", content: "s" },
					{ role: "user", content: "u" }
				]
			})
		);
		expect(body.system).toBe("s");
	});
});

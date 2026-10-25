/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/convert/openai-to-anthropic-response.test.vitest.mjs
 *	@Date: 2026-10-25T12:24:01-07:00 (1792956241)
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
import { response } from "../../src/api/convert/openai/chat/to/anthropic/messages/response.mjs";
import { isOurs } from "../../src/lib/thinking.mjs";
import { composeApi } from "../helpers/api.mjs";

const completion = (message, extra = {}, choice = {}) => ({
	id: "chatcmpl-abc",
	object: "chat.completion",
	model: "Qwen/Qwen3-Coder-30B",
	choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: "stop", ...choice }],
	usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
	...extra
});

describe("openai chat completion to anthropic message", () => {
	test("plain text", () => {
		const out = response(completion({ content: "Hello!" }));
		expect(out).toEqual({
			id: expect.stringMatching(/^msg_/),
			type: "message",
			role: "assistant",
			model: "Qwen/Qwen3-Coder-30B",
			content: [{ type: "text", text: "Hello!" }],
			stop_reason: "end_turn",
			stop_sequence: null,
			usage: { input_tokens: 12, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
		});
	});

	test("the client's model name is echoed when the state has it", () => {
		expect(response(completion({ content: "x" }), { model: "claude-opus-5-5" }).model).toBe("claude-opus-5-5");
	});

	test("cached prompt tokens", () => {
		const out = response(
			completion({ content: "x" }, { usage: { prompt_tokens: 100, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 80 } } })
		);
		expect(out.usage).toMatchObject({ input_tokens: 20, cache_read_input_tokens: 80, output_tokens: 2 });
	});

	test("reasoning (new field, old field) becomes a marked thinking block ahead of the text", () => {
		for (const field of ["reasoning", "reasoning_content"]) {
			const out = response(completion({ content: "Answer", [field]: "step 1" }));
			expect(out.content).toHaveLength(2);
			expect(out.content[0]).toMatchObject({ type: "thinking", thinking: "step 1" });
			expect(isOurs(out.content[0].signature)).toBe(true);
			expect(out.content[1]).toEqual({ type: "text", text: "Answer" });
		}
	});

	test("<think> tags in content (no reasoning parser)", () => {
		const out = response(completion({ content: "<think>plan it</think>\n\nThe answer" }));
		expect(out.content.map((b) => b.type)).toEqual(["thinking", "text"]);
		expect(out.content[0].thinking).toBe("plan it");
		expect(out.content[1].text).toBe("The answer");
		const raw = response(completion({ content: "<think>plan it</think>\n\nThe answer" }), undefined, { thinkTags: false });
		expect(raw.content).toEqual([{ type: "text", text: "<think>plan it</think>\n\nThe answer" }]);
		const field = response(completion({ content: "<think>kept</think>", reasoning: "from field" }));
		expect(field.content.map((b) => b.type)).toEqual(["thinking", "text"]);
		expect(field.content[1].text).toBe("<think>kept</think>");
	});

	test("tool calls: ids sanitized, names restored, arguments parsed", () => {
		const out = response(
			completion(
				{
					content: null,
					tool_calls: [
						{ id: "chatcmpl-tool-1", type: "function", function: { name: "Read", arguments: '{"file_path":"/a"}' } },
						{ id: "functions.fit_ab12:1", type: "function", function: { name: "fit_ab12", arguments: "" } },
						{ type: "function", function: { name: "Bash", arguments: '{"command":' } },
						{ id: "obj", type: "function", function: { name: "O", arguments: { a: 1 } } }
					]
				},
				{},
				{ finish_reason: "tool_calls" }
			),
			{ toolNames: { fit_ab12: "mcp.server/tool" } }
		);
		expect(out.stop_reason).toBe("tool_use");
		expect(out.content).toEqual([
			{ type: "tool_use", id: "chatcmpl-tool-1", name: "Read", input: { file_path: "/a" } },
			{ type: "tool_use", id: "functions_fit_ab12_1", name: "mcp.server/tool", input: {} },
			{ type: "tool_use", id: expect.stringMatching(/^toolu_/), name: "Bash", input: { _raw_arguments: '{"command":' } },
			{ type: "tool_use", id: "obj", name: "O", input: { a: 1 } }
		]);
	});

	test("text before tool calls is kept and a forced-name 'stop' still reports tool_use", () => {
		const out = response(
			completion({ content: "Let me check.", tool_calls: [{ id: "t", type: "function", function: { name: "A", arguments: "{}" } }] })
		);
		expect(out.content.map((b) => b.type)).toEqual(["text", "tool_use"]);
		expect(out.stop_reason).toBe("tool_use");
	});

	test("finish reasons", () => {
		expect(response(completion({ content: "x" }, {}, { finish_reason: "length" })).stop_reason).toBe("max_tokens");
		expect(response(completion({ content: "", refusal: "I can't." }, {}, { finish_reason: "content_filter" }))).toMatchObject({
			stop_reason: "refusal",
			content: [{ type: "text", text: "I can't." }]
		});
		expect(response(completion({ content: "x" }, {}, { stop_reason: "END" }))).toMatchObject({
			stop_reason: "stop_sequence",
			stop_sequence: "END"
		});
		expect(response(completion({ content: "x" }, {}, { stop_reason: 151645 })).stop_reason).toBe("end_turn");
	});

	test("empty or odd messages", () => {
		const empty = [{ type: "text", text: "" }];
		expect(response(completion({ content: null })).content).toEqual(empty);
		expect(response(completion({})).content).toEqual(empty);
		const bare = response({ model: "m", choices: [{ finish_reason: "stop" }] });
		expect(bare.content).toEqual(empty);
		expect(bare.usage.input_tokens).toBe(0);
		expect(response(completion({ content: "", refusal: 5 })).content).toEqual(empty);
	});

	test("a length stop in the middle of a tool call is max_tokens; a complete call stays tool_use", () => {
		const call = (args) => ({ id: "t", type: "function", function: { name: "A", arguments: args } });
		const stop = (args, finish) =>
			response(completion({ content: null, tool_calls: [call(args)] }, {}, { finish_reason: finish })).stop_reason;
		expect(stop('{"a":', "length")).toBe("max_tokens");
		expect(stop('{"a":1}', "length")).toBe("tool_use");
		expect(stop('{"a":', "tool_calls")).toBe("tool_use");
	});

	test("no choices is an upstream error", () => {
		expect(() => response({ choices: [] })).toThrow(/no choices/);
		expect(() => response(undefined)).toThrow(/no choices/);
		try {
			response({});
		} catch (error) {
			expect(error).toMatchObject({ code: "invalid_upstream_response", status: 502 });
		}
	});

	test("through slothlet", async () => {
		const api = await composeApi();
		const out = api.convert.openai.chat.to.anthropic.messages.response(completion({ content: "hi" }));
		expect(out.content).toEqual([{ type: "text", text: "hi" }]);
	});
});

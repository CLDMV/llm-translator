/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/convert/anthropic-to-openai-response.test.vitest.mjs
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
import { response } from "../../src/api/convert/anthropic/messages/to/openai/chat/response.mjs";
import { composeApi } from "../helpers/api.mjs";

const message = (content, extra = {}) => ({
	id: "msg_01abc",
	type: "message",
	role: "assistant",
	model: "claude-sonnet-5-5",
	content,
	stop_reason: "end_turn",
	stop_sequence: null,
	usage: { input_tokens: 10, output_tokens: 4 },
	...extra
});

describe("anthropic message to openai chat completion", () => {
	test("text", () => {
		const out = response(
			message([
				{ type: "text", text: "Hello" },
				{ type: "text", text: " world" }
			])
		);
		expect(out).toEqual({
			id: "chatcmpl-01abc",
			object: "chat.completion",
			created: expect.any(Number),
			model: "claude-sonnet-5-5",
			choices: [{ index: 0, message: { role: "assistant", content: "Hello world" }, finish_reason: "stop" }],
			usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }
		});
	});

	test("thinking goes to the configured reasoning field; other blocks are skipped", () => {
		const blocks = [
			{ type: "thinking", thinking: "a", signature: "s" },
			{ type: "redacted_thinking", data: "x" },
			{ type: "thinking", thinking: "b", signature: "s" },
			{ type: "text", text: "Answer" }
		];
		expect(response(message(blocks)).choices[0].message).toEqual({ role: "assistant", content: "Answer", reasoning: "ab" });
		expect(response(message(blocks), undefined, { reasoningField: "reasoning_content" }).choices[0].message.reasoning_content).toBe("ab");
	});

	test("tool use: names restored, null content, tool_calls finish", () => {
		const out = response(
			message(
				[
					{ type: "tool_use", id: "toolu_1", name: "fit_ab12", input: { a: 1 } },
					{ type: "tool_use", id: "toolu_2", name: "Plain" }
				],
				{
					stop_reason: "tool_use"
				}
			),
			{ toolNames: { fit_ab12: "my.tool" }, model: "gpt-front" }
		);
		expect(out.model).toBe("gpt-front");
		expect(out.choices[0].finish_reason).toBe("tool_calls");
		expect(out.choices[0].message).toEqual({
			role: "assistant",
			content: null,
			tool_calls: [
				{ id: "toolu_1", type: "function", function: { name: "my.tool", arguments: '{"a":1}' } },
				{ id: "toolu_2", type: "function", function: { name: "Plain", arguments: "{}" } }
			]
		});
	});

	test("text alongside tool calls stays; stop reasons and stop sequence", () => {
		const out = response(
			message(
				[
					{ type: "text", text: "ok" },
					{ type: "tool_use", id: "t", name: "A", input: {} }
				],
				{ stop_reason: "tool_use" }
			)
		);
		expect(out.choices[0].message.content).toBe("ok");
		expect(response(message([], { stop_reason: "max_tokens" })).choices[0].finish_reason).toBe("length");
		const stop = response(message([{ type: "text", text: "x" }], { stop_reason: "stop_sequence", stop_sequence: "END" }));
		expect(stop.choices[0]).toMatchObject({ finish_reason: "stop", stop_reason: "END" });
		expect(response(message([{ type: "text", text: "x" }], { stop_reason: "refusal" })).choices[0].finish_reason).toBe("content_filter");
	});

	test("cache usage and missing content", () => {
		const out = response(
			message(undefined, { usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 5, cache_creation_input_tokens: 3 } })
		);
		expect(out.choices[0].message.content).toBe("");
		expect(out.usage).toEqual({ prompt_tokens: 9, completion_tokens: 2, total_tokens: 11, prompt_tokens_details: { cached_tokens: 5 } });
	});

	test("through slothlet", async () => {
		const api = await composeApi();
		expect(api.convert.anthropic.messages.to.openai.chat.response(message([{ type: "text", text: "x" }])).choices[0].message.content).toBe(
			"x"
		);
	});
});

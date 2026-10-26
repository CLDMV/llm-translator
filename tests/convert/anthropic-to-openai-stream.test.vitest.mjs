/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/convert/anthropic-to-openai-stream.test.vitest.mjs
 *	@Date: 2026-10-25T12:25:44-07:00 (1792956344)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T13:31:31-07:00 (1792960291)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { describe, expect, test } from "vitest";
import { stream } from "../../src/api/convert/anthropic/messages/to/openai/chat/stream.mjs";
import { composeApi } from "../helpers/api.mjs";
import { anthropicSse, asyncOf, collect, readable, slices } from "../helpers/streams.mjs";

const start = (extra = {}) => ({
	data: {
		type: "message_start",
		message: {
			id: "msg_01abc",
			type: "message",
			role: "assistant",
			model: "claude-sonnet-5-5",
			content: [],
			usage: { input_tokens: 25, output_tokens: 1 },
			...extra
		}
	}
});
const blockStart = (index, content_block) => ({ data: { type: "content_block_start", index, content_block } });
const delta = (index, d) => ({ data: { type: "content_block_delta", index, delta: d } });
const blockStop = (index) => ({ data: { type: "content_block_stop", index } });
const messageDelta = (stop_reason, usage = { output_tokens: 7 }, extra = {}) => ({
	data: { type: "message_delta", delta: { stop_reason, stop_sequence: null, ...extra }, usage }
});
const stop = { data: { type: "message_stop" } };
const text = (t) => delta(0, { type: "text_delta", text: t });
const run = async (events, state, settings) => (await collect(stream(anthropicSse(events), state, settings))).map((e) => e.data);
const choiceOf = (chunks) => chunks.filter((c) => c.choices?.length).map((c) => c.choices[0]);

describe("text", () => {
	const events = [
		start(),
		blockStart(0, { type: "text", text: "" }),
		{ data: { type: "ping" } },
		text("Hello"),
		text(" there"),
		blockStop(0),
		messageDelta("end_turn"),
		stop
	];

	test("exact chunk sequence ending in usage and [DONE]", async () => {
		const out = await run(events);
		const base = { id: "chatcmpl-01abc", object: "chat.completion.chunk", created: expect.any(Number), model: "claude-sonnet-5-5" };
		expect(out).toEqual([
			{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
			{ ...base, choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] },
			{ ...base, choices: [{ index: 0, delta: { content: " there" }, finish_reason: null }] },
			{ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
			{ ...base, choices: [], usage: { prompt_tokens: 25, completion_tokens: 7, total_tokens: 32 } },
			"[DONE]"
		]);
	});

	test("usage chunk can be turned off by the client's stream_options", async () => {
		const out = await run(events, { includeUsage: false, model: "gpt-front" });
		expect(out.at(-1)).toBe("[DONE]");
		expect(out.at(-2).choices).toHaveLength(1);
		expect(out[0].model).toBe("gpt-front");
	});

	test("accepts SSE text at any chunking, bytes, streams, event pairs and bare payloads", async () => {
		const sse = anthropicSse(events);
		const expected = (await run(events)).length;
		expect((await collect(stream(new TextEncoder().encode(sse)))).length).toBe(expected);
		expect((await collect(stream(readable(slices(sse, 9))))).length).toBe(expected);
		expect((await collect(stream(asyncOf(events.map((e) => e.data))))).length).toBe(expected);
		expect((await collect(stream(events.map((e) => ({ event: e.data.type, data: e.data }))))).length).toBe(expected);
	});

	test("stop reasons and stop sequence", async () => {
		const reason = async (r, extra) => choiceOf(await run([start(), text("x"), messageDelta(r, { output_tokens: 1 }, extra), stop])).at(-1);
		expect(await reason("max_tokens")).toMatchObject({ finish_reason: "length" });
		expect(await reason("refusal")).toMatchObject({ finish_reason: "content_filter" });
		expect(await reason("stop_sequence", { stop_sequence: "END" })).toMatchObject({ finish_reason: "stop", stop_reason: "END" });
	});

	test("message_delta may update usage; null fields are ignored; missing usage keeps start usage", async () => {
		const out = await run([
			start({ usage: { input_tokens: 10, cache_read_input_tokens: 4 } }),
			{
				data: {
					type: "message_delta",
					delta: { stop_reason: "end_turn" },
					usage: { output_tokens: 3, input_tokens: null, cache_creation_input_tokens: undefined }
				}
			},
			stop
		]);
		expect(out.at(-2).usage).toEqual({
			prompt_tokens: 14,
			completion_tokens: 3,
			total_tokens: 17,
			prompt_tokens_details: { cached_tokens: 4 }
		});
		const bare = await run([start(), { data: { type: "message_delta" } }, stop]);
		expect(bare.at(-2).usage).toEqual({ prompt_tokens: 25, completion_tokens: 1, total_tokens: 26 });
	});
});

describe("thinking and tools", () => {
	test("thinking deltas use the configured reasoning field; signatures and unknown blocks are skipped", async () => {
		const events = [
			start(),
			blockStart(0, { type: "thinking", thinking: "", signature: "" }),
			delta(0, { type: "thinking_delta", thinking: "hmm" }),
			delta(0, { type: "signature_delta", signature: "SIG" }),
			blockStop(0),
			blockStart(1, { type: "server_tool_use", id: "s", name: "web_search", input: {} }),
			delta(1, { type: "input_json_delta", partial_json: "{}" }),
			blockStop(1),
			blockStart(2, { type: "text", text: "" }),
			delta(2, { type: "text_delta", text: "answer" }),
			blockStop(2),
			messageDelta("end_turn"),
			stop
		];
		const out = choiceOf(await run(events));
		expect(out.map((c) => c.delta)).toEqual([{ role: "assistant", content: "" }, { reasoning: "hmm" }, { content: "answer" }, {}]);
		const legacy = choiceOf(await run(events, undefined, { reasoningField: "reasoning_content" }));
		expect(legacy[1].delta).toEqual({ reasoning_content: "hmm" });
	});

	test("tool_use blocks stream as indexed tool_calls with names restored", async () => {
		const out = choiceOf(
			await run(
				[
					start(),
					blockStart(0, { type: "text", text: "" }),
					text("Let me look."),
					blockStop(0),
					blockStart(1, { type: "tool_use", id: "toolu_1", name: "fit_ab12", input: {} }),
					delta(1, { type: "input_json_delta", partial_json: '{"a"' }),
					delta(1, { type: "input_json_delta", partial_json: ":1}" }),
					blockStop(1),
					blockStart(2, { type: "tool_use", id: "toolu_2", name: "Bash", input: {} }),
					delta(2, { type: "input_json_delta", partial_json: "{}" }),
					blockStop(2),
					messageDelta("tool_use"),
					stop
				],
				{ toolNames: { fit_ab12: "my.tool" } }
			)
		);
		expect(out.map((c) => c.delta)).toEqual([
			{ role: "assistant", content: "" },
			{ content: "Let me look." },
			{ tool_calls: [{ index: 0, id: "toolu_1", type: "function", function: { name: "my.tool", arguments: "" } }] },
			{ tool_calls: [{ index: 0, function: { arguments: '{"a"' } }] },
			{ tool_calls: [{ index: 0, function: { arguments: ":1}" } }] },
			{ tool_calls: [{ index: 1, id: "toolu_2", type: "function", function: { name: "Bash", arguments: "" } }] },
			{ tool_calls: [{ index: 1, function: { arguments: "{}" } }] },
			{}
		]);
		expect(out.at(-1).finish_reason).toBe("tool_calls");
	});
});

describe("errors", () => {
	test("an Anthropic error event becomes an error chunk then [DONE]", async () => {
		const out = await run([start(), text("x"), { data: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } } }]);
		expect(out.slice(-2)).toEqual([{ error: { message: "Overloaded", type: "server_error", param: null, code: 529 } }, "[DONE]"]);
	});

	test("a stream that ends early is reported", async () => {
		const out = await run([start(), text("x"), messageDelta("end_turn")]);
		expect(out.slice(-2)).toEqual([
			{ error: { message: "Upstream stream ended before completion", type: "server_error", param: null, code: 500 } },
			"[DONE]"
		]);
	});

	test("a failing source and invalid JSON are reported", async () => {
		async function* failing() {
			yield anthropicSse([start()]);
			throw new Error("reset by peer");
		}
		const out = (await collect(stream(failing()))).map((e) => e.data);
		expect(out.at(-2).error).toMatchObject({ message: "reset by peer", type: "server_error" });
		const invalid = (await collect(stream("data: {oops\n\n"))).map((e) => e.data);
		expect(invalid[0].error.message).toContain("not valid JSON");
		expect(invalid[0].error.code).toBe(500);
		expect(invalid[1]).toBe("[DONE]");
	});

	test("closing early closes the upstream source", async () => {
		let closed = false;
		async function* source() {
			try {
				yield anthropicSse([start()]);
				for (;;) yield anthropicSse([text("x")]);
			} finally {
				closed = true;
			}
		}
		const iterator = stream(source())[Symbol.asyncIterator]();
		await iterator.next();
		await iterator.next();
		await iterator.return();
		expect(closed).toBe(true);
	});
});

test("through slothlet", async () => {
	const api = await composeApi();
	const out = await collect(
		api.convert.anthropic.messages.to.openai.chat.stream(
			anthropicSse([start(), blockStart(0, { type: "text", text: "" }), text("hi"), blockStop(0), messageDelta("end_turn"), stop])
		)
	);
	expect(out.at(-1)).toEqual({ data: "[DONE]" });
	expect(out[1].data.choices[0].delta.content).toBe("hi");
});

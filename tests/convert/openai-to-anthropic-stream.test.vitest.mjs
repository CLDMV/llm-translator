/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/convert/openai-to-anthropic-stream.test.vitest.mjs
 *	@Date: 2026-10-25T12:24:46-07:00 (1792956286)
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
import { stream } from "../../src/api/convert/openai/chat/to/anthropic/messages/stream.mjs";
import { isOurs } from "../../src/lib/thinking.mjs";
import { composeApi } from "../helpers/api.mjs";
import { asyncOf, collect, openaiSse, readable, slices } from "../helpers/streams.mjs";

const chunk = (delta, extra = {}, finish = null) => ({
	id: "chatcmpl-1",
	object: "chat.completion.chunk",
	created: 1,
	model: "Qwen/Qwen3-Coder-30B",
	choices: [{ index: 0, delta, finish_reason: finish, ...extra }]
});
const usageChunk = (usage) => ({ id: "chatcmpl-1", object: "chat.completion.chunk", model: "Qwen/Qwen3-Coder-30B", choices: [], usage });
const run = async (chunks, state, settings) => await collect(stream(openaiSse([...chunks, "[DONE]"]), state, settings));
const types = (events) => events.map((e) => e.event);
const deltas = (events) => events.filter((e) => e.event === "content_block_delta").map((e) => e.data.delta);

describe("text streaming", () => {
	const text = [
		chunk({ role: "assistant", content: "" }),
		chunk({ content: "Hel" }),
		chunk({ content: "lo" }),
		chunk({}, {}, "stop"),
		usageChunk({ prompt_tokens: 20, completion_tokens: 3, total_tokens: 23 })
	];

	test("produces the exact Anthropic event sequence", async () => {
		const events = await run(text);
		expect(events).toEqual([
			{
				event: "message_start",
				data: {
					type: "message_start",
					message: {
						id: expect.stringMatching(/^msg_/),
						type: "message",
						role: "assistant",
						model: "Qwen/Qwen3-Coder-30B",
						content: [],
						stop_reason: null,
						stop_sequence: null,
						usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
					}
				}
			},
			{ event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
			{ event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } } },
			{ event: "content_block_delta", data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo" } } },
			{ event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
			{
				event: "message_delta",
				data: {
					type: "message_delta",
					delta: { stop_reason: "end_turn", stop_sequence: null },
					usage: { input_tokens: 20, output_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
				}
			},
			{ event: "message_stop", data: { type: "message_stop" } }
		]);
	});

	test("accepts SSE text at any chunking, bytes, streams, iterables and parsed chunks", async () => {
		const sse = openaiSse([...text, "[DONE]"]);
		const expected = types(await run(text));
		expect(types(await collect(stream(new TextEncoder().encode(sse))))).toEqual(expected);
		expect(types(await collect(stream(readable(slices(sse, 7)))))).toEqual(expected);
		expect(types(await collect(stream(asyncOf(slices(sse, 1)))))).toEqual(expected);
		expect(types(await collect(stream(text)))).toEqual(expected);
		expect(types(await collect(stream(asyncOf(text))))).toEqual(expected);
		const bytes = new TextEncoder().encode(sse);
		expect(types(await collect(stream(readable([bytes.slice(0, 33), bytes.slice(33)]))))).toEqual(expected);
	});

	test("input tokens come from the first chunk when the server reports continuous usage", async () => {
		const events = await run([
			chunk({ role: "assistant", content: "" }, {}, null),
			{ ...chunk({ content: "x" }), usage: { prompt_tokens: 50, completion_tokens: 1 } },
			{ ...chunk({}, {}, "stop"), usage: { prompt_tokens: 50, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 40 } } }
		]);
		expect(events[0].data.message.usage.input_tokens).toBe(0);
		const first = await run([
			{ ...chunk({ role: "assistant", content: "" }), usage: { prompt_tokens: 50, completion_tokens: 0 } },
			chunk({}, {}, "stop")
		]);
		expect(first[0].data.message.usage.input_tokens).toBe(50);
		expect(events.at(-2).data.usage).toEqual({
			input_tokens: 10,
			output_tokens: 2,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 40
		});
	});

	test("state.model is echoed; stop reasons", async () => {
		const events = await run([chunk({ content: "x" }, { stop_reason: "END" }, "stop")], { model: "claude-opus-5-5" });
		expect(events[0].data.message.model).toBe("claude-opus-5-5");
		expect(events.at(-2).data.delta).toEqual({ stop_reason: "stop_sequence", stop_sequence: "END" });
		expect((await run([chunk({ content: "x" }, {}, "length")])).at(-2).data.delta.stop_reason).toBe("max_tokens");
		expect((await run([chunk({ content: "x" }, { stop_reason: 151645 }, "stop")])).at(-2).data.delta.stop_reason).toBe("end_turn");
	});

	test("empty deltas, missing delta and choice-less chunks are skipped", async () => {
		const events = await run([
			chunk({ content: "" }),
			{ ...chunk({}), choices: [{ index: 0, finish_reason: null }] },
			chunk({ content: "ok" }),
			chunk({ content: 5 }),
			{ id: "x" },
			chunk({}, {}, "stop")
		]);
		expect(deltas(events)).toEqual([{ type: "text_delta", text: "ok" }]);
	});

	test("a stream with [DONE] but no finish_reason still completes", async () => {
		const events = await run([chunk({ content: "x" })]);
		expect(events.at(-2).data.delta.stop_reason).toBe("end_turn");
		expect(events.at(-1).event).toBe("message_stop");
	});

	test("without [DONE] a finish_reason is enough", async () => {
		const events = await collect(stream(openaiSse([chunk({ content: "x" }), chunk({}, {}, "stop")])));
		expect(events.at(-1).event).toBe("message_stop");
	});
});

describe("reasoning", () => {
	test.each(["reasoning", "reasoning_content"])("%s field becomes a thinking block closed with a marked signature", async (field) => {
		const events = await run([
			chunk({ role: "assistant", content: "" }),
			chunk({ [field]: "Let me " }),
			chunk({ [field]: "think." }),
			chunk({ [field]: "" }),
			chunk({ content: "Answer" }),
			chunk({}, {}, "stop")
		]);
		expect(types(events)).toEqual([
			"message_start",
			"content_block_start",
			"content_block_delta",
			"content_block_delta",
			"content_block_delta",
			"content_block_stop",
			"content_block_start",
			"content_block_delta",
			"content_block_stop",
			"message_delta",
			"message_stop"
		]);
		expect(events[1].data.content_block).toEqual({ type: "thinking", thinking: "", signature: "" });
		const d = deltas(events);
		expect(d[0]).toEqual({ type: "thinking_delta", thinking: "Let me " });
		expect(d[1]).toEqual({ type: "thinking_delta", thinking: "think." });
		expect(d[2].type).toBe("signature_delta");
		expect(isOurs(d[2].signature)).toBe(true);
		expect(d[3]).toEqual({ type: "text_delta", text: "Answer" });
		expect(events[6].data).toMatchObject({ index: 1, content_block: { type: "text" } });
	});

	test("<think> tags in content, at any chunk size", async () => {
		const content = "<think>plan the work</think>\n\nDone.";
		for (const size of [1, 2, 5, 100]) {
			const events = await run([...slices(content, size).map((c) => chunk({ content: c })), chunk({}, {}, "stop")]);
			const thinking = deltas(events)
				.filter((d) => d.type === "thinking_delta")
				.map((d) => d.thinking)
				.join("");
			const text = deltas(events)
				.filter((d) => d.type === "text_delta")
				.map((d) => d.text)
				.join("");
			expect([thinking, text]).toEqual(["plan the work", "Done."]);
		}
	});

	test("thinkTags: false leaves tags in the text", async () => {
		const events = await run([chunk({ content: "<think>x</think>y" }), chunk({}, {}, "stop")], undefined, { thinkTags: false });
		expect(deltas(events)).toEqual([{ type: "text_delta", text: "<think>x</think>y" }]);
	});

	test("an unterminated think block ends as reasoning only", async () => {
		const events = await run([chunk({ content: "<think>never ends" }), chunk({}, {}, "length")]);
		expect(types(events).slice(1, 5)).toEqual(["content_block_start", "content_block_delta", "content_block_delta", "content_block_stop"]);
		expect(events[1].data.content_block.type).toBe("thinking");
		expect(events.at(-2).data.delta.stop_reason).toBe("max_tokens");
	});
});

describe("tool calls (toolStreaming: stream)", () => {
	const runIncremental = (chunks, state, settings) => run(chunks, state, { toolStreaming: "stream", ...settings });
	const call = (index, extra = {}) => ({ index, ...extra });

	test("shape A: id and name first, argument fragments after", async () => {
		const events = await runIncremental([
			chunk({ role: "assistant", content: "" }),
			chunk({ tool_calls: [call(0, { id: "chatcmpl-tool-aa", type: "function", function: { name: "Read" } })] }),
			chunk({ tool_calls: [call(0, { function: { arguments: '{"file_' } })] }),
			chunk({ tool_calls: [call(0, { function: { arguments: 'path":"/a"}' } })] }),
			chunk({}, {}, "tool_calls")
		]);
		expect(types(events)).toEqual([
			"message_start",
			"content_block_start",
			"content_block_delta",
			"content_block_delta",
			"content_block_stop",
			"message_delta",
			"message_stop"
		]);
		expect(events[1].data.content_block).toEqual({ type: "tool_use", id: "chatcmpl-tool-aa", name: "Read", input: {} });
		expect(
			deltas(events)
				.map((d) => d.partial_json)
				.join("")
		).toBe('{"file_path":"/a"}');
		expect(events.at(-2).data.delta.stop_reason).toBe("tool_use");
	});

	test("shape B: name and first arguments together", async () => {
		const events = await runIncremental([
			chunk({ tool_calls: [call(0, { id: "t1", type: "function", function: { name: "Bash", arguments: '{"command":' } })] }),
			chunk({ tool_calls: [call(0, { function: { arguments: '"ls"}' } })] }),
			chunk({}, {}, "stop")
		]);
		expect(deltas(events).map((d) => d.partial_json)).toEqual(['{"command":', '"ls"}']);
		expect(events.at(-2).data.delta.stop_reason).toBe("tool_use");
	});

	test("shape C: whole call in one delta, several calls with distinct indices", async () => {
		const events = await runIncremental([
			chunk({
				tool_calls: [
					call(0, { id: "t1", type: "function", function: { name: "A", arguments: '{"x":1}' } }),
					call(1, { id: "t2", type: "function", function: { name: "B", arguments: '{"y":2}' } })
				]
			}),
			chunk({}, {}, "tool_calls")
		]);
		const starts = events.filter((e) => e.event === "content_block_start").map((e) => e.data);
		expect(starts.map((s) => [s.index, s.content_block.id, s.content_block.name])).toEqual([
			[0, "t1", "A"],
			[1, "t2", "B"]
		]);
		expect(events.filter((e) => e.event === "content_block_stop").map((e) => e.data.index)).toEqual([0, 1]);
		expect(deltas(events).map((d) => d.partial_json)).toEqual(['{"x":1}', '{"y":2}']);
	});

	test("a call with no arguments gets an empty object; object arguments are serialized; null arguments are ignored", async () => {
		const events = await runIncremental([
			chunk({ tool_calls: [call(0, { id: "t1", function: { name: "Noop" } })] }),
			chunk({ tool_calls: [call(1, { id: "t2", function: { name: "Obj", arguments: { a: 1 } } })] }),
			chunk({ tool_calls: [call(2, { id: "t3", function: { name: "Nul", arguments: null } })] }),
			chunk({}, {}, "tool_calls")
		]);
		expect(deltas(events).map((d) => d.partial_json)).toEqual(["{}", '{"a":1}', "{}"]);
	});

	test("calls without an index: a new id starts a call, fragments continue the last one", async () => {
		const events = await runIncremental([
			chunk({ tool_calls: [{ id: "t1", function: { name: "A", arguments: '{"a"' } }] }),
			chunk({ tool_calls: [{ function: { arguments: ":1}" } }] }),
			chunk({ tool_calls: [{ id: "t2", function: { name: "B", arguments: "{}" } }] }),
			chunk({}, {}, "tool_calls")
		]);
		expect(events.filter((e) => e.event === "content_block_start").map((e) => e.data.content_block.id)).toEqual(["t1", "t2"]);
		expect(deltas(events).map((d) => d.partial_json)).toEqual(['{"a"', ":1}", "{}"]);
	});

	test("a call without an id gets a generated one; fitted names are restored", async () => {
		const events = await runIncremental(
			[chunk({ tool_calls: [call(0, { function: { name: "fit_ab12", arguments: "{}" } })] }), chunk({}, {}, "tool_calls")],
			{
				toolNames: { fit_ab12: "mcp.server/tool" }
			}
		);
		expect(events[1].data.content_block).toMatchObject({ id: expect.stringMatching(/^toolu_/), name: "mcp.server/tool" });
	});

	test("a call whose first delta has no function object still opens a block", async () => {
		const events = await runIncremental([chunk({ tool_calls: [call(0, { id: "t1" })] }), chunk({}, {}, "tool_calls")]);
		expect(events[1].data.content_block).toMatchObject({ id: "t1", name: "" });
	});

	test("text before a tool call and thinking before text close their blocks in order", async () => {
		const events = await runIncremental([
			chunk({ reasoning: "hmm" }),
			chunk({ content: "Checking." }),
			chunk({ tool_calls: [call(0, { id: "t1", function: { name: "A", arguments: "{}" } })] }),
			chunk({}, {}, "tool_calls")
		]);
		expect(events.filter((e) => e.event === "content_block_start").map((e) => e.data.content_block.type)).toEqual([
			"thinking",
			"text",
			"tool_use"
		]);
		expect(events.filter((e) => e.event === "content_block_stop").map((e) => e.data.index)).toEqual([0, 1, 2]);
	});

	test("interleaved parallel calls: later calls are buffered and emitted whole after the open block closes", async () => {
		const events = await runIncremental([
			chunk({ tool_calls: [call(0, { id: "t1", function: { name: "A", arguments: "{" } })] }),
			chunk({ tool_calls: [call(1, { id: "t2", function: { name: "B", arguments: '{"b"' } })] }),
			chunk({
				tool_calls: [
					call(0, { function: { arguments: '"a":1}' } }),
					call(1, { function: { arguments: ":2}" } }),
					call(2, { id: "t3", function: { name: "C" } })
				]
			}),
			chunk({}, {}, "tool_calls")
		]);
		expect(types(events).filter((t) => t.startsWith("content_block"))).toEqual([
			"content_block_start",
			"content_block_delta",
			"content_block_delta",
			"content_block_stop",
			"content_block_start",
			"content_block_delta",
			"content_block_stop",
			"content_block_start",
			"content_block_delta",
			"content_block_stop"
		]);
		expect(events.filter((e) => e.event === "content_block_start").map((e) => [e.data.index, e.data.content_block.id])).toEqual([
			[0, "t1"],
			[1, "t2"],
			[2, "t3"]
		]);
		expect(deltas(events).map((d) => d.partial_json)).toEqual(["{", '"a":1}', '{"b":2}', "{}"]);
		expect(events.at(-1).event).toBe("message_stop");
	});

	test("buffered calls are flushed before following text", async () => {
		const events = await runIncremental([
			chunk({
				tool_calls: [
					call(0, { id: "t1", function: { name: "A", arguments: "{}" } }),
					call(1, { id: "t2", function: { name: "B", arguments: "{}" } })
				]
			}),
			chunk({ content: "after" }),
			chunk({}, {}, "stop")
		]);
		expect(events.filter((e) => e.event === "content_block_start").map((e) => e.data.content_block.type)).toEqual([
			"tool_use",
			"tool_use",
			"text"
		]);
	});

	test("text arriving while tool blocks are open waits for them, so later fragments never error", async () => {
		const events = await runIncremental([
			chunk({
				tool_calls: [
					call(0, { id: "t1", function: { name: "A", arguments: "{" } }),
					call(1, { id: "t2", function: { name: "B", arguments: "{" } })
				]
			}),
			chunk({ content: "text in between" }),
			chunk({ reasoning: "late thought" }),
			chunk({ tool_calls: [call(1, { function: { arguments: '"b":1}' } }), call(0, { function: { arguments: '"a":1}' } })] }),
			chunk({}, {}, "tool_calls")
		]);
		expect(events.filter((e) => e.event === "content_block_start").map((e) => e.data.content_block.type)).toEqual([
			"tool_use",
			"tool_use",
			"text",
			"thinking"
		]);
		expect(deltas(events).map((d) => d.partial_json ?? d.text ?? d.thinking ?? d.type)).toEqual([
			"{",
			'"a":1}',
			'{"b":1}',
			"text in between",
			"late thought",
			"signature_delta"
		]);
		expect(types(events)).not.toContain("error");
		expect(events.at(-2).data.delta.stop_reason).toBe("tool_use");
	});
});

describe("tool calls (toolStreaming: buffer, the default)", () => {
	const call = (index, extra = {}) => ({ index, ...extra });
	const blocks = (events) =>
		events
			.filter((e) => e.event.startsWith("content_block"))
			.map((e) => [
				e.event.replace("content_block_", ""),
				e.data.index,
				e.data.content_block?.type ?? e.data.delta?.partial_json ?? e.data.delta?.text
			]);

	test("a call is emitted whole: start, one input_json_delta, stop", async () => {
		const events = await run([
			chunk({ tool_calls: [call(0, { id: "t1", function: { name: "Read" } })] }),
			chunk({ tool_calls: [call(0, { function: { arguments: '{"file_' } })] }),
			chunk({ tool_calls: [call(0, { function: { arguments: 'path":"/a"}' } })] }),
			chunk({}, {}, "tool_calls")
		]);
		expect(blocks(events)).toEqual([
			["start", 0, "tool_use"],
			["delta", 0, '{"file_path":"/a"}'],
			["stop", 0, undefined]
		]);
		expect(events.at(-2).data.delta.stop_reason).toBe("tool_use");
	});

	test("text that arrives while a call is in progress is emitted before the tool block", async () => {
		const events = await run([
			chunk({ tool_calls: [call(0, { id: "t1", function: { name: "A", arguments: "{" } })] }),
			chunk({ content: "Checking." }),
			chunk({ reasoning: "hmm" }),
			chunk({ tool_calls: [call(0, { function: { arguments: '"a":1}' } })] }),
			chunk({}, {}, "tool_calls")
		]);
		expect(events.filter((e) => e.event === "content_block_start").map((e) => e.data.content_block.type)).toEqual([
			"text",
			"thinking",
			"tool_use"
		]);
		expect(deltas(events).map((d) => d.partial_json ?? d.text ?? d.thinking ?? d.type)).toEqual([
			"Checking.",
			"hmm",
			"signature_delta",
			'{"a":1}'
		]);
	});

	test("every call is held until the stream finishes and then emitted whole, in index order", async () => {
		const events = await run([
			chunk({ tool_calls: [call(1, { id: "t2", function: { name: "B", arguments: '{"b"' } })] }),
			chunk({ content: "between" }),
			chunk({ tool_calls: [call(0, { id: "t1", function: { name: "A", arguments: "{}" } })] }),
			chunk({ tool_calls: [call(1, { function: { arguments: ":1}" } })] }),
			chunk({}, {}, "tool_calls")
		]);
		expect(blocks(events)).toEqual([
			["start", 0, "text"],
			["delta", 0, "between"],
			["stop", 0, undefined],
			["start", 1, "tool_use"],
			["delta", 1, "{}"],
			["stop", 1, undefined],
			["start", 2, "tool_use"],
			["delta", 2, '{"b":1}'],
			["stop", 2, undefined]
		]);
		expect(
			events
				.filter((e) => e.event === "content_block_start" && e.data.content_block.type === "tool_use")
				.map((e) => e.data.content_block.id)
		).toEqual(["t1", "t2"]);
	});

	test("calls without arguments get an empty object; object arguments and calls without an index work", async () => {
		const events = await run([
			chunk({ tool_calls: [{ id: "t1", function: { name: "Noop" } }] }),
			chunk({ tool_calls: [{ id: "t2", function: { name: "Obj", arguments: { a: 1 } } }] }),
			chunk({ tool_calls: [{ function: { arguments: null } }] }),
			chunk({}, {}, "tool_calls")
		]);
		expect(deltas(events).map((d) => d.partial_json)).toEqual(["{}", '{"a":1}']);
	});

	test("interleaved fragments never error", async () => {
		const events = await run([
			chunk({ tool_calls: [call(0, { id: "t1", function: { name: "A", arguments: "{" } })] }),
			chunk({ tool_calls: [call(1, { id: "t2", function: { name: "B", arguments: "{" } })] }),
			chunk({ tool_calls: [call(0, { function: { arguments: "}" } })] }),
			chunk({ tool_calls: [call(1, { function: { arguments: "}" } })] }),
			chunk({}, {}, "tool_calls")
		]);
		expect(types(events)).not.toContain("error");
		expect(deltas(events).map((d) => d.partial_json)).toEqual(["{}", "{}"]);
		expect(events.at(-2).data.delta.stop_reason).toBe("tool_use");
	});

	test("a length stop with the highest-index call incomplete is max_tokens", async () => {
		const events = await run([
			chunk({
				tool_calls: [
					call(1, { id: "t2", function: { name: "B", arguments: '{"x"' } }),
					call(0, { id: "t1", function: { name: "A", arguments: "{}" } })
				]
			}),
			chunk({}, {}, "length")
		]);
		expect(events.at(-2).data.delta.stop_reason).toBe("max_tokens");
		const complete = await run([
			chunk({
				tool_calls: [
					call(1, { id: "t2", function: { name: "B", arguments: "{}" } }),
					call(0, { id: "t1", function: { name: "A", arguments: '{"x"' } })
				]
			}),
			chunk({}, {}, "length")
		]);
		expect(complete.at(-2).data.delta.stop_reason).toBe("tool_use");
	});

	test("toolStreaming defaults to buffer and rejects other values", async () => {
		const wire = [
			chunk({ tool_calls: [call(0, { id: "t1", function: { name: "A", arguments: "{" } })] }),
			chunk({ tool_calls: [call(0, { function: { arguments: "}" } })] }),
			chunk({}, {}, "tool_calls")
		];
		expect(deltas(await run(wire)).map((d) => d.partial_json)).toEqual(["{}"]);
		expect(deltas(await run(wire, undefined, { toolStreaming: "stream" })).map((d) => d.partial_json)).toEqual(["{", "}"]);
		await expect(collect(stream("", undefined, { toolStreaming: "sideways" }))).rejects.toThrow(/Invalid setting toolStreaming/);
	});
});

describe("truncation by length", () => {
	const call = (arguments_) => chunk({ tool_calls: [{ index: 0, id: "t1", function: { name: "A", arguments: arguments_ } }] });

	test("a length stop in the middle of a tool call is max_tokens", async () => {
		const events = await run([call('{"a":'), chunk({}, {}, "length")]);
		expect(events.at(-2).data.delta.stop_reason).toBe("max_tokens");
	});

	test("a complete call stays tool_use even with a length stop, and a call without arguments counts as complete", async () => {
		expect((await run([call('{"a":1}'), chunk({}, {}, "length")])).at(-2).data.delta.stop_reason).toBe("tool_use");
		expect(
			(await run([chunk({ tool_calls: [{ index: 0, id: "t", function: { name: "A" } }] }), chunk({}, {}, "length")])).at(-2).data.delta
				.stop_reason
		).toBe("tool_use");
	});

	test("only the last call decides", async () => {
		const events = await run([
			chunk({
				tool_calls: [
					{ index: 0, id: "t1", function: { name: "A", arguments: "{}" } },
					{ index: 1, id: "t2", function: { name: "B", arguments: '{"x"' } }
				]
			}),
			chunk({}, {}, "length")
		]);
		expect(events.at(-2).data.delta.stop_reason).toBe("max_tokens");
	});
});

describe("empty completions", () => {
	test("one empty text block is emitted so the message never has zero blocks", async () => {
		const events = await run([chunk({ role: "assistant", content: "" }), chunk({}, {}, "stop")]);
		expect(types(events)).toEqual(["message_start", "content_block_start", "content_block_stop", "message_delta", "message_stop"]);
		expect(events[1].data.content_block).toEqual({ type: "text", text: "" });
	});
});

describe("errors and truncation", () => {
	test("a mid-stream upstream error becomes an Anthropic error event and ends the stream", async () => {
		const events = await run([
			chunk({ content: "partial" }),
			{ error: { message: "engine died", type: "server_error", code: 500 } },
			chunk({ content: "ignored" })
		]);
		expect(events.at(-1)).toEqual({ event: "error", data: { type: "error", error: { type: "api_error", message: "engine died" } } });
		expect(types(events)).not.toContain("message_stop");
		expect(deltas(events)).toEqual([{ type: "text_delta", text: "partial" }]);
	});

	test("a numeric error code maps to the Anthropic type", async () => {
		const events = await run([{ error: { message: "busy", type: "server_error", code: 503 } }]);
		expect(events[0].data.error).toEqual({ type: "overloaded_error", message: "busy" });
	});

	test("error details: rate limits, defaults and context overflow wording", async () => {
		const rate = await run([{ error: { message: "slow down", type: "rate_limit_error", code: 429 } }]);
		expect(rate).toEqual([{ event: "error", data: { type: "error", error: { type: "rate_limit_error", message: "slow down" } } }]);
		const bare = await run([{ error: {} }]);
		expect(bare[0].data.error).toEqual({ type: "api_error", message: "Upstream error" });
		const overflow = await run([
			{
				error: {
					message:
						"This model's maximum context length is 1000 tokens. However, you requested 1500 tokens (1400 in the messages, 100 in the completion).",
					type: "BadRequestError",
					code: 400
				}
			}
		]);
		expect(overflow[0].data.error).toEqual({ type: "invalid_request_error", message: "prompt is too long: 1500 tokens > 1000 maximum" });
	});

	test("truncated and empty streams are reported, not faked", async () => {
		const truncated = await collect(stream(openaiSse([chunk({ content: "x" })])));
		expect(truncated.at(-1).data.error).toEqual({ type: "api_error", message: "Upstream stream ended before completion" });
		const empty = await collect(stream(""));
		expect(empty).toEqual([
			{ event: "error", data: { type: "error", error: { type: "api_error", message: "Upstream stream ended without data" } } }
		]);
		const doneOnly = await collect(stream("data: [DONE]\n\n"));
		expect(doneOnly[0].data.error.message).toBe("Upstream stream ended without data");
	});

	test("a failing source and invalid JSON are surfaced as error events", async () => {
		async function* failing() {
			yield `data: ${JSON.stringify(chunk({ content: "x" }))}\n\n`;
			throw new Error("socket hang up");
		}
		const events = await collect(stream(failing()));
		expect(events.at(-1)).toEqual({ event: "error", data: { type: "error", error: { type: "api_error", message: "socket hang up" } } });
		const invalid = await collect(stream("data: {nope\n\n"));
		expect(invalid[0].data.error).toEqual({ type: "api_error", message: expect.stringContaining("not valid JSON") });
	});

	test("closing the converter early closes the upstream source", async () => {
		let closed = false;
		async function* source() {
			try {
				for (;;) yield `data: ${JSON.stringify(chunk({ content: "x" }))}\n\n`;
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

describe("captured vLLM-style traffic", () => {
	test("Qwen3 thinking, then a tool call, then usage-only chunk, through slothlet", async () => {
		const api = await composeApi();
		const wire = openaiSse([
			chunk({ role: "assistant", content: "" }),
			chunk({ reasoning: "The user wants the file." }),
			chunk({ content: "I'll read it." }),
			chunk({ tool_calls: [{ index: 0, id: "chatcmpl-tool-9f2", type: "function", function: { name: "Read", arguments: "" } }] }),
			chunk({ tool_calls: [{ index: 0, function: { arguments: '{"file_path": "/tmp/x"}' } }] }),
			chunk({}, { stop_reason: null }, "tool_calls"),
			usageChunk({ prompt_tokens: 1234, completion_tokens: 56, total_tokens: 1290, prompt_tokens_details: null }),
			"[DONE]"
		]);
		const events = await collect(api.convert.openai.chat.to.anthropic.messages.stream(wire, { model: "claude-opus-5-5" }));
		expect(
			events
				.filter((e) => e.event.startsWith("content_block_start") || e.event === "message_delta")
				.map((e) => e.data.content_block?.type ?? e.data.delta.stop_reason)
		).toEqual(["thinking", "text", "tool_use", "tool_use"]);
		expect(events.at(-2).data.usage).toMatchObject({ input_tokens: 1234, output_tokens: 56 });
	});
});

/**
 * @fileoverview `context_management` `clear_tool_uses_20250919`: applied locally to the converted history and reported in the reply.
 * @module @cldmv/llm-translator/test/convert/context-clear-tool-uses
 */
import { describe, expect, test } from "vitest";
import { request } from "../../src/api/convert/anthropic/messages/to/openai/chat/request.mjs";
import { response } from "../../src/api/convert/openai/chat/to/anthropic/messages/response.mjs";
import { stream } from "../../src/api/convert/openai/chat/to/anthropic/messages/stream.mjs";
import { PLACEHOLDER } from "../../src/lib/context.mjs";
import { collect, openaiSse } from "../helpers/streams.mjs";

const TYPE = "clear_tool_uses_20250919";
const big = (n) => `result ${n} ` + "x".repeat(396);

/**
 * A conversation of `count` tool uses (Read, Grep, Read, ...), each result about 100 tokens, then a plain user turn.
 * @param {number} count - Tool uses.
 * @param {string[]} [names] - Tool names, used in rotation.
 * @returns {any[]} Anthropic messages.
 */
function history(count, names = ["Read"]) {
	const messages = [{ role: "user", content: "start" }];
	for (let n = 1; n <= count; n++) {
		const name = names[(n - 1) % names.length];
		messages.push({ role: "assistant", content: [{ type: "tool_use", id: `toolu_${n}`, name, input: { path: `/file/${n}` } }] });
		messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: `toolu_${n}`, content: big(n) }] });
	}
	messages.push({ role: "user", content: "go on" });
	return messages;
}
const body = (edit, count = 6, names) => ({
	model: "m",
	max_tokens: 10,
	messages: history(count, names),
	context_management: { edits: [{ type: TYPE, ...edit }] }
});
const results = (out) => out.body.messages.filter((m) => m.role === "tool").map((m) => m.content);
const cleared = (out) => results(out).map((content) => content === PLACEHOLDER);
const argumentsOf = (out) => out.body.messages.filter((m) => m.tool_calls).map((m) => m.tool_calls[0].function.arguments);

describe("clear_tool_uses trigger", () => {
	test("does nothing below the default trigger (100000 input tokens) and reports an empty list", async () => {
		const out = await request(body({}));
		expect(cleared(out)).toEqual([false, false, false, false, false, false]);
		expect(out.state.dropped).toEqual([]);
		expect(out.state.appliedEdits).toEqual([]);
	});

	test("an input_tokens trigger applies once the estimated prompt is larger", async () => {
		const below = await request(body({ trigger: { type: "input_tokens", value: 5000 } }));
		expect(below.state.appliedEdits).toEqual([]);
		const above = await request(body({ trigger: { type: "input_tokens", value: 500 } }));
		expect(cleared(above)).toEqual([true, true, true, false, false, false]);
	});

	test("the threshold itself does not trigger, one more does", async () => {
		const out = await request(body({ trigger: { type: "tool_uses", value: 6 } }));
		expect(out.state.appliedEdits).toEqual([]);
		const over = await request(body({ trigger: { type: "tool_uses", value: 5 } }));
		expect(over.state.appliedEdits).toHaveLength(1);
	});
});

describe("clear_tool_uses keep", () => {
	test("keeps the 3 newest tool uses by default and clears the oldest first", async () => {
		const out = await request(body({ trigger: { type: "tool_uses", value: 1 } }));
		expect(cleared(out)).toEqual([true, true, true, false, false, false]);
		expect(results(out).slice(3)).toEqual([big(4), big(5), big(6)]);
		expect(out.state.appliedEdits).toEqual([{ type: TYPE, cleared_tool_uses: 3, cleared_input_tokens: expect.any(Number) }]);
		expect(out.state.appliedEdits[0].cleared_input_tokens).toBeGreaterThan(250);
	});

	test.each([
		[1, [true, true, true, true, true, false]],
		[0, [true, true, true, true, true, true]],
		[10, [false, false, false, false, false, false]]
	])("keep %i", async (value, expected) => {
		const out = await request(body({ trigger: { type: "tool_uses", value: 1 }, keep: { type: "tool_uses", value } }));
		expect(cleared(out)).toEqual(expected);
		expect(out.state.appliedEdits).toHaveLength(expected.includes(true) ? 1 : 0);
	});

	test("leaves the call itself and the conversation shape intact", async () => {
		const plain = await request({ ...body({}), context_management: undefined });
		const out = await request(body({ trigger: { type: "tool_uses", value: 1 } }));
		expect(out.body.messages.map((m) => m.role)).toEqual(plain.body.messages.map((m) => m.role));
		expect(argumentsOf(out)).toEqual(argumentsOf(plain));
		expect(out.body.messages.filter((m) => m.role === "tool").map((m) => m.tool_call_id)).toEqual(
			plain.body.messages.filter((m) => m.role === "tool").map((m) => m.tool_call_id)
		);
	});

	test("a tool use without a result yet is never counted as cleared", async () => {
		const input = body({ trigger: { type: "tool_uses", value: 1 }, keep: { type: "tool_uses", value: 0 } }, 2);
		input.messages.splice(2, 1);
		const out = await request(input);
		expect(out.state.appliedEdits[0].cleared_tool_uses).toBe(1);
	});
});

describe("clear_tool_uses clear_at_least", () => {
	test("applies when at least that many tokens are freed, and reports the amount", async () => {
		const out = await request(body({ trigger: { type: "tool_uses", value: 1 }, clear_at_least: { type: "input_tokens", value: 200 } }));
		expect(cleared(out)).toEqual([true, true, true, false, false, false]);
		expect(out.state.appliedEdits[0].cleared_input_tokens).toBeGreaterThanOrEqual(200);
	});

	test("does nothing, and clears nothing, when less would be freed", async () => {
		const out = await request(body({ trigger: { type: "tool_uses", value: 1 }, clear_at_least: { type: "input_tokens", value: 5000 } }));
		expect(cleared(out)).toEqual([false, false, false, false, false, false]);
		expect(out.state.appliedEdits).toEqual([]);
	});
});

describe("clear_tool_uses exclude_tools", () => {
	test("never clears the results of the named tools, and they still occupy the keep window", async () => {
		const out = await request(
			body({ trigger: { type: "tool_uses", value: 1 }, keep: { type: "tool_uses", value: 2 }, exclude_tools: ["Grep"] }, 6, [
				"Read",
				"Grep"
			])
		);
		// Uses 1..4 are outside the window; 2 and 4 are Grep.
		expect(cleared(out)).toEqual([true, false, true, false, false, false]);
		expect(out.state.appliedEdits[0].cleared_tool_uses).toBe(2);
	});

	test("matches the client's tool name even when the wire name was rewritten", async () => {
		const input = body(
			{ trigger: { type: "tool_uses", value: 1 }, keep: { type: "tool_uses", value: 0 }, exclude_tools: ["mcp.srv:do it"] },
			2,
			["mcp.srv:do it", "Read"]
		);
		const out = await request(input);
		expect(cleared(out)).toEqual([false, true]);
	});

	test("with every candidate excluded nothing is applied", async () => {
		const out = await request(body({ trigger: { type: "tool_uses", value: 1 }, exclude_tools: ["Read"] }));
		expect(out.state.appliedEdits).toEqual([]);
	});
});

describe("clear_tool_uses clear_tool_inputs", () => {
	test("is off by default: the call arguments stay", async () => {
		const out = await request(body({ trigger: { type: "tool_uses", value: 1 } }));
		expect(argumentsOf(out)[0]).toBe('{"path":"/file/1"}');
	});

	test("clears the arguments of the cleared uses as well, and counts their tokens", async () => {
		const off = await request(body({ trigger: { type: "tool_uses", value: 1 } }));
		const on = await request(body({ trigger: { type: "tool_uses", value: 1 }, clear_tool_inputs: true }));
		expect(argumentsOf(on)).toEqual(["{}", "{}", "{}", '{"path":"/file/4"}', '{"path":"/file/5"}', '{"path":"/file/6"}']);
		expect(on.state.appliedEdits[0].cleared_input_tokens).toBeGreaterThan(off.state.appliedEdits[0].cleared_input_tokens);
	});
});

describe("clear_tool_uses combined with other edits and a replayed history", () => {
	test("works next to clear_thinking, and an unknown edit is still dropped", async () => {
		const input = body({ trigger: { type: "tool_uses", value: 1 } });
		input.context_management.edits.unshift({ type: "clear_thinking_20251015", keep: "all" });
		input.context_management.edits.push({ type: "compact_20260112" });
		const out = await request(input);
		expect(out.state.dropped).toEqual(["context_management.compact_20260112"]);
		expect(out.state.appliedEdits).toHaveLength(1);
	});

	test("a second pass over an already cleared history clears nothing more", async () => {
		const input = body({ trigger: { type: "tool_uses", value: 1 } });
		input.messages = input.messages.map((m) =>
			Array.isArray(m.content) &&
			m.content[0].type === "tool_result" &&
			["toolu_1", "toolu_2", "toolu_3"].includes(m.content[0].tool_use_id)
				? { ...m, content: [{ ...m.content[0], content: PLACEHOLDER }] }
				: m
		);
		const out = await request(input);
		expect(out.state.appliedEdits).toEqual([]);
		expect(cleared(out)).toEqual([true, true, true, false, false, false]);
	});

	test("a tool result with several parts becomes one placeholder", async () => {
		const input = body({ trigger: { type: "tool_uses", value: 0 }, keep: { type: "tool_uses", value: 0 } }, 1);
		input.messages[2].content[0].content = [
			{ type: "text", text: "a" },
			{ type: "text", text: "b" }
		];
		const out = await request(input);
		expect(results(out)).toEqual([PLACEHOLDER]);
	});

	test("assistant turns without tool calls are passed over", async () => {
		const input = body({ trigger: { type: "tool_uses", value: 1 }, keep: { type: "tool_uses", value: 0 } }, 2);
		input.messages.splice(1, 0, { role: "assistant", content: "thinking out loud" }, { role: "user", content: "ok" });
		const out = await request(input);
		expect(out.state.appliedEdits[0].cleared_tool_uses).toBe(2);
		expect(out.body.messages.some((m) => m.content === "thinking out loud")).toBe(true);
	});

	test("with no tool uses there is nothing to clear", async () => {
		const out = await request(body({ trigger: { type: "tool_uses", value: 0 } }, 0));
		expect(out.state.appliedEdits).toEqual([]);
	});
});

describe("clear_tool_uses parameters that cannot be honoured are dropped", () => {
	test.each([
		["trigger type", { trigger: { type: "bytes", value: 5 } }],
		["trigger value", { trigger: { type: "tool_uses", value: -1 } }],
		["trigger shape", { trigger: 5 }],
		["trigger null", { trigger: null }],
		["keep type", { keep: { type: "input_tokens", value: 5 } }],
		["keep value", { keep: { type: "tool_uses", value: 1.5 } }],
		["clear_at_least type", { clear_at_least: { type: "tool_uses", value: 5 } }],
		["exclude_tools shape", { exclude_tools: "Read" }],
		["exclude_tools entries", { exclude_tools: ["Read", 1] }],
		["clear_tool_inputs", { clear_tool_inputs: "yes" }]
	])("%s", async (_name, edit) => {
		const out = await request(body({ trigger: { type: "tool_uses", value: 1 }, ...edit }));
		expect(out.state.dropped).toEqual([`context_management.${TYPE}`]);
		expect(out.state.appliedEdits).toBeUndefined();
		expect(cleared(out)).toEqual([false, false, false, false, false, false]);
	});

	test("a request without clear_tool_uses has no appliedEdits", async () => {
		const out = await request({ model: "m", max_tokens: 1, messages: [{ role: "user", content: "hi" }] });
		expect(out.state.appliedEdits).toBeUndefined();
	});
});

describe("applied edits reach the client", () => {
	const completion = {
		id: "c",
		object: "chat.completion",
		model: "m",
		choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }]
	};
	const edits = [{ type: TYPE, cleared_tool_uses: 3, cleared_input_tokens: 300 }];

	test("non-streaming: context_management.applied_edits on the message", () => {
		expect(response(completion, { appliedEdits: edits }).context_management).toEqual({ applied_edits: edits });
		expect(response(completion, { appliedEdits: [] }).context_management).toEqual({ applied_edits: [] });
		expect(response(completion, {})).not.toHaveProperty("context_management");
		expect(response(completion)).not.toHaveProperty("context_management");
	});

	const chunks = [
		{
			id: "c",
			object: "chat.completion.chunk",
			model: "m",
			choices: [{ index: 0, delta: { role: "assistant", content: "ok" }, finish_reason: null }]
		},
		{ id: "c", object: "chat.completion.chunk", model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
		"[DONE]"
	];

	test("streaming: context_management rides on the final message_delta", async () => {
		const events = await collect(stream(openaiSse(chunks), { appliedEdits: edits }));
		const last = events.filter((e) => e.event === "message_delta");
		expect(last).toHaveLength(1);
		expect(last[0].data.context_management).toEqual({ applied_edits: edits });
		const plain = await collect(stream(openaiSse(chunks), {}));
		expect(plain.find((e) => e.event === "message_delta").data).not.toHaveProperty("context_management");
	});

	test("end to end: a request that clears tool uses gets the report in its reply", async () => {
		const converted = await request(body({ trigger: { type: "tool_uses", value: 1 } }));
		const out = response(completion, converted.state);
		expect(out.context_management.applied_edits).toEqual([{ type: TYPE, cleared_tool_uses: 3, cleared_input_tokens: expect.any(Number) }]);
	});
});

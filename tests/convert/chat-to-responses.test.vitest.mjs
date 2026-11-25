/**
 * @fileoverview Chat Completions reply and chunks to Responses object and stream events.
 */
import { describe, expect, it } from "vitest";
import { response } from "../../src/api/convert/openai/chat/to/openai/responses/response.mjs";
import { stream } from "../../src/api/convert/openai/chat/to/openai/responses/stream.mjs";
import { pack, unpack, failureOf } from "../../src/lib/responses.mjs";
import { collect, openaiSse } from "../helpers/streams.mjs";

const state = { model: "m", echo: { instructions: "i", store: false } };
const wrap = (message, finish = "stop", usage) => ({
	id: "chatcmpl-1",
	object: "chat.completion",
	created: 7,
	model: "upstream-m",
	choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: finish }],
	...(usage ? { usage } : {})
});

describe("response id", () => {
	it("is the one the caller chose in state.id, else a new one, in the object and in the stream", async () => {
		const chosen = { ...state, id: "resp_chosen000000" };
		expect(response(wrap({ content: "x" }), chosen).id).toBe("resp_chosen000000");
		expect(response(wrap({ content: "x" }), state).id).not.toBe("resp_chosen000000");
		const chunks = [
			{ choices: [{ index: 0, delta: { content: "x" }, finish_reason: null }] },
			{ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }
		];
		expect((await run(chunks, undefined, chosen)).at(-1).data.response.id).toBe("resp_chosen000000");
		expect((await run(chunks, undefined, state)).at(-1).data.response.id).toMatch(/^resp_[0-9a-f]{24}$/);
	});
});

describe("response", () => {
	it("builds a completed response from text, with usage and the echoed request parameters", () => {
		const out = response(
			wrap({ content: "hello" }, "stop", {
				prompt_tokens: 10,
				completion_tokens: 4,
				total_tokens: 14,
				prompt_tokens_details: { cached_tokens: 3 },
				completion_tokens_details: { reasoning_tokens: 1 }
			}),
			state
		);
		expect(out).toMatchObject({
			object: "response",
			status: "completed",
			error: null,
			incomplete_details: null,
			created_at: 7,
			model: "m",
			instructions: "i",
			store: false,
			usage: {
				input_tokens: 10,
				input_tokens_details: { cached_tokens: 3 },
				output_tokens: 4,
				output_tokens_details: { reasoning_tokens: 1 },
				total_tokens: 14
			}
		});
		expect(out.id).toMatch(/^resp_[0-9a-f]{24}$/);
		expect(out.output).toEqual([
			{
				type: "message",
				id: expect.stringMatching(/^msg_/),
				status: "completed",
				role: "assistant",
				content: [{ type: "output_text", text: "hello", annotations: [], logprobs: [] }]
			}
		]);
	});

	it("orders reasoning, message and function calls, and carries reasoning_details with reasoningRoundTrip", () => {
		const details = [{ type: "reasoning.text", text: "t", signature: "s", format: "anthropic-claude-v1", index: 0 }];
		const message = {
			content: "ok",
			reasoning: "thought",
			reasoning_details: details,
			tool_calls: [
				{ id: "c1", type: "function", function: { name: "a", arguments: '{"x":1}' } },
				{ id: "c2", type: "function", function: { name: "b" } }
			]
		};
		const out = response(wrap(message, "tool_calls"), { ...state, model: undefined }, { reasoningRoundTrip: true });
		expect(out.model).toBe("upstream-m");
		expect(out.output.map((item) => item.type)).toEqual(["reasoning", "message", "function_call", "function_call"]);
		expect(out.output[0]).toMatchObject({ summary: [{ type: "summary_text", text: "thought" }], status: "completed" });
		expect(unpack(out.output[0].encrypted_content)).toEqual(details);
		expect(out.output[2]).toMatchObject({ call_id: "c1", name: "a", arguments: '{"x":1}', status: "completed" });
		expect(out.output[3]).toMatchObject({ call_id: "c2", arguments: "" });
		expect(out.usage).toBeNull();
		const plain = response(wrap(message, "tool_calls"), state);
		expect(plain.output[0]).not.toHaveProperty("encrypted_content");
		const only = response(wrap({ content: "", reasoning_details: details }), state, { reasoningRoundTrip: true });
		expect(only.output).toHaveLength(1);
		expect(only.output[0].summary).toEqual([]);
		expect(response(wrap({ content: "x", reasoning_details: "no" }), state, { reasoningRoundTrip: true }).output).toHaveLength(1);
	});

	it("reports a length stop and a content filter as incomplete, and a refusal as a refusal part", () => {
		expect(response(wrap({ content: "cut" }, "length"), state)).toMatchObject({
			status: "incomplete",
			incomplete_details: { reason: "max_output_tokens" }
		});
		expect(response(wrap({ content: "cut" }, "model_length"), state).status).toBe("incomplete");
		const filtered = response(wrap({ content: null, refusal: "no" }, "content_filter"), state);
		expect(filtered).toMatchObject({ status: "incomplete", incomplete_details: { reason: "content_filter" } });
		expect(filtered.output[0].content).toEqual([{ type: "refusal", refusal: "no" }]);
	});

	it("builds an empty output for an empty message and fails without choices", () => {
		expect(response(wrap({ content: null }), state).output).toEqual([]);
		expect(response({ ...wrap({}), created: undefined, choices: [{ index: 0, finish_reason: "stop" }] }, state).created_at).toBeTypeOf(
			"number"
		);
		expect(() => response({ choices: [] }, state)).toThrow(/no choices/);
		expect(() => response(undefined, state)).toThrow(/no choices/);
	});
});

describe("helpers", () => {
	it("packs and unpacks reasoning details and refuses anything else", () => {
		expect(pack(undefined)).toBeUndefined();
		expect(pack([])).toBeUndefined();
		expect(unpack(pack([{ a: 1 }]))).toEqual([{ a: 1 }]);
		expect(unpack(5)).toBeNull();
		expect(unpack("other:xx")).toBeNull();
		expect(unpack("llmt-rs1:" + "x".repeat(3 * 1024 * 1024))).toBeNull();
		expect(unpack("llmt-rs1:" + Buffer.from("{bad").toString("base64url"))).toBeNull();
		expect(unpack("llmt-rs1:" + Buffer.from('{"a":1}').toString("base64url"))).toBeNull();
		expect(unpack("llmt-rs1:" + Buffer.from("[1]").toString("base64url"))).toBeNull();
		expect(unpack("llmt-rs1:" + Buffer.from("[[]]").toString("base64url"))).toBeNull();
		expect(unpack(pack(Array.from({ length: 65 }, () => ({}))))).toBeNull();
	});

	it("turns an error into a failure code and message", () => {
		expect(failureOf({ code: "x", message: "m" })).toEqual({ code: "x", message: "m" });
		expect(failureOf({ code: 502, message: "m" })).toEqual({ code: "server_error", message: "m" });
		expect(failureOf(undefined)).toEqual({ code: "server_error", message: "Upstream stream failed" });
	});
});

const chunk = (delta, finish = null, extra = {}) => ({
	id: "c",
	object: "chat.completion.chunk",
	created: 1,
	model: "upstream-m",
	choices: [{ index: 0, delta, finish_reason: finish }],
	...extra
});
const usageChunk = (usage) => ({ id: "c", object: "chat.completion.chunk", model: "upstream-m", choices: [], usage });
const run = (chunks, settings, given = state) => collect(stream(openaiSse([...chunks, "[DONE]"]), given, settings));
const names = (events) => events.map((event) => event.event);

describe("stream", () => {
	it("streams text with the full event sequence and a completed response", async () => {
		const events = await run([
			chunk({ role: "assistant", content: "" }),
			chunk({ content: "Hel" }),
			chunk({ content: "lo" }),
			chunk({}, "stop"),
			usageChunk({ prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 })
		]);
		expect(names(events)).toEqual([
			"response.created",
			"response.in_progress",
			"response.output_item.added",
			"response.content_part.added",
			"response.output_text.delta",
			"response.output_text.delta",
			"response.output_text.done",
			"response.content_part.done",
			"response.output_item.done",
			"response.completed"
		]);
		expect(events.map((event) => event.data.sequence_number)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
		expect(events.every((event) => event.data.type === event.event)).toBe(true);
		const [created, , added, part, first, , done] = events;
		expect(created.data.response).toMatchObject({ status: "in_progress", output: [], usage: null, model: "m", instructions: "i" });
		expect(added.data).toMatchObject({ output_index: 0, item: { type: "message", status: "in_progress", role: "assistant", content: [] } });
		expect(part.data).toMatchObject({ content_index: 0, part: { type: "output_text", text: "" } });
		expect(first.data).toMatchObject({ delta: "Hel", item_id: added.data.item.id, output_index: 0, content_index: 0 });
		expect(done.data).toMatchObject({ text: "Hello" });
		const completed = events.at(-1).data.response;
		expect(completed).toMatchObject({ status: "completed", usage: { input_tokens: 5, output_tokens: 2, total_tokens: 7 } });
		expect(completed.output[0]).toMatchObject({ status: "completed", content: [{ type: "output_text", text: "Hello" }] });
		expect(completed.id).toBe(created.data.response.id);
	});

	it("streams reasoning as a summary, then text, then function calls, closing each item in turn", async () => {
		const details = [{ type: "reasoning.text", text: "t", signature: "s", format: "anthropic-claude-v1", index: 0 }];
		const events = await run(
			[
				chunk({ role: "assistant", reasoning: "think" }),
				chunk({ reasoning_content: "ing" }),
				chunk({ reasoning_details: [details[0]] }),
				chunk({ content: "ok" }),
				chunk({ tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "f", arguments: "" } }] }),
				chunk({ tool_calls: [{ index: 0, function: { arguments: '{"a"' } }] }),
				chunk({ tool_calls: [{ index: 1, id: "c2", type: "function", function: { name: "g", arguments: "{}" } }] }),
				chunk({ tool_calls: [{ index: 0, function: { arguments: ":1}" } }] }),
				chunk({}, "tool_calls"),
				usageChunk({ prompt_tokens: 1, completion_tokens: 1 })
			],
			{ reasoningRoundTrip: true }
		);
		expect(names(events)).toEqual([
			"response.created",
			"response.in_progress",
			"response.output_item.added",
			"response.reasoning_summary_part.added",
			"response.reasoning_summary_text.delta",
			"response.reasoning_summary_text.delta",
			"response.reasoning_summary_text.done",
			"response.reasoning_summary_part.done",
			"response.output_item.done",
			"response.output_item.added",
			"response.content_part.added",
			"response.output_text.delta",
			"response.output_text.done",
			"response.content_part.done",
			"response.output_item.done",
			"response.output_item.added",
			"response.function_call_arguments.delta",
			"response.output_item.added",
			"response.function_call_arguments.delta",
			"response.function_call_arguments.delta",
			"response.function_call_arguments.done",
			"response.output_item.done",
			"response.function_call_arguments.done",
			"response.output_item.done",
			"response.completed"
		]);
		const reasoningDone = events[8].data.item;
		expect(reasoningDone).toMatchObject({ type: "reasoning", summary: [{ type: "summary_text", text: "thinking" }], status: "completed" });
		expect(unpack(reasoningDone.encrypted_content)).toEqual(details);
		const final = events.at(-1).data.response;
		expect(final.output.map((item) => item.type)).toEqual(["reasoning", "message", "function_call", "function_call"]);
		expect(final.output[2]).toMatchObject({ call_id: "c1", name: "f", arguments: '{"a":1}', status: "completed" });
		expect(final.output[3]).toMatchObject({ call_id: "c2", name: "g", arguments: "{}" });
		expect(events.find((event) => event.event === "response.function_call_arguments.done").data).toMatchObject({
			name: "f",
			arguments: '{"a":1}',
			output_index: 2
		});
	});

	it("leaves the carrier out without reasoningRoundTrip, and handles reasoning that arrives only as details", async () => {
		const details = [{ type: "reasoning.encrypted", data: "d", format: "anthropic-claude-v1", index: 0 }];
		const events = await run([chunk({ reasoning_details: details }), chunk({ content: "x" }), chunk({}, "stop")]);
		expect(names(events)).not.toContain("response.reasoning_summary_part.added");
		const item = events.find((event) => event.event === "response.output_item.done").data.item;
		expect(item).toMatchObject({ type: "reasoning", summary: [] });
		expect(item).not.toHaveProperty("encrypted_content");
		const carried = await run([chunk({ reasoning_details: details }), chunk({}, "stop")], { reasoningRoundTrip: true });
		expect(carried.find((event) => event.event === "response.output_item.done").data.item.encrypted_content).toBeTypeOf("string");
	});

	it("streams a refusal, and starts a new message when text follows it", async () => {
		const events = await run([chunk({ refusal: "no" }), chunk({ refusal: "pe" }), chunk({ content: "but" }), chunk({}, "content_filter")]);
		expect(names(events).filter((name) => name.startsWith("response.refusal"))).toEqual([
			"response.refusal.delta",
			"response.refusal.delta",
			"response.refusal.done"
		]);
		expect(events.find((event) => event.event === "response.refusal.done").data.refusal).toBe("nope");
		const last = events.at(-1);
		expect(last.event).toBe("response.incomplete");
		expect(last.data.response).toMatchObject({ status: "incomplete", incomplete_details: { reason: "content_filter" } });
		expect(last.data.response.output.map((item) => item.content[0].type)).toEqual(["refusal", "output_text"]);
	});

	it("ends with response.incomplete after a length stop", async () => {
		const events = await run([chunk({ content: "x" }, "length")]);
		expect(events.at(-1)).toMatchObject({
			event: "response.incomplete",
			data: { response: { incomplete_details: { reason: "max_output_tokens" } } }
		});
	});

	it("takes the model from the chunks when the request did not name one, and reads SSE text in slices", async () => {
		const noModel = { echo: {} };
		const events = await run([chunk({ content: "x" }), chunk({}, "stop")], undefined, noModel);
		expect(events.at(-1).data.response.model).toBe("upstream-m");
		const bare = await collect(stream([{ data: chunk({ content: "y" }) }, { data: chunk({}, "stop") }], { echo: {}, model: "z" }));
		expect(bare.at(-1).data.response.output[0].content[0].text).toBe("y");
	});

	it("ignores chunks without choices or a usable delta", async () => {
		const events = await run([
			{ id: "c", choices: [] },
			{ id: "c", choices: [{ index: 0 }] },
			chunk({}),
			chunk({ content: "" }),
			chunk({ tool_calls: [{ index: 0, function: {} }] }),
			chunk({}, "stop")
		]);
		expect(names(events)).toEqual([
			"response.created",
			"response.in_progress",
			"response.output_item.added",
			"response.function_call_arguments.done",
			"response.output_item.done",
			"response.completed"
		]);
		expect(events[4].data.item).toMatchObject({ type: "function_call", call_id: "", name: "", arguments: "" });
	});

	it("fills in a call id and name that arrive after the first delta", async () => {
		const events = await run([
			chunk({ tool_calls: [{ index: 0 }] }),
			chunk({ tool_calls: [{ index: 0, id: "c9", function: { name: "late" } }] }),
			chunk({ tool_calls: [{ id: "c9", function: { name: "other", arguments: "{}" } }] }),
			chunk({}, "tool_calls")
		]);
		expect(events.at(-1).data.response.output[0]).toMatchObject({ call_id: "c9", name: "late", arguments: "{}" });
	});

	it("ends with response.failed for an error chunk, a fatal finish reason and a stream that ends early", async () => {
		const errored = await run([chunk({ content: "a" }), { error: { message: "boom", type: "server_error", code: "overloaded" } }]);
		expect(errored.at(-1)).toMatchObject({
			event: "response.failed",
			data: { response: { status: "failed", error: { code: "overloaded", message: "boom" } } }
		});
		const fatal = await run([chunk({ content: "a" }, "error")]);
		expect(fatal.at(-1).data.response.error.code).toBe("upstream_finish_error");
		const early = await run([chunk({ content: "a" })]);
		expect(early.at(-1).data.response.error).toEqual({ code: "server_error", message: "Upstream stream ended before completion" });
		const broken = await collect(
			stream(
				(async function* () {
					yield { data: chunk({ content: "a" }) };
					throw new Error("socket closed");
				})(),
				state
			)
		);
		expect(broken.at(-1).data.response.error).toEqual({ code: "server_error", message: "socket closed" });
	});
});

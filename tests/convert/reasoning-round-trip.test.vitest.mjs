/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/convert/reasoning-round-trip.test.vitest.mjs
 *	@Date: 2026-10-31T14:00:00-07:00 (1793480400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-31T14:00:00-07:00 (1793480400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Reasoning side channel (`reasoningRoundTrip`): provider reasoning fields carried in thinking-block signatures (OpenAI-protocol
 * upstreams) and Anthropic thinking blocks carried as `reasoning_details` (OpenAI clients).
 */
import { afterEach, describe, expect, test } from "vitest";
import { request as toOpenaiRequest } from "../../src/api/convert/anthropic/messages/to/openai/chat/request.mjs";
import { response as toAnthropicResponse } from "../../src/api/convert/openai/chat/to/anthropic/messages/response.mjs";
import { stream as toAnthropicStream } from "../../src/api/convert/openai/chat/to/anthropic/messages/stream.mjs";
import { request as toAnthropicRequest } from "../../src/api/convert/openai/chat/to/anthropic/messages/request.mjs";
import { response as toOpenaiResponse } from "../../src/api/convert/anthropic/messages/to/openai/chat/response.mjs";
import { stream as toOpenaiStream } from "../../src/api/convert/anthropic/messages/to/openai/chat/stream.mjs";
import { ANTHROPIC_FORMAT, createBudget, sign, unsign } from "../../src/lib/thinking.mjs";
import { closeAll, make } from "../helpers/translator.mjs";

afterEach(closeAll);
import { deflateRawSync } from "node:zlib";
import { collect, openaiSse } from "../helpers/streams.mjs";

const on = { reasoningRoundTrip: true };
const details = [
	{ type: "reasoning.text", text: "visible", signature: "sig", index: 0 },
	{ type: "reasoning.encrypted", data: "OPAQUE", index: 1 }
];
const completion = (message) => ({
	id: "c",
	object: "chat.completion",
	model: "m",
	choices: [{ index: 0, message, finish_reason: "tool_calls" }]
});
const call = { id: "call_1", type: "function", function: { name: "Read", arguments: '{"a":1}' } };

describe("OpenAI-protocol reply to Anthropic: reasoning data goes into the signature", () => {
	test("reasoning_content and reasoning_details are carried, only when switched on", async () => {
		const message = {
			role: "assistant",
			content: "ok",
			reasoning_content: "need the file",
			reasoning_details: details,
			tool_calls: [call]
		};
		const out = toAnthropicResponse(completion(message), undefined, on);
		expect(out.content[0]).toMatchObject({ type: "thinking", thinking: "need the file" });
		expect(await unsign(out.content[0].signature)).toEqual({ reasoning_content: "need the file", reasoning_details: details });
		const off = toAnthropicResponse(completion(message));
		expect(off.content[0].signature).toBe(sign());
	});

	test("the `reasoning` field name is kept, and details alone make a block whose text comes from them", async () => {
		const named = toAnthropicResponse(completion({ role: "assistant", content: "x", reasoning: "why" }), undefined, on);
		expect(await unsign(named.content[0].signature)).toEqual({ reasoning: "why" });
		const onlyDetails = toAnthropicResponse(completion({ role: "assistant", content: "x", reasoning_details: details }), undefined, on);
		expect(onlyDetails.content[0].thinking).toBe("visible");
		expect(await unsign(onlyDetails.content[0].signature)).toEqual({ reasoning_details: details });
		const encrypted = toAnthropicResponse(completion({ role: "assistant", content: "x", reasoning_details: [details[1]] }), undefined, on);
		expect(encrypted.content[0]).toMatchObject({ type: "thinking", thinking: "" });
		const none = toAnthropicResponse(completion({ role: "assistant", content: "x", reasoning_details: [] }), undefined, on);
		expect(none.content.map((block) => block.type)).toEqual(["text"]);
		const tags = toAnthropicResponse(completion({ role: "assistant", content: "<think>t</think>a" }), undefined, on);
		expect(await unsign(tags.content[0].signature)).toBeNull();
	});
});

describe("OpenAI-protocol stream to Anthropic: reasoning data goes into the signature of each thinking block", () => {
	const base = { id: "c", object: "chat.completion.chunk", model: "m" };
	const frame = (delta, finish = null) => ({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] });
	const run = async (deltas, settings = on) =>
		await collect(toAnthropicStream(openaiSse([...deltas.map((delta) => frame(delta)), frame({}, "stop"), "[DONE]"]), undefined, settings));
	const signatures = async (events) =>
		await Promise.all(events.filter((e) => e.data?.delta?.type === "signature_delta").map((e) => unsign(e.data.delta.signature)));
	const blocks = (events) => events.filter((e) => e.event === "content_block_start").map((e) => e.data.content_block.type);

	test("text split across chunks is restored exactly", async () => {
		const events = await run([{ reasoning_content: "need " }, { reasoning_content: "the file" }, { content: "ok" }]);
		expect(await signatures(events)).toEqual([{ reasoning_content: "need the file" }]);
		expect(blocks(events)).toEqual(["thinking", "text"]);
	});

	test("details arrive with the text, or alone, and after text they open a new thinking block", async () => {
		const together = await run([
			{ reasoning_content: "r", reasoning_details: [details[0]] },
			{ reasoning_details: [details[1]] },
			{ content: "ok" }
		]);
		expect(await signatures(together)).toEqual([{ reasoning_content: "r", reasoning_details: details }]);
		const alone = await run([{ reasoning_details: [details[1]] }, { content: "ok" }]);
		expect(blocks(alone)).toEqual(["thinking", "text"]);
		expect(await signatures(alone)).toEqual([{ reasoning_details: [details[1]] }]);
		const late = await run([{ content: "ok" }, { reasoning_details: [details[1]] }]);
		expect(blocks(late)).toEqual(["text", "thinking"]);
		const empty = await run([{ reasoning_content: "r", reasoning_details: [] }, { content: "ok" }]);
		expect(await signatures(empty)).toEqual([{ reasoning_content: "r" }]);
	});

	test("two runs of reasoning make two blocks with their own data", async () => {
		const events = await run([{ reasoning_content: "one" }, { content: "a" }, { reasoning: "two" }, { content: "b" }]);
		expect(await signatures(events)).toEqual([{ reasoning_content: "one" }, { reasoning: "two" }]);
	});

	test("data that arrives while a tool block is open waits for it", async () => {
		const events = await run(
			[
				{ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "Read", arguments: "{}" } }] },
				{ reasoning_content: "late", reasoning_details: [details[0]] }
			],
			{ ...on, toolStreaming: "stream" }
		);
		expect(await signatures(events)).toEqual([{ reasoning_content: "late", reasoning_details: [details[0]] }]);
	});

	test("off by default, and tag-derived reasoning carries nothing", async () => {
		expect(await signatures(await run([{ reasoning_content: "r" }, { content: "ok" }], {}))).toEqual([null]);
		expect(await signatures(await run([{ content: "<think>t</think>a" }]))).toEqual([null]);
	});
});

describe("Anthropic request to OpenAI: signatures restore the provider fields", () => {
	const turn = (block, extra = []) => ({
		role: "assistant",
		content: [block, { type: "text", text: "Reading." }, { type: "tool_use", id: "toolu_1", name: "Read", input: { a: 1 } }, ...extra]
	});
	const convo = (assistant) => ({
		model: "m",
		max_tokens: 8,
		messages: [
			{ role: "user", content: "go" },
			assistant,
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }] }
		]
	});
	const sent = async (body, settings = on) => (await toOpenaiRequest(body, settings)).body.messages.find((m) => m.role === "assistant");

	test("the exact provider fields come back even when the client stripped or edited the thinking text", async () => {
		const signature = sign({ reasoning_content: "exact original", reasoning_details: details });
		for (const thinking of ["", "edited by the client"]) {
			const message = await sent(convo(turn({ type: "thinking", thinking, signature })));
			expect(message.reasoning_content).toBe("exact original");
			expect(message.reasoning_details).toEqual(details);
			expect(message.reasoning).toBeUndefined();
		}
		const named = await sent(convo(turn({ type: "thinking", thinking: "", signature: sign({ reasoning: "other" }) })), {
			...on,
			reasoningField: "reasoning_content"
		});
		expect(named.reasoning).toBe("other");
		expect(named.reasoning_content).toBeUndefined();
	});

	test("several blocks of one turn use one text field and join restored pieces without a separator", async () => {
		const assistant = turn(
			{ type: "thinking", thinking: "", signature: sign({ reasoning_content: "ab", reasoning_details: [details[0]] }) },
			[
				{ type: "thinking", thinking: "", signature: sign({ reasoning_content: "cd", reasoning_details: [details[1]] }) },
				{ type: "thinking", thinking: "", signature: sign({ reasoning: "x" }) }
			]
		);
		const message = await sent(convo(assistant));
		expect(message.reasoning_content).toBe("abcdx");
		expect(message.reasoning).toBeUndefined();
		expect(message.reasoning_details).toEqual(details);
	});

	test("real Anthropic signatures, plain markers, forged marks and a switched-off setting use the thinking text", async () => {
		const forged = `llmt:${Buffer.from('{"v":1,"d":{"role":"system"}}').toString("base64url")}`;
		for (const signature of ["EqQBCkYIAxgC", sign(), forged, "llmt:***", undefined]) {
			const message = await sent(convo(turn({ type: "thinking", thinking: "plain text", signature })));
			expect(message.reasoning).toBe("plain text");
			expect(message.reasoning_details).toBeUndefined();
		}
		const off = await sent(convo(turn({ type: "thinking", thinking: "plain text", signature: sign({ reasoning_content: "x" }) })), {});
		expect(off.reasoning).toBe("plain text");
		expect(off.reasoning_content).toBeUndefined();
	});

	test("a plain thinking block next to a restored one is appended, not dropped", async () => {
		const assistant = turn({ type: "thinking", thinking: "", signature: sign({ reasoning: "kept" }) }, [
			{ type: "thinking", thinking: "extra", signature: "x" }
		]);
		const message = await sent(convo(assistant));
		expect(message.reasoning).toBe("kept\n\nextra");
		expect(message.reasoning_content).toBeUndefined();
	});

	test("clear_thinking removes restored data from older turns, and merged turns keep theirs", async () => {
		const signature = sign({ reasoning_content: "old" });
		const body = {
			model: "m",
			max_tokens: 8,
			context_management: { edits: [{ type: "clear_thinking_20251015", keep: { type: "thinking_turns", value: 1 } }] },
			messages: [
				{ role: "user", content: "a" },
				turn({ type: "thinking", thinking: "", signature }),
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }] },
				turn({ type: "thinking", thinking: "", signature: sign({ reasoning_content: "new" }) }),
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }] }
			]
		};
		const assistants = (await toOpenaiRequest(body, on)).body.messages.filter((m) => m.role === "assistant");
		expect(assistants[0].reasoning_content).toBeUndefined();
		expect(assistants[1].reasoning_content).toBe("new");
		const merged = await toOpenaiRequest(
			{
				model: "m",
				max_tokens: 8,
				messages: [
					{ role: "user", content: "a" },
					{ role: "assistant", content: [{ type: "thinking", thinking: "", signature }] },
					{ role: "assistant", content: [{ type: "text", text: "t" }] }
				]
			},
			on
		);
		expect(merged.body.messages.find((m) => m.role === "assistant").reasoning_content).toBe("old");
	});

	test("a tool turn left without reasoning is counted, and only when switched on", async () => {
		const bare = convo({ role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "Read", input: {} }] });
		expect((await toOpenaiRequest(bare, on)).state.reasoningMissing).toBe(1);
		expect((await toOpenaiRequest(bare, {})).state.reasoningMissing).toBeUndefined();
		const withText = convo(turn({ type: "thinking", thinking: "plain", signature: "EqQB" }));
		expect((await toOpenaiRequest(withText, on)).state.reasoningMissing).toBeUndefined();
		const noTools = {
			model: "m",
			max_tokens: 8,
			messages: [
				{ role: "user", content: "a" },
				{ role: "assistant", content: "hello" },
				{ role: "user", content: "b" }
			]
		};
		expect((await toOpenaiRequest(noTools, on)).state.reasoningMissing).toBeUndefined();
	});
});

describe("Anthropic upstream with an OpenAI client: thinking blocks travel as reasoning_details", () => {
	const message = {
		id: "msg_1",
		type: "message",
		role: "assistant",
		model: "claude",
		content: [
			{ type: "thinking", thinking: "plan", signature: "EqQBsig" },
			{ type: "redacted_thinking", data: "ENC" },
			{ type: "thinking", thinking: "no signature" },
			{ type: "tool_use", id: "toolu_1", name: "Read", input: { a: 1 } }
		],
		stop_reason: "tool_use",
		usage: { input_tokens: 1, output_tokens: 1 }
	};

	test("the reply carries replayable items only when switched on", () => {
		const out = toOpenaiResponse(message, undefined, on);
		expect(out.choices[0].message.reasoning_details).toEqual([
			{ type: "reasoning.text", text: "plan", signature: "EqQBsig", format: ANTHROPIC_FORMAT, index: 0 },
			{ type: "reasoning.encrypted", data: "ENC", format: ANTHROPIC_FORMAT, index: 0 }
		]);
		expect(out.choices[0].message.reasoning).toBe("plan" + "no signature");
		expect(toOpenaiResponse(message).choices[0].message.reasoning_details).toBeUndefined();
	});

	test("a stream emits one item per finished reasoning block", async () => {
		const events = [
			{
				type: "message_start",
				message: {
					id: "msg_1",
					type: "message",
					role: "assistant",
					model: "claude",
					content: [],
					usage: { input_tokens: 1, output_tokens: 0 }
				}
			},
			{ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
			{ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "pl" } },
			{ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "an" } },
			{ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "EqQB" } },
			{ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } },
			{ type: "content_block_stop", index: 0 },
			{ type: "content_block_start", index: 1, content_block: { type: "redacted_thinking", data: "ENC" } },
			{ type: "content_block_stop", index: 1 },
			{ type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
			{ type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "ok" } },
			{ type: "content_block_stop", index: 2 },
			{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } },
			{ type: "message_stop" }
		];
		const run = async (settings) =>
			await collect(
				toOpenaiStream(
					events.map((data) => ({ event: data.type, data })),
					undefined,
					settings
				)
			);
		const items = (chunks) => chunks.flatMap((c) => c.data?.choices?.[0]?.delta?.reasoning_details ?? []);
		expect(items(await run(on))).toEqual([
			{ type: "reasoning.text", text: "plan", signature: "EqQBsig", format: ANTHROPIC_FORMAT, index: 0 },
			{ type: "reasoning.encrypted", data: "ENC", format: ANTHROPIC_FORMAT, index: 0 }
		]);
		expect(items(await run({}))).toEqual([]);
		const noSignature = events.filter((e) => e.type !== "content_block_delta" || e.delta.type !== "signature_delta");
		const bare = await collect(
			toOpenaiStream(
				noSignature.map((data) => ({ event: data.type, data })),
				undefined,
				on
			)
		);
		expect(items(bare)).toEqual([{ type: "reasoning.encrypted", data: "ENC", format: ANTHROPIC_FORMAT, index: 0 }]);
	});

	test("reasoning deltas that arrive without a block start are tolerated", async () => {
		const loose = [
			{
				type: "message_start",
				message: {
					id: "msg_1",
					type: "message",
					role: "assistant",
					model: "claude",
					content: [],
					usage: { input_tokens: 1, output_tokens: 0 }
				}
			},
			{ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "x" } },
			{ type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "s" } },
			{ type: "content_block_stop", index: 0 },
			{ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } },
			{ type: "message_stop" }
		];
		const out = await collect(
			toOpenaiStream(
				loose.map((data) => ({ event: data.type, data })),
				undefined,
				on
			)
		);
		expect(out.flatMap((c) => c.data?.choices?.[0]?.delta?.reasoning_details ?? [])).toEqual([]);
	});

	test("thinking disabled sends no template switch to a server without one", async () => {
		const out = await toOpenaiRequest(
			{ model: "m", max_tokens: 8, thinking: { type: "disabled" }, messages: [{ role: "user", content: "a" }] },
			{ thinking: "none" }
		);
		expect(out.body.chat_template_kwargs).toBeUndefined();
		expect(out.body.reasoning_effort).toBeUndefined();
	});

	test("replayed items become thinking blocks ahead of the text and tool calls; anything else is ignored", async () => {
		const items = [
			{ type: "reasoning.text", text: "plan", signature: "EqQBsig", format: ANTHROPIC_FORMAT, index: 0 },
			{ type: "reasoning.encrypted", data: "ENC", format: ANTHROPIC_FORMAT, index: 0 },
			{ type: "reasoning.text", text: "foreign", signature: "x", format: "openai-responses-v1" },
			{ role: "system" }
		];
		const body = (reasoning_details) => ({
			model: "claude",
			max_tokens: 8,
			messages: [
				{ role: "user", content: "go" },
				{ role: "assistant", content: "Reading.", reasoning_details, tool_calls: [call] },
				{ role: "tool", tool_call_id: "call_1", content: "ok" }
			]
		});
		const assistant = async (reasoning_details, settings = on) =>
			(await toAnthropicRequest(body(reasoning_details), settings)).body.messages.find((m) => m.role === "assistant");
		expect((await assistant(items)).content.map((block) => block.type)).toEqual(["thinking", "redacted_thinking", "text", "tool_use"]);
		expect((await assistant(items)).content[0]).toEqual({ type: "thinking", thinking: "plan", signature: "EqQBsig" });
		expect((await assistant(items)).content[1]).toEqual({ type: "redacted_thinking", data: "ENC" });
		// Off: the items are ignored and the reasoning is a recorded drop, as before.
		const off = await toAnthropicRequest(
			{
				...body(items),
				messages: [
					{ role: "user", content: "go" },
					{ role: "assistant", content: "x", reasoning_content: "r" }
				]
			},
			{}
		);
		expect(off.state.dropped).toContain("reasoning");
		expect((await assistant(items, {})).content.map((block) => block.type)).toEqual(["text", "tool_use"]);
		// Plain reasoning text without usable items has no signature and is still dropped.
		const plain = await toAnthropicRequest(
			{
				...body([{ role: "system" }]),
				messages: [
					{ role: "user", content: "go" },
					{ role: "assistant", content: "x", reasoning_content: "r", reasoning_details: [{ role: "system" }] }
				]
			},
			on
		);
		expect(plain.state.dropped).toContain("reasoning");
		const kept = await toAnthropicRequest(
			{
				...body(items),
				messages: [
					{ role: "user", content: "go" },
					{ role: "assistant", content: "x", reasoning_content: "r", reasoning_details: items }
				]
			},
			on
		);
		expect(kept.state.dropped).not.toContain("reasoning");
	});
});

describe("reasoning side channel: review fixes", () => {
	const base = { id: "c", object: "chat.completion.chunk", model: "m" };
	const frame = (delta, finish = null) => ({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] });
	const run = async (deltas, settings = on, state) =>
		await collect(toAnthropicStream(openaiSse([...deltas.map((delta) => frame(delta)), frame({}, "stop"), "[DONE]"]), state, settings));
	const signatures = async (events) =>
		await Promise.all(
			events.filter((e) => e.data?.delta?.type === "signature_delta").map((e) => unsign(e.data.delta.signature, { producer: "p:q" }))
		);

	test("streamed fragments of one item are merged, so a stream signs the same items a JSON reply does", async () => {
		const merged = [
			{ type: "reasoning.text", index: 0, text: "step one", signature: "SIG", format: "f", id: "t1" },
			{ type: "reasoning.summary", index: 1, summary: "brief" },
			{ type: "reasoning.encrypted", index: 2, data: "AAAA", id: "e1" }
		];
		const fragments = [
			{ reasoning_details: [{ type: "reasoning.text", index: 0, text: "step ", id: "t1", format: "f" }] },
			{
				reasoning_details: [
					{ type: "reasoning.text", index: 0, text: "one" },
					{ type: "reasoning.summary", index: 1, summary: "bri" }
				]
			},
			{
				reasoning_details: [
					{ type: "reasoning.text", index: 0, signature: "SIG" },
					{ type: "reasoning.summary", index: 1, summary: "ef" }
				]
			},
			{
				reasoning_details: [
					{ type: "reasoning.encrypted", index: 2, id: "e1" },
					{ type: "reasoning.encrypted", index: 2, data: "AAAA" }
				]
			},
			{ content: "ok" }
		];
		const state = { producer: "p:q" };
		expect(await signatures(await run(fragments, on, state))).toEqual([{ reasoning_details: merged }]);
		const json = toAnthropicResponse(completion({ role: "assistant", content: "ok", reasoning_details: merged }), state, on);
		expect(await unsign(json.content[0].signature, { producer: "p:q" })).toEqual({ reasoning_details: merged });
	});

	test("a thought that arrives only as structured details streams its readable text, once", async () => {
		const events = await run([
			{ reasoning_details: [{ type: "reasoning.summary", index: 0, summary: "short " }] },
			{ reasoning_details: [{ type: "reasoning.summary", index: 0, summary: "summary" }] },
			{ content: "ok" }
		]);
		const thinking = events
			.filter((e) => e.data?.delta?.type === "thinking_delta")
			.map((e) => e.data.delta.thinking)
			.join("");
		expect(thinking).toBe("short summary");
		const json = toAnthropicResponse(
			completion({ role: "assistant", content: "ok", reasoning_details: [{ type: "reasoning.summary", summary: "short summary" }] }),
			undefined,
			on
		);
		expect(json.content[0].thinking).toBe("short summary");
		// With text in the reasoning field as well, the details do not repeat it.
		const both = await run([
			{ reasoning_content: "plan", reasoning_details: [{ type: "reasoning.text", index: 0, text: "plan" }] },
			{ content: "ok" }
		]);
		expect(
			both
				.filter((e) => e.data?.delta?.type === "thinking_delta")
				.map((e) => e.data.delta.thinking)
				.join("")
		).toBe("plan");
	});

	test("replies are signed for their producer and restored only for it", async () => {
		const state = { producer: "deepseek:openai.chat" };
		const out = toAnthropicResponse(completion({ role: "assistant", content: "x", reasoning_content: "r" }), state, on);
		const assistant = {
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "plain text", signature: out.content[0].signature },
				{ type: "tool_use", id: "t", name: "Read", input: {} }
			]
		};
		const body = {
			model: "m",
			max_tokens: 8,
			messages: [
				{ role: "user", content: "go" },
				assistant,
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }] }
			]
		};
		const find = (converted) => converted.body.messages.find((m) => m.role === "assistant");
		expect(find(await toOpenaiRequest(body, on, { producer: "deepseek:openai.chat" })).reasoning_content).toBe("r");
		for (const context of [{ producer: "compatible:openai.chat" }, {}, undefined]) {
			const message = find(await toOpenaiRequest(body, on, context));
			expect(message.reasoning_content).toBeUndefined();
			expect(message.reasoning).toBe("plain text");
		}
		expect((await toOpenaiRequest(body, on, { producer: "x:y" })).state.producer).toBe("x:y");
		expect((await toOpenaiRequest(body, on)).state.producer).toBeUndefined();
	});

	test("a request cannot make the converter decode more than its budget", async () => {
		const bomb = `llmt:~${deflateRawSync(Buffer.from(JSON.stringify({ v: 1, d: { reasoning_content: "a".repeat(300000) } }))).toString("base64url")}`;
		const blocks = Array.from({ length: 50 }, () => ({ type: "thinking", thinking: "fallback", signature: bomb }));
		const body = {
			model: "m",
			max_tokens: 8,
			messages: [
				{ role: "user", content: "go" },
				{ role: "assistant", content: blocks }
			]
		};
		const message = (await toOpenaiRequest(body, on)).body.messages.find((m) => m.role === "assistant");
		expect(message.reasoning_content).toBeUndefined();
		expect(message.reasoning.split("\n\n")).toHaveLength(50);
	});

	test("replayed thinking keeps its place between text and tool use", async () => {
		const items = [
			{ type: "reasoning.text", text: "first", signature: "s1", format: ANTHROPIC_FORMAT, index: 0 },
			{ type: "reasoning.text", text: "second", signature: "s2", format: ANTHROPIC_FORMAT, index: 1 },
			{ type: "reasoning.encrypted", data: "ENC", format: ANTHROPIC_FORMAT, index: 9 }
		];
		const body = {
			model: "claude",
			max_tokens: 8,
			messages: [
				{ role: "user", content: "go" },
				{ role: "assistant", content: "Reading.", reasoning_details: items, tool_calls: [call] },
				{ role: "tool", tool_call_id: "call_1", content: "ok" }
			]
		};
		const content = (await toAnthropicRequest(body, on)).body.messages.find((m) => m.role === "assistant").content;
		expect(content.map((block) => block.thinking ?? block.data ?? block.text ?? block.type)).toEqual([
			"first",
			"Reading.",
			"second",
			"tool_use",
			"ENC"
		]);
		const unplaced = { type: "reasoning.text", text: "unplaced", signature: "s3", format: ANTHROPIC_FORMAT };
		const loose = { ...body, messages: [body.messages[0], { ...body.messages[1], reasoning_details: [unplaced] }, body.messages[2]] };
		const front = (await toAnthropicRequest(loose, on)).body.messages.find((m) => m.role === "assistant").content;
		expect(front[0].thinking).toBe("unplaced");
		const reply = toOpenaiResponse(
			{
				id: "m",
				type: "message",
				role: "assistant",
				model: "claude",
				content: [
					{ type: "text", text: "a" },
					{ type: "thinking", thinking: "t", signature: "S" },
					{ type: "tool_use", id: "x", name: "Read", input: {} }
				],
				stop_reason: "tool_use",
				usage: {}
			},
			undefined,
			on
		);
		expect(reply.choices[0].message.reasoning_details[0].index).toBe(1);
	});
});

describe("reasoning side channel: second review", () => {
	const turnWith = (signature, id) => ({
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "plain", signature },
			{ type: "tool_use", id, name: "Read", input: {} }
		]
	});
	const result = (id) => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok" }] });

	test("signatures are decoded newest turn first, so a small budget goes to the latest turns", async () => {
		const old = sign({ reasoning_content: "old" });
		const recent = sign({ reasoning_content: "recent" });
		const body = {
			model: "m",
			max_tokens: 8,
			messages: [{ role: "user", content: "go" }, turnWith(old, "a"), result("a"), turnWith(recent, "b"), result("b")]
		};
		const budget = { ...createBudget(), signatures: 1 };
		const assistants = (await toOpenaiRequest(body, on, { budget })).body.messages.filter((m) => m.role === "assistant");
		expect(assistants[0].reasoning).toBe("plain");
		expect(assistants[0].reasoning_content).toBeUndefined();
		expect(assistants[1].reasoning_content).toBe("recent");
	});

	test("positions are relative to what the OpenAI client sees, so interleaved thinking replays in place", async () => {
		const message = {
			id: "msg_1",
			type: "message",
			role: "assistant",
			model: "claude",
			content: [
				{ type: "thinking", thinking: "one", signature: "S1" },
				{ type: "text", text: "a" },
				{ type: "text", text: "b" },
				{ type: "thinking", thinking: "two", signature: "S2" },
				{ type: "tool_use", id: "toolu_1", name: "Read", input: {} },
				{ type: "thinking", thinking: "three", signature: "S3" },
				{ type: "tool_use", id: "toolu_2", name: "Read", input: {} }
			],
			stop_reason: "tool_use",
			usage: {}
		};
		const reply = toOpenaiResponse(message, undefined, on);
		expect(reply.choices[0].message.reasoning_details.map((item) => item.index)).toEqual([0, 1, 2]);
		const sent = reply.choices[0].message;
		const body = {
			model: "claude",
			max_tokens: 8,
			messages: [
				{ role: "user", content: "go" },
				{ role: "assistant", content: sent.content, reasoning_details: sent.reasoning_details, tool_calls: sent.tool_calls },
				{ role: "tool", tool_call_id: "toolu_1", content: "ok" },
				{ role: "tool", tool_call_id: "toolu_2", content: "ok" }
			]
		};
		const content = (await toAnthropicRequest(body, on)).body.messages.find((m) => m.role === "assistant").content;
		expect(content.map((block) => block.thinking ?? block.type)).toEqual(["one", "text", "two", "tool_use", "three", "tool_use"]);
	});

	test("the same positions come out of a stream; an empty text block and a message with no text count tool calls only", async () => {
		const events = [
			{
				type: "message_start",
				message: {
					id: "msg_1",
					type: "message",
					role: "assistant",
					model: "claude",
					content: [],
					usage: { input_tokens: 1, output_tokens: 0 }
				}
			},
			{ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "Read", input: {} } },
			{ type: "content_block_stop", index: 0 },
			{ type: "content_block_start", index: 1, content_block: { type: "thinking", thinking: "", signature: "" } },
			{ type: "content_block_delta", index: 1, delta: { type: "signature_delta", signature: "S" } },
			{ type: "content_block_stop", index: 1 },
			{ type: "content_block_start", index: 2, content_block: { type: "text", text: "" } },
			{ type: "content_block_stop", index: 2 },
			{ type: "content_block_start", index: 3, content_block: { type: "thinking", thinking: "", signature: "" } },
			{ type: "content_block_delta", index: 3, delta: { type: "signature_delta", signature: "T" } },
			{ type: "content_block_stop", index: 3 },
			{ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } },
			{ type: "message_stop" }
		];
		const chunks = await collect(
			toOpenaiStream(
				events.map((data) => ({ event: data.type, data })),
				undefined,
				on
			)
		);
		expect(chunks.flatMap((c) => c.data?.choices?.[0]?.delta?.reasoning_details ?? []).map((item) => item.index)).toEqual([1, 1]);
	});

	test("one budget serves every attempt of a send, and its results are cached", async () => {
		const api = await make({
			upstreams: [{ url: "http://a.test", backend: "compatible", settings: { reasoningRoundTrip: true } }],
			detect: false
		});
		const signature = sign({ reasoning_content: "kept" }, "compatible:openai.chat:a.test");
		const body = { model: "m", max_tokens: 8, messages: [{ role: "user", content: "go" }, turnWith(signature, "a"), result("a")] };
		const budget = createBudget();
		const first = await api.request(body, { budget });
		const second = await api.request(body, { budget });
		expect(first.body.messages.find((m) => m.role === "assistant").reasoning_content).toBe("kept");
		expect(second.body.messages.find((m) => m.role === "assistant").reasoning_content).toBe("kept");
		expect(budget.signatures).toBe(1023);
	});

	test("the producer includes the host, so two generic upstreams do not share data", async () => {
		const mine = await make({
			upstreams: [{ url: "http://b.test", backend: "compatible", settings: { reasoningRoundTrip: true } }],
			detect: false
		});
		const body = (signature) => ({
			model: "m",
			max_tokens: 8,
			messages: [{ role: "user", content: "go" }, turnWith(signature, "a"), result("a")]
		});
		const turn = async (signature) => (await mine.request(body(signature))).body.messages.find((m) => m.role === "assistant");
		expect((await turn(sign({ reasoning_content: "x" }, "compatible:openai.chat:a.test"))).reasoning_content).toBeUndefined();
		expect((await turn(sign({ reasoning_content: "x" }, "compatible:openai.chat:b.test"))).reasoning_content).toBe("x");
		expect((await turn(sign({ reasoning_content: "x" }))).reasoning_content).toBeUndefined();
		const odd = await make({
			upstreams: [{ url: "not a url", backend: "compatible", settings: { reasoningRoundTrip: true } }],
			detect: false
		});
		expect(
			(await odd.request(body(sign({ reasoning_content: "x" }, "compatible:openai.chat:not a url")))).body.messages.find(
				(m) => m.role === "assistant"
			).reasoning_content
		).toBe("x");
	});

	test("an empty text block is not text: thinking after it replays before the tool call", async () => {
		const content = [
			{ type: "text", text: "" },
			{ type: "thinking", thinking: "t", signature: "S" },
			{ type: "tool_use", id: "toolu_1", name: "Read", input: {} }
		];
		const message = { id: "m", type: "message", role: "assistant", model: "claude", content, stop_reason: "tool_use", usage: {} };
		const replay = async (details, calls) => {
			const body = {
				model: "claude",
				max_tokens: 8,
				messages: [
					{ role: "user", content: "go" },
					{ role: "assistant", content: "", reasoning_details: details, tool_calls: calls },
					{ role: "tool", tool_call_id: "toolu_1", content: "ok" }
				]
			};
			return (await toAnthropicRequest(body, on)).body.messages.find((m) => m.role === "assistant").content.map((block) => block.type);
		};
		const json = toOpenaiResponse(message, undefined, on).choices[0].message;
		expect(json.reasoning_details.map((item) => item.index)).toEqual([0]);
		expect(await replay(json.reasoning_details, json.tool_calls)).toEqual(["thinking", "tool_use"]);
		const events = [
			{
				type: "message_start",
				message: { id: "m", type: "message", role: "assistant", model: "claude", content: [], usage: { input_tokens: 1, output_tokens: 0 } }
			},
			{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
			{ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "" } },
			{ type: "content_block_stop", index: 0 },
			{ type: "content_block_start", index: 1, content_block: { type: "thinking", thinking: "", signature: "" } },
			{ type: "content_block_delta", index: 1, delta: { type: "signature_delta", signature: "S" } },
			{ type: "content_block_stop", index: 1 },
			{ type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "toolu_1", name: "Read", input: {} } },
			{ type: "content_block_stop", index: 2 },
			{ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 1 } },
			{ type: "message_stop" }
		];
		const chunks = await collect(
			toOpenaiStream(
				events.map((data) => ({ event: data.type, data })),
				undefined,
				on
			)
		);
		const streamed = chunks.flatMap((c) => c.data?.choices?.[0]?.delta?.reasoning_details ?? []);
		expect(streamed.map((item) => item.index)).toEqual([0]);
		expect(await replay(streamed, json.tool_calls)).toEqual(["thinking", "tool_use"]);
		// Real text before the thinking still counts.
		const withText = events.map((data) => (data.delta?.type === "text_delta" ? { ...data, delta: { ...data.delta, text: "hi" } } : data));
		const counted = await collect(
			toOpenaiStream(
				withText.map((data) => ({ event: data.type, data })),
				undefined,
				on
			)
		);
		expect(counted.flatMap((c) => c.data?.choices?.[0]?.delta?.reasoning_details ?? []).map((item) => item.index)).toEqual([1]);
	});

	test("a position 0 or 1 item never lands after a tool call on replay", async () => {
		const item = { type: "reasoning.text", text: "t", signature: "S", format: ANTHROPIC_FORMAT, index: 1 };
		const body = {
			model: "claude",
			max_tokens: 8,
			messages: [
				{ role: "user", content: "go" },
				{ role: "assistant", content: "", reasoning_details: [item], tool_calls: [call] },
				{ role: "tool", tool_call_id: "call_1", content: "ok" }
			]
		};
		const types = (await toAnthropicRequest(body, on)).body.messages.find((m) => m.role === "assistant").content.map((block) => block.type);
		expect(types).toEqual(["thinking", "tool_use"]);
		const late = { ...item, index: 5 };
		const after = (
			await toAnthropicRequest(
				{ ...body, messages: [body.messages[0], { ...body.messages[1], reasoning_details: [late] }, body.messages[2]] },
				on
			)
		).body.messages
			.find((m) => m.role === "assistant")
			.content.map((block) => block.type);
		expect(after).toEqual(["tool_use", "thinking"]);
	});
});

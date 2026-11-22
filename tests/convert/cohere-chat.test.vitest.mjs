/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/convert/cohere-chat.test.vitest.mjs
 *	@Date: 2026-11-21T10:00:00-08:00 (1795284000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-21T10:00:00-08:00 (1795284000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Cohere v2 chat converters called directly: the two request converters, the two reply converters (with and without conversion state) and the two stream converters (from events and from SSE text, with and without state, failures and cut streams).
 */
import { describe, expect, it } from "vitest";
import { request as fromAnthropic } from "../../src/api/convert/anthropic/messages/to/cohere/chat/request.mjs";
import { request as fromChat } from "../../src/api/convert/openai/chat/to/cohere/chat/request.mjs";
import { response as toChat } from "../../src/api/convert/cohere/chat/to/openai/chat/response.mjs";
import { response as toAnthropic } from "../../src/api/convert/cohere/chat/to/anthropic/messages/response.mjs";
import { stream as chatStream } from "../../src/api/convert/cohere/chat/to/openai/chat/stream.mjs";
import { stream as anthropicStream } from "../../src/api/convert/cohere/chat/to/anthropic/messages/stream.mjs";
import { collect } from "../helpers/streams.mjs";

const messages = [{ role: "user", content: "hi" }];
const text = [
	{ type: "message-start", delta: { message: { role: "assistant" } } },
	{ type: "content-delta", index: 0, delta: { message: { content: { text: "hi" } } } },
	{ type: "message-end", delta: { finish_reason: "COMPLETE", usage: { tokens: { input_tokens: 1, output_tokens: 2 } } } }
].map((data) => ({ event: data.type, data }));
const sse = (list) => list.map((entry) => `event: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\n\n`).join("");

describe("request converters", () => {
	it("Chat Completions: needs messages, and keeps what the reply converters read in the state", () => {
		expect(() => fromChat({ model: "m" })).toThrow(/messages: Field required/);
		expect(() => fromChat(null)).toThrow(/messages: Field required/);
		const plain = fromChat({ model: "m", messages }, {});
		expect(plain.state).toMatchObject({ front: "openai", model: "m", stream: false, includeUsage: false });
		const streaming = fromChat(
			{ model: "m", stream: true, stream_options: { include_usage: true }, messages },
			{ sampling: { safety_mode: "OFF" } }
		);
		expect(streaming.state).toMatchObject({ stream: true, includeUsage: true });
		expect(streaming.body).toMatchObject({ stream: true, safety_mode: "OFF" });
		expect(fromChat({ model: "m", messages }).body.stream).toBe(false);
	});

	it("Anthropic: the sampling setting and metadata.sampling merge, thinking is carried, and a bad body is refused", async () => {
		const merged = await fromAnthropic(
			{ model: "m", max_tokens: 5, thinking: { type: "enabled", budget_tokens: 2000 }, metadata: { sampling: { b: 2 } }, messages },
			{ sampling: { a: 1, b: 1 } }
		);
		expect(merged.body).toMatchObject({ a: 1, b: 2, thinking: { type: "enabled", token_budget: 2000 }, max_tokens: 5 });
		const quiet = await fromAnthropic({ model: "m", max_tokens: 5, messages });
		expect(quiet.body).not.toHaveProperty("thinking");
		await expect(fromAnthropic({ model: "m", max_tokens: 5 })).rejects.toThrow(/messages: Field required/);
	});

	it("Anthropic: names the values moved into Cohere's ranges, and leaves the tool error marker alone with toolErrors off", async () => {
		const failed = [
			{ role: "user", content: "go" },
			{ role: "assistant", content: [{ type: "tool_use", id: "t", name: "R", input: {} }] },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", is_error: true, content: "bad" }] }
		];
		const body = { model: "m", max_tokens: 5, top_p: 1, tools: [{ name: "R", input_schema: { type: "object" } }], messages: failed };
		const on = await fromAnthropic(body);
		expect(on.state.clamped).toEqual(["p"]);
		expect(on.body.messages.at(-1).content).toBe('{"error":"bad"}');
		const off = await fromAnthropic({ ...body, top_p: 0.5 }, { toolErrors: false });
		expect(off.state).not.toHaveProperty("clamped");
		expect(off.body.messages.at(-1).content).toBe("bad");
	});

	it("Chat Completions: names the values moved into Cohere's ranges, and reads the tool error marker only with toolErrorInference", () => {
		const turn = [
			{ role: "user", content: "go" },
			{ role: "tool", tool_call_id: "t", content: "[error] bad" }
		];
		const on = fromChat({ model: "m", frequency_penalty: 3, messages: turn }, { toolErrorInference: true });
		expect(on.state.clamped).toEqual(["frequency_penalty"]);
		expect(on.body.messages.at(-1).content).toBe('{"error":"bad"}');
		const off = fromChat({ model: "m", messages: turn });
		expect(off.state).not.toHaveProperty("clamped");
		expect(off.body.messages.at(-1).content).toBe("[error] bad");
	});
});

describe("response converters", () => {
	const reply = {
		finish_reason: "COMPLETE",
		message: { content: [{ type: "text", text: "ok" }] },
		usage: { tokens: { input_tokens: 3, output_tokens: 4 } }
	};

	it("Chat Completions: the client's model, the usage kept on the state, and no state at all", () => {
		const state = { model: "asked" };
		expect(toChat(reply, state, {}).model).toBe("asked");
		expect(state.upstreamUsage).toEqual({ input_tokens: 3, output_tokens: 4, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
		expect(toChat(reply).choices[0].message.content).toBe("ok");
	});

	it("Anthropic: builds the message", () => {
		const out = toAnthropic(reply, { model: "asked" }, {});
		expect(out).toMatchObject({ type: "message", model: "asked", stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] });
		expect(() => toAnthropic({}, {}, {})).toThrow(/no message/);
	});
});

describe("stream converters", () => {
	it("Chat Completions chunks from messages, from SSE text, and without a state", async () => {
		const state = { model: "asked", includeUsage: true };
		const out = (await collect(chatStream(text, state, {}))).map((entry) => entry.data);
		expect(out.at(-1)).toBe("[DONE]");
		expect(out.find((chunk) => chunk.usage)).toMatchObject({ model: "asked", usage: { prompt_tokens: 1, completion_tokens: 2 } });
		expect(state.upstreamUsage).toEqual({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
		expect((await collect(chatStream(sse(text)))).map((entry) => entry.data).at(-1)).toBe("[DONE]");
		const quiet = (await collect(chatStream(text, { includeUsage: false }))).map((entry) => entry.data);
		expect(quiet.some((chunk) => chunk.usage)).toBe(false);
		const early = { model: "asked" };
		await collect(chatStream(text.slice(0, 2), early, {}));
		expect(early).not.toHaveProperty("upstreamUsage");
	});

	it("Chat Completions: a failed generation, a failing source and a stream cut short each give an error chunk and [DONE]", async () => {
		const failed = (
			await collect(chatStream([{ event: "message-end", data: { type: "message-end", delta: { finish_reason: "ERROR" } } }], {}))
		).map((entry) => entry.data);
		expect(failed.at(-2)).toEqual({ error: { message: "Upstream generation failed", type: "api_error", param: null, code: null } });
		expect(failed.at(-1)).toBe("[DONE]");
		const broken = (async function* () {
			yield text[0];
			throw Object.assign(new Error("reset"), { type: "overloaded_error" });
		})();
		const thrown = (await collect(chatStream(broken, {}))).map((entry) => entry.data);
		expect(thrown.at(-2)).toEqual({ error: { message: "reset", type: "overloaded_error", param: null, code: null } });
		const plain = { [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error("plain")) }) };
		expect((await collect(chatStream(plain, {}))).map((entry) => entry.data)[0].error.type).toBe("api_error");
		const cut = (await collect(chatStream(text.slice(0, 2), {}))).map((entry) => entry.data);
		expect(cut.at(-2).error.message).toBe("Upstream stream ended before completion");
		expect(cut.at(-1)).toBe("[DONE]");
	});

	it("Anthropic events from messages and from SSE text, and an error event when the stream is cut", async () => {
		const events = await collect(anthropicStream(text, { model: "asked" }, {}));
		expect(events.map((entry) => entry.event)).toEqual([
			"message_start",
			"content_block_start",
			"content_block_delta",
			"content_block_stop",
			"message_delta",
			"message_stop"
		]);
		expect((await collect(anthropicStream(sse(text), { model: "asked" }))).at(-1).event).toBe("message_stop");
		const cut = await collect(anthropicStream(text.slice(0, 2), { model: "asked" }, {}));
		expect(cut.at(-1)).toMatchObject({ event: "error" });
	});
});

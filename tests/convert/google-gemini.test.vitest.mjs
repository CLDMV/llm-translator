/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/convert/google-gemini.test.vitest.mjs
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
 * @fileoverview Converters between the two fronts and Google Gemini's generateContent API: the requests of both fronts, the replies and the streamed chunks, with and without a state.
 */
import { describe, expect, it } from "vitest";
import { request as fromAnthropic } from "../../src/api/convert/anthropic/messages/to/google/gemini/request.mjs";
import { request as fromChat } from "../../src/api/convert/openai/chat/to/google/gemini/request.mjs";
import { response as toChat } from "../../src/api/convert/google/gemini/to/openai/chat/response.mjs";
import { response as toAnthropic } from "../../src/api/convert/google/gemini/to/anthropic/messages/response.mjs";
import { stream as chatStream } from "../../src/api/convert/google/gemini/to/openai/chat/stream.mjs";
import { stream as anthropicStream } from "../../src/api/convert/google/gemini/to/anthropic/messages/stream.mjs";
import { collect } from "../helpers/streams.mjs";

const result = [{ role: "tool", tool_call_id: "t", content: "[error] bad" }];
const chatTools = [{ type: "function", function: { name: "R" } }];
const tools = [{ name: "R", input_schema: { type: "object" } }];
const messages = [{ role: "user", content: "hi" }];
const text = [
	{ candidates: [{ content: { parts: [{ text: "hi" }] } }] },
	{
		candidates: [{ content: { parts: [{ text: "!" }] }, finishReason: "STOP" }],
		usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2 }
	}
];
const sse = (list) => list.map((entry) => `data: ${JSON.stringify(entry)}\n\n`).join("");

describe("request converters", () => {
	it("Chat Completions: needs messages, keeps the error marker unless toolErrors is off", () => {
		expect(() => fromChat({ model: "m" })).toThrow(/messages: Field required/);
		expect(() => fromChat(null)).toThrow(/messages: Field required/);
		const on = fromChat({ model: "m", tools: chatTools, messages: result }, {});
		expect(on.body.contents[0].parts[0].functionResponse.response).toEqual({ error: "bad" });
		expect(on.state).toMatchObject({ front: "openai", model: "m", stream: false, includeUsage: false });
		const off = fromChat(
			{ model: "m", tools: chatTools, stream: true, stream_options: { include_usage: true }, messages: result },
			{ toolErrors: false, sampling: { topK: 3 } }
		);
		expect(off.body.contents[0].parts[0].functionResponse.response).toEqual({ output: "[error] bad" });
		expect(off.body.generationConfig).toEqual({ topK: 3 });
		expect(off.state).toMatchObject({ stream: true, includeUsage: true });
	});

	it("Anthropic: toolErrors off leaves the marker alone, and the sampling setting and metadata.sampling merge", async () => {
		const body = {
			model: "m",
			max_tokens: 5,
			tools,
			messages: [
				...messages,
				{ role: "assistant", content: [{ type: "tool_use", id: "t", name: "R", input: {} }] },
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "bad", is_error: true }] }
			]
		};
		const on = await fromAnthropic(body);
		expect(on.body.contents.at(-1).parts[0].functionResponse.response).toEqual({ error: "bad" });
		const off = await fromAnthropic(body, { toolErrors: false });
		expect(off.body.contents.at(-1).parts[0].functionResponse.response).toEqual({ output: "bad" });
		const noTools = await fromAnthropic({ ...body, tools: undefined });
		expect(JSON.stringify(noTools.body)).not.toMatch(/functionResponse|functionCall|toolConfig/);
		expect(JSON.stringify(noTools.body.contents)).toContain("[Tool R failed: bad]");
		const merged = await fromAnthropic(
			{ model: "m", max_tokens: 5, metadata: { sampling: { b: 2 } }, messages },
			{ sampling: { a: 1, b: 1 } }
		);
		expect(merged.body.generationConfig).toMatchObject({ a: 1, b: 2 });
		for (const asked of [[1], "x", null]) {
			const plain = await fromAnthropic({ model: "m", max_tokens: 5, metadata: { sampling: asked }, messages }, { sampling: { a: 1 } });
			expect(plain.body.generationConfig).toMatchObject({ a: 1 });
		}
	});
});

describe("response converters", () => {
	const reply = {
		candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
		usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 }
	};

	it("Chat Completions: the client's model, the usage kept on the state, and no state at all", () => {
		const state = { model: "asked" };
		expect(toChat(reply, state, {}).model).toBe("asked");
		expect(state.upstreamUsage).toMatchObject({ input_tokens: 3, output_tokens: 4 });
		expect(toChat(reply).choices[0].message.content).toBe("ok");
	});

	it("Anthropic: builds the message", () => {
		const out = toAnthropic(reply, { model: "asked" }, {});
		expect(out).toMatchObject({ type: "message", model: "asked", stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] });
		expect(() => toAnthropic({}, {}, {})).toThrow(/no message/);
	});
});

describe("stream converters", () => {
	it("Chat Completions chunks from objects, from SSE text, and without a state", async () => {
		const state = { model: "asked", includeUsage: true };
		const out = (await collect(chatStream(text, state, {}))).map((entry) => entry.data);
		expect(out.at(-1)).toBe("[DONE]");
		expect(out.find((chunk) => chunk.usage)).toMatchObject({ model: "asked", usage: { prompt_tokens: 1, completion_tokens: 2 } });
		expect(state.upstreamUsage).toMatchObject({ input_tokens: 1, output_tokens: 2 });
		expect((await collect(chatStream(sse(text)))).map((entry) => entry.data).at(-1)).toBe("[DONE]");
		const quiet = (await collect(chatStream(text, { includeUsage: false }))).map((entry) => entry.data);
		expect(quiet.some((chunk) => chunk.usage)).toBe(false);
	});

	it("Chat Completions: an error object, a failing source and a stream cut short each give an error chunk and [DONE]", async () => {
		const failed = (await collect(chatStream([{ error: { code: 429, message: "slow" } }], {}))).map((entry) => entry.data);
		expect(failed).toEqual([{ error: { message: "slow", type: "invalid_request_error", param: null, code: 429 } }, "[DONE]"]);
		const broken = (async function* () {
			yield text[0];
			throw Object.assign(new Error("reset"), { type: "overloaded_error" });
		})();
		const thrown = (await collect(chatStream(broken, {}))).map((entry) => entry.data);
		expect(thrown.at(-2)).toEqual({ error: { message: "reset", type: "overloaded_error", param: null, code: null } });
		const plain = { [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(new Error("plain")) }) };
		expect((await collect(chatStream(plain, {}))).map((entry) => entry.data)[0].error.type).toBe("api_error");
		const cut = (await collect(chatStream(text.slice(0, 1), {}))).map((entry) => entry.data);
		expect(cut.at(-2).error.message).toBe("Upstream stream ended before completion");
		expect(cut.at(-1)).toBe("[DONE]");
	});

	it("Anthropic events from objects and from SSE text, and an error event when the stream is cut", async () => {
		const events = await collect(anthropicStream(text, { model: "asked" }, {}));
		expect(events.map((entry) => entry.event)).toEqual([
			"message_start",
			"content_block_start",
			"content_block_delta",
			"content_block_delta",
			"content_block_stop",
			"message_delta",
			"message_stop"
		]);
		expect((await collect(anthropicStream(sse(text), { model: "asked" }))).at(-1).event).toBe("message_stop");
		const cut = await collect(anthropicStream(text.slice(0, 1), { model: "asked" }, {}));
		expect(cut.at(-1)).toMatchObject({ event: "error" });
	});
});

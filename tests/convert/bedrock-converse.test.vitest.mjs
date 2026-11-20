/**
 * @fileoverview The Converse converters called directly: request conversion (both fronts, the tool error marker switched off), reply conversion and the stream converters over event messages and SSE text, including failures.
 */
import { describe, expect, it } from "vitest";
import { request as fromAnthropic } from "../../src/api/convert/anthropic/messages/to/bedrock/converse/request.mjs";
import { request as fromChat } from "../../src/api/convert/openai/chat/to/bedrock/converse/request.mjs";
import { response as toChat } from "../../src/api/convert/bedrock/converse/to/openai/chat/response.mjs";
import { response as toAnthropic } from "../../src/api/convert/bedrock/converse/to/anthropic/messages/response.mjs";
import { stream as chatStream } from "../../src/api/convert/bedrock/converse/to/openai/chat/stream.mjs";
import { stream as anthropicStream } from "../../src/api/convert/bedrock/converse/to/anthropic/messages/stream.mjs";
import { collect } from "../helpers/streams.mjs";

const result = [{ role: "tool", tool_call_id: "t", content: "[error] bad" }];
const chatTools = [{ type: "function", function: { name: "R" } }];
const tools = [{ name: "R", input_schema: { type: "object" } }];
const messages = [{ role: "user", content: "hi" }];
const text = [
	["messageStart", { role: "assistant" }],
	["contentBlockDelta", { contentBlockIndex: 0, delta: { text: "hi" } }],
	["messageStop", { stopReason: "end_turn" }],
	["metadata", { usage: { inputTokens: 1, outputTokens: 2 } }]
].map(([event, data]) => ({ event, data }));

describe("request converters", () => {
	it("Chat Completions: needs messages, keeps the error marker unless toolErrors is off", () => {
		expect(() => fromChat({ model: "m" })).toThrow(/messages: Field required/);
		expect(() => fromChat(null)).toThrow(/messages: Field required/);
		const on = fromChat({ model: "m", tools: chatTools, messages: result }, {});
		expect(on.body.messages[0].content[0].toolResult.status).toBe("error");
		expect(on.state).toMatchObject({ front: "openai", model: "m", stream: false, includeUsage: false });
		const off = fromChat(
			{ model: "m", tools: chatTools, stream: true, stream_options: { include_usage: true }, messages: result },
			{ toolErrors: false }
		);
		expect(off.body.messages[0].content[0].toolResult).toEqual({ toolUseId: "t", content: [{ text: "[error] bad" }] });
		expect(off.state).toMatchObject({ stream: true, includeUsage: true });
	});

	it("Anthropic: toolErrors off leaves the marker alone, and the sampling setting and metadata.sampling merge", async () => {
		const body = {
			model: "m",
			max_tokens: 5,
			tools,
			messages: [
				...messages,
				{ role: "assistant", content: "x" },
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "bad", is_error: true }] }
			]
		};
		const off = await fromAnthropic(body, { toolErrors: false });
		expect(JSON.stringify(off.body.messages)).not.toContain('"status"');
		const noTools = await fromAnthropic({ ...body, tools: undefined });
		expect(JSON.stringify(noTools.body)).not.toMatch(/toolResult|toolConfig/);
		expect(JSON.stringify(noTools.body.messages)).toContain("[Tool call failed: bad]");
		const on = await fromAnthropic({
			...body,
			messages: [{ role: "assistant", content: [{ type: "tool_use", id: "t", name: "R", input: {} }] }, body.messages.at(-1)]
		});
		expect(on.body.messages.at(-1).content[0].toolResult.status).toBe("error");
		const merged = await fromAnthropic(
			{ model: "m", max_tokens: 5, metadata: { sampling: { b: 2 } }, messages },
			{ sampling: { a: 1, b: 1 } }
		);
		expect(merged.body.additionalModelRequestFields).toEqual({ a: 1, b: 2 });
	});
});

describe("response converters", () => {
	const reply = { output: { message: { content: [{ text: "ok" }] } }, stopReason: "end_turn", usage: { inputTokens: 3, outputTokens: 4 } };

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
	it("Chat Completions chunks from messages, from SSE text, and without a state", async () => {
		const state = { model: "asked", includeUsage: true };
		const out = (await collect(chatStream(text, state, {}))).map((entry) => entry.data);
		expect(out.at(-1)).toBe("[DONE]");
		expect(out.find((chunk) => chunk.usage)).toMatchObject({ model: "asked", usage: { prompt_tokens: 1, completion_tokens: 2 } });
		expect(state.upstreamUsage).toMatchObject({ input_tokens: 1, output_tokens: 2 });
		const sse = text.map((entry) => `event: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\n\n`).join("");
		expect((await collect(chatStream(sse))).map((entry) => entry.data).at(-1)).toBe("[DONE]");
		const quiet = (await collect(chatStream(text, { includeUsage: false }))).map((entry) => entry.data);
		expect(quiet.some((chunk) => chunk.usage)).toBe(false);
	});

	it("Chat Completions: an error message, a failing source and a stream cut short each give an error chunk and [DONE]", async () => {
		const failed = (
			await collect(chatStream([{ event: "error", data: { error: { type: "rate_limit_error", message: "slow" } } }], {}))
		).map((entry) => entry.data);
		expect(failed).toEqual([{ error: { message: "slow", type: "rate_limit_error", param: null, code: 429 } }, "[DONE]"]);
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
		const sse = text.map((entry) => `event: ${entry.event}\ndata: ${JSON.stringify(entry.data)}\n\n`).join("");
		expect((await collect(anthropicStream(sse, { model: "asked" }))).at(-1).event).toBe("message_stop");
		const cut = await collect(anthropicStream(text.slice(0, 2), { model: "asked" }, {}));
		expect(cut.at(-1)).toMatchObject({ event: "error" });
	});
});

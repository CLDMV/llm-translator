/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/driver/deepseek.test.vitest.mjs
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
 * @fileoverview DeepSeek driver: host detection, thinking-mode request fixes, reasoning round trip and trailing usage.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { openaiSse } from "../helpers/streams.mjs";
import { sign } from "../../src/lib/thinking.mjs";

afterEach(closeAll);

const endpoint = { url: "https://api.deepseek.com", headers: {}, apiKey: undefined };
const url = "https://api.deepseek.com";
const REJECT = "The `reasoning_content` in the thinking mode must be passed back to the API.";
const chatBody = (transport) => JSON.parse(transport.calls.find((call) => call.url.endsWith("/chat/completions")).init.body);
const tool = { name: "Read", description: "read", input_schema: { type: "object", properties: { path: { type: "string" } } } };

/**
 * A DeepSeek stand-in that enforces the rule: in thinking mode every earlier assistant turn that made tool calls must carry
 * `reasoning_content`, or the request is a 400.
 * @param {(body: any) => any} [answer] - Reply for accepted requests.
 * @returns {Function} Fake transport.
 */
const deepseek = (answer = () => ({ body: completion() })) =>
	fakeTransport((_url, init) => {
		const body = JSON.parse(init.body);
		const missing = body.messages.some((message) => message.role === "assistant" && message.tool_calls && !message.reasoning_content);
		if (missing && /reasoner/.test(body.model)) return { status: 400, body: { error: { message: REJECT, type: "invalid_request_error" } } };
		return answer(body);
	});
const completion = (extra = {}) => ({
	id: "c",
	object: "chat.completion",
	model: "deepseek-reasoner",
	choices: [{ index: 0, message: { role: "assistant", content: "done", reasoning_content: "thought" }, finish_reason: "stop" }],
	usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
	...extra
});

describe("deepseek detection", () => {
	it("matches api.deepseek.com by host (no request of its own)", async () => {
		const transport = fakeTransport(() => ({ body: {} }));
		const api = await make({ upstreams: [url], transport });
		expect(api.status().upstreams[0]).toMatchObject({ driver: "deepseek", protocol: "openai.chat" });
		expect(api.driver.deepseek.detect({ endpoint })).toEqual({ host: "api.deepseek.com" });
		expect(api.driver.deepseek.detect({ endpoint: { url: "https://deepseek.example.com" } })).toBeNull();
		expect(api.driver.deepseek.detect({ endpoint: { url: "not a url" } })).toBeNull();
	});

	it("an explicit backend wins", async () => {
		const api = await make({ upstreams: [{ url, backend: "compatible" }], transport: fakeTransport(() => ({ body: {} })) });
		expect(api.status().upstreams[0].driver).toBe("compatible");
	});

	it("settings fit the hosted API", async () => {
		const api = await make({ upstreams: [url], detect: false });
		expect(api.driver.deepseek.settings()).toMatchObject({
			reasoningField: "reasoning_content",
			topK: false,
			images: false,
			responseFormat: false
		});
	});
});

describe("deepseek.request in thinking mode", () => {
	const messages = [{ role: "user", content: "hi" }];
	const tools = [{ type: "function", function: { name: "f", parameters: {} } }];

	it("removes forced tool choice and log probabilities from reasoner requests, recording each drop", async () => {
		const api = await make({ upstreams: [url], detect: false });
		const { request } = api.driver.deepseek;
		const state = { dropped: ["logprobs"] };
		const forced = request(
			{ model: "deepseek-reasoner", messages, tools, tool_choice: "required", logprobs: true, top_logprobs: 2 },
			{ state }
		);
		expect(forced).toEqual({ model: "deepseek-reasoner", messages, tools });
		expect(state.dropped).toEqual(["logprobs", "tool_choice", "top_logprobs"]);
		const named = request({ model: "deepseek-reasoner", messages, tools, tool_choice: { type: "function", function: { name: "f" } } });
		expect(named.tool_choice).toBeUndefined();
		for (const choice of ["auto", "none"])
			expect(request({ model: "deepseek-reasoner", messages, tools, tool_choice: choice }).tool_choice).toBe(choice);
	});

	it("leaves non-thinking requests alone, and follows an explicit thinking switch", async () => {
		const api = await make({ upstreams: [url], detect: false });
		const { request } = api.driver.deepseek;
		const chat = { model: "deepseek-chat", messages, tools, tool_choice: "required", logprobs: true };
		expect(request(chat)).toEqual(chat);
		expect(request({ ...chat, thinking: { type: "enabled" } }).tool_choice).toBeUndefined();
		expect(request({ ...chat, model: "deepseek-reasoner", thinking: { type: "disabled" } }).tool_choice).toBe("required");
		expect(request({ model: "deepseek-reasoner", messages, tools: [], tool_choice: "required" })).toEqual({
			model: "deepseek-reasoner",
			messages
		});
	});
});

describe("deepseek reasoning round trip against a server that enforces it", () => {
	const turn1 = [{ role: "user", content: "read /a" }];
	const assistant = (thinking) => ({
		role: "assistant",
		content: [
			...(thinking ? [{ type: "thinking", thinking, signature: sign() }] : []),
			{ type: "text", text: "Reading." },
			{ type: "tool_use", id: "toolu_1", name: "Read", input: { path: "/a" } }
		]
	});
	const result = { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "file body" }] };

	it("a multi-turn tool conversation succeeds when the client replays its thinking blocks", async () => {
		const transport = deepseek();
		const api = await make({ upstreams: [url], transport });
		const reply = await api.send({
			model: "deepseek-reasoner",
			max_tokens: 64,
			tools: [tool],
			messages: [...turn1, assistant("need the file"), result]
		});
		expect(reply.status).toBe(200);
		const sent = chatBody(transport);
		const turn = sent.messages.find((message) => message.role === "assistant");
		expect(turn.reasoning_content).toBe("need the file");
		expect(turn.tool_calls).toHaveLength(1);
		expect(reply.body.content.map((block) => block.type)).toEqual(["thinking", "text"]);
	});

	it("without replayed reasoning the refusal is explained (a side channel for it is tracked in #45)", async () => {
		const api = await make({ upstreams: [url], transport: deepseek() });
		const reply = await api.send({
			model: "deepseek-reasoner",
			max_tokens: 64,
			tools: [tool],
			messages: [...turn1, assistant(""), result]
		});
		expect(reply.status).toBe(400);
		expect(reply.body.error.message).toContain("reasoning_content");
		expect(reply.body.error.message).toContain("start a new conversation");
		const other = await api.driver.deepseek.error(400, {
			error: { message: "bad request", type: "invalid_request_error", code: "x", param: "p" }
		});
		expect(other.error).toEqual({ message: "bad request", type: "invalid_request_error", param: "p", code: "x" });
		expect((await api.driver.deepseek.error(500, "boom")).error).toMatchObject({ message: "boom", code: 500 });
	});

	it("forced tool choice from the client does not break a reasoner request", async () => {
		const transport = deepseek();
		const api = await make({ upstreams: [url], transport });
		await api.send({ model: "deepseek-reasoner", max_tokens: 8, tools: [tool], tool_choice: { type: "any" }, messages: turn1 });
		expect(chatBody(transport).tool_choice).toBeUndefined();
	});
});

describe("deepseek usage on the last content chunk", () => {
	const base = { id: "c", object: "chat.completion.chunk", model: "deepseek-chat" };
	const frames = [
		{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
		{ ...base, choices: [{ index: 0, delta: { reasoning_content: "hm" }, finish_reason: null }] },
		{ ...base, choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }] },
		{
			...base,
			choices: [{ index: 0, delta: { content: "!" }, finish_reason: "stop" }],
			usage: { prompt_tokens: 11, completion_tokens: 4, total_tokens: 15 }
		},
		"[DONE]"
	];
	const stream = () => new Response(openaiSse(frames), { status: 200, headers: { "content-type": "text/event-stream" } });

	it("Anthropic front: usage reaches message_delta and the report", async () => {
		const api = await make({ upstreams: [url], transport: fakeTransport(stream) });
		const reply = await api.send({ model: "deepseek-chat", max_tokens: 32, stream: true, messages: [{ role: "user", content: "hi" }] });
		const events = await collect(reply.stream);
		expect(events.find((event) => event.event === "message_delta").data.usage).toMatchObject({ input_tokens: 11, output_tokens: 4 });
		expect(await reply.usage).toMatchObject({ input_tokens: 11, output_tokens: 4, reported: true, estimated: null, complete: true });
	});

	it("OpenAI front: the report reads it and the stream is forwarded", async () => {
		const api = await make({ front: "openai", upstreams: [url], transport: fakeTransport(stream) });
		const reply = await api.send({ model: "deepseek-chat", stream: true, messages: [{ role: "user", content: "hi" }] });
		const events = await collect(reply.stream);
		expect(events.at(-1).data).toBe("[DONE]");
		expect(await reply.usage).toMatchObject({ input_tokens: 11, output_tokens: 4, reported: true, complete: true });
	});
});

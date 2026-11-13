/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/driver/mistral.test.vitest.mjs
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
 * @fileoverview Mistral driver: host detection, id format, seed and tool choice spelling, typed content chunks (non-stream and stream).
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { openaiSse } from "../helpers/streams.mjs";
import { flatten } from "../../src/lib/typed.mjs";

afterEach(closeAll);

const url = "https://api.mistral.ai";
const chatBody = (transport) => JSON.parse(transport.calls.find((call) => call.url.endsWith("/chat/completions")).init.body);
const tool = { name: "Read", description: "read", input_schema: { type: "object", properties: { path: { type: "string" } } } };
const base = { id: "c", object: "chat.completion.chunk", model: "magistral-medium" };
const sse = (frames) => () => new Response(openaiSse(frames), { status: 200, headers: { "content-type": "text/event-stream" } });

describe("mistral detection and facts", () => {
	it("matches api.mistral.ai by host, with the 9-character id policy", async () => {
		const api = await make({ upstreams: [url], transport: fakeTransport(() => ({ body: {} })) });
		expect(api.status().upstreams[0]).toMatchObject({ driver: "mistral", protocol: "openai.chat" });
		expect(api.driver.mistral.detect({ endpoint: { url: "https://api.mistral.ai/v1" } })).toEqual({ host: "api.mistral.ai" });
		expect(api.driver.mistral.detect({ endpoint: { url: "https://mistral.example.com" } })).toBeNull();
		expect(api.driver.mistral.detect({ endpoint: { url: "not a url" } })).toBeNull();
		expect(api.driver.mistral.info().toolCallIds).toEqual({ alphabet: "a-zA-Z0-9", min: 9, max: 9 });
		expect(api.driver.mistral.settings()).toMatchObject({ reasoningField: "reasoning_content", topK: false });
	});

	it("an explicit backend wins", async () => {
		const api = await make({ upstreams: [{ url, backend: "compatible" }], transport: fakeTransport(() => ({ body: {} })) });
		expect(api.status().upstreams[0].driver).toBe("compatible");
	});
});

describe("mistral.request", () => {
	const messages = [{ role: "user", content: "hi" }];
	const tools = [{ type: "function", function: { name: "f", parameters: {} } }];

	it("renames seed to random_seed and required to any", async () => {
		const api = await make({ upstreams: [url], detect: false });
		const { request } = api.driver.mistral;
		expect(request({ model: "m", messages, tools, seed: 7, tool_choice: "required" })).toEqual({
			model: "m",
			messages,
			tools,
			random_seed: 7,
			tool_choice: "any"
		});
		expect(request({ model: "m", messages, seed: 1, random_seed: 2 }).random_seed).toBe(2);
		expect(request({ model: "m", messages, tools, tool_choice: "auto" }).tool_choice).toBe("auto");
		expect(request({ model: "m", messages, tools: [], tool_choice: "required" })).toEqual({ model: "m", messages });
	});

	it("replayed history gets valid ids and the Anthropic any choice is sent as any", async () => {
		const transport = fakeTransport(() => ({
			body: {
				id: "c",
				object: "chat.completion",
				model: "m",
				choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }]
			}
		}));
		const api = await make({ upstreams: [url], transport });
		await api.send({
			model: "m",
			max_tokens: 16,
			tools: [tool],
			tool_choice: { type: "any" },
			messages: [
				{ role: "user", content: "read /a" },
				{ role: "assistant", content: [{ type: "tool_use", id: "toolu_01ABCdef-long", name: "Read", input: { path: "/a" } }] },
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_01ABCdef-long", content: "body" }] }
			]
		});
		const sent = chatBody(transport);
		const id = sent.messages.find((message) => message.tool_calls).tool_calls[0].id;
		expect(id).toMatch(/^[a-zA-Z0-9]{9}$/);
		expect(sent.messages.find((message) => message.role === "tool").tool_call_id).toBe(id);
		expect(sent.tool_choice).toBe("any");
	});
});

describe("typed content chunks", () => {
	it("flatten reads text and thinking chunks and skips the rest", () => {
		expect(flatten("plain")).toBeNull();
		expect(
			flatten([
				{
					type: "thinking",
					thinking: [
						{ type: "text", text: "a" },
						{ type: "text", text: "b" }
					]
				},
				{ type: "thinking", thinking: "c" },
				{ type: "thinking" },
				{ type: "text", text: "Hi" },
				{ type: "text" },
				{ type: "reference", reference_ids: [1] },
				null
			])
		).toEqual({ text: "Hi", thinking: "abc" });
	});

	const completion = (content) => ({
		id: "c",
		object: "chat.completion",
		model: "magistral-medium",
		choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
		usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
	});

	it("non-stream: chunks become thinking and text blocks", async () => {
		const typed = [
			{ type: "thinking", thinking: [{ type: "text", text: "hmm" }] },
			{ type: "text", text: "Hello" }
		];
		const api = await make({ upstreams: [url], transport: fakeTransport(() => ({ body: completion(typed) })) });
		const reply = await api.send({ model: "magistral-medium", max_tokens: 16, messages: [{ role: "user", content: "hi" }] });
		expect(reply.body.content).toMatchObject([
			{ type: "thinking", thinking: "hmm" },
			{ type: "text", text: "Hello" }
		]);
	});

	it("non-stream: string content, text-only chunks and unusual bodies pass", async () => {
		const { response } = (await make({ upstreams: [url], detect: false })).driver.mistral;
		expect(response(null)).toBeNull();
		const plain = completion("Hi");
		expect(response(plain)).toEqual(plain);
		expect(response({ choices: [null] })).toEqual({ choices: [null] });
		expect(response(completion([{ type: "text", text: "T" }])).choices[0].message).toEqual({ role: "assistant", content: "T" });
	});

	const frames = [
		{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
		{
			...base,
			choices: [{ index: 0, delta: { content: [{ type: "thinking", thinking: [{ type: "text", text: "hm" }] }] }, finish_reason: null }]
		},
		{
			...base,
			choices: [
				{
					index: 0,
					delta: {
						content: [
							{ type: "thinking", thinking: [{ type: "text", text: "m" }], closed: true },
							{ type: "text", text: "Hi" }
						]
					},
					finish_reason: null
				}
			]
		},
		{
			...base,
			choices: [{ index: 0, delta: { content: "!" }, finish_reason: "stop" }],
			usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
		},
		"[DONE]"
	];

	it("stream, Anthropic front: thinking then text", async () => {
		const api = await make({ upstreams: [url], transport: fakeTransport(sse(frames)) });
		const reply = await api.send({ model: "magistral-medium", max_tokens: 16, stream: true, messages: [{ role: "user", content: "hi" }] });
		const events = await collect(reply.stream);
		const deltas = events.filter((event) => event.event === "content_block_delta").map((event) => event.data.delta);
		expect(
			deltas
				.filter((delta) => delta.type === "thinking_delta")
				.map((delta) => delta.thinking)
				.join("")
		).toBe("hmm");
		expect(
			deltas
				.filter((delta) => delta.type === "text_delta")
				.map((delta) => delta.text)
				.join("")
		).toBe("Hi!");
	});

	it("stream, OpenAI front: reasoning_content and content", async () => {
		const api = await make({ front: "openai", upstreams: [url], transport: fakeTransport(sse(frames)) });
		const reply = await api.send({ model: "magistral-medium", stream: true, messages: [{ role: "user", content: "hi" }] });
		const events = await collect(reply.stream);
		const deltas = events.map((event) => event.data?.choices?.[0]?.delta).filter(Boolean);
		expect(deltas.map((delta) => delta.reasoning_content ?? "").join("")).toBe("hmm");
		expect(deltas.map((delta) => delta.content ?? "").join("")).toBe("Hi!");
	});

	it("chunk leaves string deltas and empty chunks alone", async () => {
		const { chunk } = (await make({ upstreams: [url], detect: false })).driver.mistral;
		const plain = { ...base, choices: [{ index: 0, delta: { content: "x" } }] };
		expect(chunk(plain)).toBe(plain);
		expect(chunk({ ...base, choices: [] })).toEqual({ ...base, choices: [] });
		expect(chunk(undefined)).toBeUndefined();
		const only = chunk({ ...base, choices: [{ index: 0, delta: { content: [{ type: "text", text: "T" }] } }] });
		expect(only.choices[0].delta).toEqual({ content: "T" });
	});
});

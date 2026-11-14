/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/driver/openrouter.test.vitest.mjs
 *	@Date: 2026-11-13T09:00:00-08:00 (1794589200)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-13T09:00:00-08:00 (1794589200)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview OpenRouter driver: host detection, reasoning controls, reasoning_details round trip, errors on a choice or the reply, SSE comments and the final usage chunk.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { openaiSse } from "../helpers/streams.mjs";
import { found, failure } from "../../src/lib/openrouter.mjs";

afterEach(closeAll);

const url = "https://openrouter.ai/api";
const user = [{ role: "user", content: "hi" }];
const tool = { name: "Read", description: "read", input_schema: { type: "object", properties: { path: { type: "string" } } } };
const call = { id: "call_1", type: "function", function: { name: "Read", arguments: '{"path":"/a"}' } };
const chatBodies = (transport) =>
	transport.calls.filter((entry) => entry.url.endsWith("/chat/completions")).map((entry) => JSON.parse(entry.init.body));
const completion = (choice, extra = {}) => ({
	id: "gen-1",
	object: "chat.completion",
	model: "anthropic/claude-sonnet-4.5",
	choices: [{ index: 0, ...choice }],
	usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
	...extra
});
const raw = (text) => () => new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
const base = { id: "gen-1", object: "chat.completion.chunk", model: "anthropic/claude-sonnet-4.5", provider: "Anthropic" };

// OpenRouter's three reasoning_details shapes, in the order the model produced them.
const details = [
	{ type: "reasoning.summary", summary: "Looked at the path.", id: "rs_1", format: "openai-responses-v1", index: 0 },
	{ type: "reasoning.text", text: "Need the file.", signature: "sig-abc", id: "rt_1", format: "anthropic-claude-v1", index: 1 },
	{ type: "reasoning.encrypted", data: "ENCRYPTED-BLOB", id: "re_1", format: "openai-responses-v1", index: 2 }
];

describe("openrouter detection and facts", () => {
	it("matches openrouter.ai by host and builds the /api/v1 URL", async () => {
		const api = await make({ upstreams: [{ url, apiKey: "k" }], transport: fakeTransport(() => ({ body: {} })) });
		expect(api.status().upstreams[0]).toMatchObject({ driver: "openrouter", protocol: "openai.chat" });
		const { detect } = api.driver.openrouter;
		expect(detect({ endpoint: { url: "https://openrouter.ai/api/v1" } })).toEqual({ host: "openrouter.ai" });
		expect(detect({ endpoint: { url: "https://openrouter.example.com" } })).toBeNull();
		expect(detect({ endpoint: { url: "not a url" } })).toBeNull();
		expect(api.driver.openrouter.info()).toMatchObject({ order: 37, auth: "bearer" });
		expect(api.driver.openrouter.settings()).toMatchObject({ reasoningRoundTrip: true, maxTokensField: "max_tokens" });
		const sent = await api.request({ model: "openai/gpt-5", max_tokens: 16, messages: user });
		expect(sent.url).toBe("https://openrouter.ai/api/v1/chat/completions");
		expect(sent.headers.authorization).toBe("Bearer k");
	});

	it("a bare host gets /api, and path covers every call", async () => {
		const api = await make({ upstreams: [{ url: "https://openrouter.ai", backend: "openrouter" }], detect: false });
		expect((await api.request({ model: "m", max_tokens: 1, messages: user })).url).toBe("https://openrouter.ai/api/v1/chat/completions");
		const { path } = api.driver.openrouter;
		expect(path("embeddings", { endpoint: { url: "https://openrouter.ai" } })).toBe("/api/v1/embeddings");
		expect(path("models", { endpoint: { url: "https://openrouter.ai/api" } })).toBe("/v1/models");
	});

	it("a pasted /api/v1 base gives the same URL, and an explicit backend wins", async () => {
		const api = await make({ upstreams: [{ url: "https://openrouter.ai/api/v1/", backend: "openrouter" }], detect: false });
		expect((await api.request({ model: "m", max_tokens: 1, messages: user })).url).toBe("https://openrouter.ai/api/v1/chat/completions");
		const other = await make({ upstreams: [{ url, backend: "compatible" }], transport: fakeTransport(() => ({ body: {} })) });
		expect(other.status().upstreams[0].driver).toBe("compatible");
	});
});

describe("openrouter reasoning controls", () => {
	const ask = async (body, config = {}) => {
		const api = await make({ upstreams: [{ url, backend: "openrouter" }], detect: false, ...config });
		return (await api.request({ model: "m", max_tokens: 4096, messages: user, ...body })).body;
	};

	it("Anthropic thinking with a budget becomes reasoning.max_tokens, capped below max_tokens", async () => {
		const body = await ask({ thinking: { type: "enabled", budget_tokens: 2048 } });
		expect(body.reasoning).toEqual({ max_tokens: 2048 });
		expect(body.reasoning_effort).toBeUndefined();
		expect((await ask({ thinking: { type: "enabled", budget_tokens: 9000 } })).reasoning).toEqual({ max_tokens: 4095 });
		expect((await ask({ max_tokens: undefined, thinking: { type: "enabled", budget_tokens: 2048 } })).reasoning).toEqual({
			max_tokens: 2048
		});
	});

	it("an explicit effort wins over the budget, and enabled thinking without either uses medium", async () => {
		const withEffort = await ask({ thinking: { type: "enabled", budget_tokens: 2048 }, output_config: { effort: "high" } });
		expect(withEffort.reasoning).toEqual({ effort: "high" });
		expect((await ask({ thinking: { type: "enabled" } })).reasoning).toEqual({ effort: "medium" });
		expect((await ask({ thinking: { type: "adaptive" }, output_config: { effort: "xhigh" } })).reasoning).toEqual({ effort: "xhigh" });
	});

	it("disabled thinking turns reasoning off and no thinking sends no reasoning", async () => {
		expect((await ask({ thinking: { type: "disabled" } })).reasoning).toEqual({ effort: "none" });
		expect(await ask({})).not.toHaveProperty("reasoning");
	});

	it("OpenAI front: reasoning_effort becomes reasoning.effort and a client reasoning object is kept", async () => {
		const config = { front: "openai" };
		const effort = await ask({ reasoning_effort: "low" }, config);
		expect(effort.reasoning).toEqual({ effort: "low" });
		expect(effort.reasoning_effort).toBeUndefined();
		const own = await ask({ reasoning: { max_tokens: 1500, exclude: true }, reasoning_effort: "low" }, config);
		expect(own.reasoning).toEqual({ max_tokens: 1500, exclude: true });
		expect(own.reasoning_effort).toBeUndefined();
		expect(await ask({}, config)).not.toHaveProperty("reasoning");
	});

	it("request drops empty tool fields", async () => {
		const { request } = (await make({ upstreams: [url], detect: false })).driver.openrouter;
		expect(request({ model: "m", messages: user, tools: [], tool_choice: "auto" })).toEqual({ model: "m", messages: user });
		expect(request({ model: "m", messages: user, reasoning: null, reasoning_effort: "high" }).reasoning).toEqual({ effort: "high" });
	});
});

describe("reasoning_details round trip", () => {
	const replay = [
		{ role: "user", content: "read /a" },
		null,
		{ role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "body" }] }
	];

	it("non-stream: all three item shapes come back unmodified and in order on the next turn", async () => {
		const reply = completion({
			message: { role: "assistant", content: "", reasoning: "Need the file.", reasoning_details: details, tool_calls: [call] },
			finish_reason: "tool_calls"
		});
		const transport = fakeTransport(() => ({ body: reply }));
		const api = await make({ upstreams: [url], transport });
		const first = await api.send({ model: "m", max_tokens: 64, tools: [tool], messages: [replay[0]] });
		const blocks = first.body.content;
		expect(blocks[0]).toMatchObject({ type: "thinking", thinking: "Need the file." });
		expect(blocks.at(-1)).toMatchObject({ type: "tool_use", id: "call_1" });
		const history = [replay[0], { role: "assistant", content: blocks }, replay[2]];
		await api.send({ model: "m", max_tokens: 64, tools: [tool], messages: history });
		const assistant = chatBodies(transport)[1].messages.find((message) => message.role === "assistant");
		expect(assistant.reasoning_details).toEqual(details);
		expect(assistant.reasoning).toBe("Need the file.");
	});

	it("stream: fragments of one item are merged and the whole list is replayed in order", async () => {
		const delta = (fields, finish = null) => ({ ...base, choices: [{ index: 0, delta: fields, finish_reason: finish }] });
		const frames = [
			delta({ role: "assistant", content: "" }),
			delta({
				reasoning: "Need ",
				reasoning_details: [{ type: "reasoning.text", text: "Need ", id: "rt_1", format: "anthropic-claude-v1", index: 0 }]
			}),
			delta({
				reasoning: "the file.",
				reasoning_details: [{ type: "reasoning.text", text: "the file.", signature: "sig-abc", format: "anthropic-claude-v1", index: 0 }]
			}),
			delta({
				reasoning_details: [{ type: "reasoning.encrypted", data: "ENCRYPTED-BLOB", id: "re_1", format: "openai-responses-v1", index: 1 }]
			}),
			delta({ tool_calls: [{ index: 0, ...call }] }),
			delta({}, "tool_calls"),
			"[DONE]"
		];
		const transport = fakeTransport((target, init) => {
			const streaming = JSON.parse(init.body).stream === true;
			return streaming
				? raw(openaiSse(frames))()
				: { body: completion({ message: { role: "assistant", content: "done" }, finish_reason: "stop" }) };
		});
		const api = await make({ upstreams: [url], transport });
		const first = await api.send({ model: "m", max_tokens: 64, stream: true, tools: [tool], messages: [replay[0]] });
		const events = await collect(first.stream);
		const blocks = [];
		for (const event of events) {
			if (event.event === "content_block_start") blocks.push({ ...event.data.content_block });
			if (event.event === "content_block_delta" && event.data.delta.type === "signature_delta")
				blocks.at(-1).signature = event.data.delta.signature;
			if (event.event === "content_block_delta" && event.data.delta.type === "thinking_delta")
				blocks.at(-1).thinking += event.data.delta.thinking;
			if (event.event === "content_block_delta" && event.data.delta.type === "input_json_delta")
				blocks.at(-1).input = event.data.delta.partial_json;
		}
		expect(blocks[0]).toMatchObject({ type: "thinking", thinking: "Need the file." });
		const content = [
			{ type: "thinking", thinking: blocks[0].thinking, signature: blocks[0].signature },
			{ type: "tool_use", id: "call_1", name: "Read", input: { path: "/a" } }
		];
		await api.send({ model: "m", max_tokens: 64, tools: [tool], messages: [replay[0], { role: "assistant", content }, replay[2]] });
		const assistant = chatBodies(transport)[1].messages.find((message) => message.role === "assistant");
		expect(assistant.reasoning_details).toEqual([
			{ type: "reasoning.text", text: "Need the file.", signature: "sig-abc", id: "rt_1", format: "anthropic-claude-v1", index: 0 },
			{ type: "reasoning.encrypted", data: "ENCRYPTED-BLOB", id: "re_1", format: "openai-responses-v1", index: 1 }
		]);
	});

	it("OpenAI front: a reply's reasoning_details pass through and the client's replay is sent unchanged", async () => {
		const reply = completion({ message: { role: "assistant", content: "ok", reasoning_details: details }, finish_reason: "stop" });
		const transport = fakeTransport(() => ({ body: reply }));
		const api = await make({ front: "openai", upstreams: [url], transport });
		const first = await api.send({ model: "m", messages: user });
		expect(first.body.choices[0].message.reasoning_details).toEqual(details);
		const history = [...user, { role: "assistant", content: "ok", reasoning_details: details }, { role: "user", content: "more" }];
		await api.send({ model: "m", messages: history });
		expect(chatBodies(transport)[1].messages[1].reasoning_details).toEqual(details);
	});
});

describe("errors inside a successful reply", () => {
	const failed = completion({
		message: { role: "assistant", content: "partial output" },
		finish_reason: "error",
		error: {
			code: 502,
			message: "Provider disconnected mid-stream",
			metadata: { error_type: "provider_unavailable", provider_name: "Anthropic" }
		}
	});

	it("found and failure read choice and top-level errors", () => {
		expect(found(null)).toBeNull();
		expect(found("text")).toBeNull();
		expect(found(completion({ message: { content: "x" }, finish_reason: "stop" }))).toBeNull();
		expect(found({ choices: [{ error: { message: "a" } }, { message: {} }] })).toBeNull();
		expect(found({ choices: [{ error: { message: "a" } }, { error: { message: "b" } }] })).toEqual({ message: "a" });
		expect(found({ error: { code: 429, message: "slow" } })).toEqual({ code: 429, message: "slow" });
		expect(found({ error: "text" })).toBeNull();
		expect(found({ choices: [{ error: { code: 1 } }] })).toBeNull();
		const error = failure({ code: 429, message: "slow", metadata: { error_type: "rate_limit_exceeded" } });
		expect([error.status, error.code, error.message]).toEqual([429, "rate_limit_exceeded", "slow"]);
		const plain = failure({ code: "x", message: "m", metadata: {} });
		expect([plain.status, plain.code, plain.message]).toEqual([502, "upstream_error", "m"]);
		expect(failure({ code: 200, message: "m" }).status).toBe(502);
	});

	it("non-stream, Anthropic front: the choice error is an upstream error", async () => {
		const api = await make({ upstreams: [url], transport: fakeTransport(() => ({ body: failed })) });
		const reply = await api.send({ model: "m", max_tokens: 16, messages: user });
		expect(reply.status).toBe(502);
		expect(reply.body.error).toMatchObject({ message: "Provider disconnected mid-stream (provider Anthropic)" });
	});

	it("non-stream, OpenAI front: same error with the provider's status and code", async () => {
		const limited = completion({
			message: { role: "assistant", content: "" },
			finish_reason: "error",
			error: { code: 429, message: "Rate limit exceeded", metadata: { error_type: "rate_limit_exceeded" } }
		});
		const api = await make({ front: "openai", upstreams: [url], transport: fakeTransport(() => ({ body: limited })) });
		const reply = await api.send({ model: "m", messages: user });
		expect(reply.status).toBe(429);
		expect(reply.body.error).toMatchObject({ message: "Rate limit exceeded", code: "rate_limit_exceeded" });
	});

	it("a 200 with a top-level error and no choices is an upstream error", async () => {
		const body = { error: { code: 503, message: "No available provider" }, user_id: "u" };
		const api = await make({ front: "openai", upstreams: [url], transport: fakeTransport(() => ({ body })) });
		const reply = await api.send({ model: "m", messages: user });
		expect(reply.status).toBe(503);
		expect(reply.body.error.message).toBe("No available provider");
	});

	it("a good reply passes through response unchanged", async () => {
		const { response } = (await make({ upstreams: [url], detect: false })).driver.openrouter;
		const good = completion({ message: { role: "assistant", content: "ok" }, finish_reason: "stop" });
		expect(response(good)).toBe(good);
	});

	it("stream: a mid-stream error chunk ends the Anthropic stream with an error event", async () => {
		const frames = [
			{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "Hel" }, finish_reason: null }] },
			{
				...base,
				error: { code: 429, message: "Rate limit exceeded", metadata: { error_type: "rate_limit_exceeded" } },
				choices: [{ index: 0, delta: { content: "" }, finish_reason: "error" }]
			}
		];
		const api = await make({ upstreams: [url], transport: fakeTransport(raw(openaiSse(frames))) });
		const reply = await api.send({ model: "m", max_tokens: 16, stream: true, messages: user });
		const events = await collect(reply.stream);
		expect(events.at(-1)).toMatchObject({ event: "error", data: { error: { type: "rate_limit_error", message: "Rate limit exceeded" } } });
	});

	it("stream: an error on a choice becomes the same error event", async () => {
		const frames = [
			{
				...base,
				choices: [{ index: 0, delta: { content: "" }, finish_reason: "error", error: { code: 502, message: "Provider disconnected" } }]
			}
		];
		const api = await make({ upstreams: [url], transport: fakeTransport(raw(openaiSse(frames))) });
		const reply = await api.send({ model: "m", max_tokens: 16, stream: true, messages: user });
		const events = await collect(reply.stream);
		expect(events.at(-1)).toMatchObject({ event: "error", data: { error: { type: "api_error", message: "Provider disconnected" } } });
	});

	it("chunk leaves normal chunks and odd values alone", async () => {
		const { chunk } = (await make({ upstreams: [url], detect: false })).driver.openrouter;
		const plain = { ...base, choices: [{ index: 0, delta: { content: "x" } }] };
		expect(chunk(plain)).toBe(plain);
		expect(chunk(undefined)).toBeUndefined();
		expect(chunk({ choices: "no" })).toEqual({ choices: "no" });
		const given = { ...base, error: { message: "top" }, choices: [{ error: { message: "choice" } }] };
		expect(chunk(given)).toBe(given);
		expect(chunk({ ...base, choices: [{ index: 0, error: { message: "choice" } }] }).error).toEqual({ message: "choice" });
	});
});

describe("stream framing", () => {
	// OpenRouter's keep-alive comments, and a final usage chunk that has one choice with an empty delta repeating the finish reason.
	const text =
		": OPENROUTER PROCESSING\n\n" +
		openaiSse([
			{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "Hi" }, finish_reason: null }] },
			{ ...base, choices: [{ index: 0, delta: { content: "!" }, finish_reason: "stop" }] }
		]) +
		": OPENROUTER PROCESSING\n\n" +
		openaiSse([
			{
				...base,
				choices: [{ index: 0, delta: { content: "" }, finish_reason: "stop" }],
				usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10, cost: 0.0001 }
			},
			"[DONE]"
		]);

	it("Anthropic front: comments are ignored, one stop, usage from the last chunk", async () => {
		const api = await make({ upstreams: [url], transport: fakeTransport(raw(text)) });
		const reply = await api.send({ model: "m", max_tokens: 16, stream: true, messages: user });
		const events = await collect(reply.stream);
		const deltas = events.filter((event) => event.event === "message_delta");
		expect(deltas).toHaveLength(1);
		expect(deltas[0].data.delta.stop_reason).toBe("end_turn");
		expect(deltas[0].data.usage.output_tokens).toBe(3);
		expect(
			events
				.filter((event) => event.event === "content_block_delta")
				.map((event) => event.data.delta.text)
				.join("")
		).toBe("Hi!");
		expect(events.filter((event) => event.event === "message_stop")).toHaveLength(1);
		expect(events.some((event) => event.event === "error")).toBe(false);
		expect((await reply.usage).input_tokens).toBe(7);
	});

	it("OpenAI front: comments are skipped and the usage chunk is forwarded", async () => {
		const api = await make({ front: "openai", upstreams: [url], transport: fakeTransport(raw(text)) });
		const reply = await api.send({ model: "m", stream: true, stream_options: { include_usage: true }, messages: user });
		const events = await collect(reply.stream);
		expect(events.every((event) => event.data === "[DONE]" || typeof event.data === "object")).toBe(true);
		expect(events.find((event) => event.data?.usage)?.data.usage).toMatchObject({ prompt_tokens: 7, completion_tokens: 3 });
		expect(events.at(-1).data).toBe("[DONE]");
	});
});

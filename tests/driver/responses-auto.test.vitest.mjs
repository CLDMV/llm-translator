/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/driver/responses-upstream.test.vitest.mjs
 *	@Date: 2026-11-17T12:00:00-08:00 (1794945600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-17T12:00:00-08:00 (1794945600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * @fileoverview `api: "auto"` for the Responses API: a driver that declares it is asked on `/v1/responses` first, a 404, 405 or 501 drops
 * that upstream to Chat Completions (remembered until the next detection), and other errors are not a reason to. Every upstream is a mocked transport.
 */
import { afterAll, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";

afterAll(closeAll);

const url = "http://gpu-box:8000";
const user = [{ role: "user", content: "hi" }];
const responsesAnswer = {
	id: "resp_1",
	object: "response",
	created_at: 1700000000,
	status: "completed",
	model: "qwen",
	output: [
		{
			type: "message",
			id: "msg_1",
			role: "assistant",
			status: "completed",
			content: [{ type: "output_text", text: "from responses", annotations: [] }]
		}
	],
	usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 }
};
const chatAnswer = {
	id: "chat_1",
	object: "chat.completion",
	created: 1700000000,
	model: "qwen",
	choices: [{ index: 0, message: { role: "assistant", content: "from chat" }, finish_reason: "stop" }],
	usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
};
const stream = (events) =>
	new Response(events.map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`).join(""), {
		status: 200,
		headers: { "content-type": "text/event-stream" }
	});
const chatStream = () =>
	stream([
		{
			id: "c1",
			object: "chat.completion.chunk",
			model: "qwen",
			choices: [{ index: 0, delta: { role: "assistant", content: "from chat" } }]
		},
		{ id: "c1", object: "chat.completion.chunk", model: "qwen", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
		"[DONE]"
	]);
const responsesStream = () =>
	new Response(
		[
			{ type: "response.created", response: { id: "r1", model: "qwen", status: "in_progress", output: [] } },
			{ type: "response.output_item.added", output_index: 0, item: { type: "message", id: "m1", content: [] } },
			{ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "from responses" },
			{ type: "response.output_item.done", output_index: 0, item: responsesAnswer.output[0] },
			{ type: "response.completed", response: responsesAnswer }
		]
			.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
			.join(""),
		{ status: 200, headers: { "content-type": "text/event-stream" } }
	);

/**
 * A server whose `/v1/responses` answers `status` (200 when it is absent) and whose chat endpoint answers normally.
 * @param {number | undefined} status - Status of the Responses call.
 * @returns {any} Transport.
 */
const server = (status) =>
	fakeTransport((target, init) => {
		const streaming = JSON.parse(init.body).stream === true;
		if (new URL(target).pathname === "/v1/responses") {
			if (status === undefined) return streaming ? responsesStream() : { body: responsesAnswer };
			return { status, body: { detail: "nope" } };
		}
		return streaming ? chatStream() : { body: chatAnswer };
	});
const paths = (transport) => transport.calls.map((entry) => new URL(entry.url).pathname);
const upstream = (extra = {}) => ({ url, backend: "vllm", api: "auto", models: ["qwen"], ...extra });
const text = (reply) => reply.body.choices?.[0]?.message?.content;

describe('api: "auto" with a driver that declares the Responses API', () => {
	it("sends to /v1/responses and reports the protocol", async () => {
		const transport = server();
		const api = await make({ front: "openai", upstreams: [upstream()], transport, detect: false });
		expect(api.status().upstreams[0]).toMatchObject({ protocol: "openai.responses", responses: true });
		const reply = await api.send({ model: "qwen", messages: user });
		expect(text(reply)).toBe("from responses");
		expect(paths(transport)).toEqual(["/v1/responses"]);
		expect(api.status().upstreams[0]).toMatchObject({ protocol: "openai.responses", responses: true });
	});

	for (const code of [404, 405, 501]) {
		it(`falls back to Chat Completions on ${code}, once, and later requests go straight to Chat`, async () => {
			const transport = server(code);
			const api = await make({ front: "openai", upstreams: [upstream()], transport, detect: false });
			const events = [];
			api.events.on("fallback", (event) => events.push(event));
			expect(text(await api.send({ model: "qwen", messages: user }))).toBe("from chat");
			expect(paths(transport)).toEqual(["/v1/responses", "/v1/chat/completions"]);
			expect(text(await api.send({ model: "qwen", messages: user }))).toBe("from chat");
			expect(paths(transport)).toEqual(["/v1/responses", "/v1/chat/completions", "/v1/chat/completions"]);
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({ kind: "responses", action: "chat", status: code, endpoint: "upstream-0" });
			expect(api.status().upstreams[0]).toMatchObject({ protocol: "openai.chat", responses: false });
			expect(api.route({ model: "qwen", messages: user })).toMatchObject({ protocol: "openai.chat" });
		});

		it(`falls back on ${code} for a streamed request too`, async () => {
			const transport = server(code);
			const api = await make({ front: "openai", upstreams: [upstream()], transport, detect: false });
			for (let round = 0; round < 2; round++) {
				const reply = await api.send({ model: "qwen", stream: true, messages: user });
				const chunks = (await collect(reply.stream)).map((entry) => entry.data);
				expect(
					chunks
						.filter((chunk) => chunk.choices?.length)
						.map((chunk) => chunk.choices[0].delta.content)
						.join("")
				).toBe("from chat");
			}
			expect(paths(transport)).toEqual(["/v1/responses", "/v1/chat/completions", "/v1/chat/completions"]);
		});
	}

	it("falls back for the Anthropic front", async () => {
		const transport = server(404);
		const api = await make({
			front: "anthropic",
			upstreams: [upstream({ settings: { nativeMessages: false } })],
			transport,
			detect: false
		});
		const reply = await api.send({ model: "qwen", max_tokens: 8, messages: user });
		expect(reply.body.content[0].text).toBe("from chat");
		expect(paths(transport)).toEqual(["/v1/responses", "/v1/chat/completions"]);
	});

	it("reads a Responses reply that was already on its way when the upstream dropped to Chat", async () => {
		const api = await make({ front: "openai", upstreams: [upstream()], transport: server(404), detect: false });
		const sent = await api.request({ model: "qwen", messages: user });
		await api.send({ model: "qwen", messages: user });
		expect(api.status().upstreams[0].responses).toBe(false);
		expect(sent.state.responses).toBe(true);
		expect(text({ body: await api.response(responsesAnswer, sent.state) })).toBe("from responses");
	});

	for (const code of [400, 500]) {
		it(`does not fall back on ${code}`, async () => {
			const transport = server(code);
			const api = await make({ front: "openai", upstreams: [upstream()], transport, detect: false });
			const reply = await api.send({ model: "qwen", messages: user });
			expect(reply.status).toBe(code);
			await api.send({ model: "qwen", messages: user });
			expect(paths(transport)).toEqual(["/v1/responses", "/v1/responses"]);
			expect(api.status().upstreams[0]).toMatchObject({ protocol: "openai.responses", responses: true });
		});
	}

	it("a new detection forgets the fallback", async () => {
		const transport = server(404);
		const api = await make({ front: "openai", upstreams: [upstream()], transport, detect: false });
		await api.send({ model: "qwen", messages: user });
		expect(api.status().upstreams[0].responses).toBe(false);
		await api.detect({ network: false });
		expect(api.status().upstreams[0]).toMatchObject({ protocol: "openai.responses", responses: true });
	});

	it("api: responses and api: openai stay explicit, with no fallback", async () => {
		const transport = server(404);
		const api = await make({
			front: "openai",
			upstreams: [upstream({ name: "r", api: "responses", models: ["a"] }), upstream({ name: "o", api: "openai", models: ["b"] })],
			transport,
			detect: false
		});
		expect((await api.send({ model: "a", messages: user })).status).toBe(404);
		await api.send({ model: "b", messages: user });
		expect(paths(transport)).toEqual(["/v1/responses", "/v1/chat/completions"]);
		expect(api.status().upstreams.map((entry) => [entry.protocol, entry.responses])).toEqual([
			["openai.responses", true],
			["openai.chat", false]
		]);
	});

	it("a driver that only speaks the Responses API has nothing to fall back to", async () => {
		const transport = server(404);
		const api = await make({
			front: "openai",
			upstreams: [{ url: "http://declares.test", api: "auto", models: ["m"] }],
			detect: false,
			transport
		});
		await api.slothlet.api.add(
			["driver", "declares-responses"],
			new URL("../fixtures/driver/declares-responses", import.meta.url).pathname
		);
		await api.detect();
		transport.calls.length = 0;
		expect((await api.send({ model: "m", messages: user })).status).toBeGreaterThanOrEqual(400);
		expect(paths(transport)).toEqual(["/api/responses"]);
	});
});

describe('api: "auto" with a driver that does not declare the Responses API', () => {
	it("is Chat Completions, and never calls /v1/responses", async () => {
		const transport = server();
		const api = await make({ front: "openai", upstreams: [upstream({ backend: "deepseek" })], transport, detect: false });
		expect(api.status().upstreams[0]).toMatchObject({ protocol: "openai.chat", responses: false });
		expect(text(await api.send({ model: "qwen", messages: user }))).toBe("from chat");
		expect(paths(transport)).toEqual(["/v1/chat/completions"]);
	});
});

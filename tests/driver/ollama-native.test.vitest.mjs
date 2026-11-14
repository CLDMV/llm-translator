/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/driver/ollama-native.test.vitest.mjs
 *	@Date: 2026-11-13T11:00:00-08:00 (1794596400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-13T11:00:00-08:00 (1794596400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Ollama native `/api/chat` mode (`api: "native"`): request bodies for both fronts, replies, NDJSON streaming with split lines, generated tool-call ids, errors, usage and configuration.
 */
import { afterAll, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { readable, slices } from "../helpers/streams.mjs";

afterAll(closeAll);

const url = "http://ollama.test";
const user = [{ role: "user", content: "hi" }];
const tool = { name: "Read", description: "read", input_schema: { type: "object", properties: { path: { type: "string" } } } };
const reply = (message, extra = {}) => ({
	model: "qwen3",
	created_at: "2026-11-13T10:00:00Z",
	message: { role: "assistant", ...message },
	done: true,
	done_reason: "stop",
	prompt_eval_count: 11,
	eval_count: 5,
	...extra
});
const ndjson = (lines) => lines.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
// A text (one chunk) or a list of text slices (delivered as separate byte chunks, so a line can be split anywhere).
const raw = (text) => () =>
	new Response(typeof text === "string" ? text : readable(text.map((part) => new TextEncoder().encode(part))), {
		status: 200,
		headers: { "content-type": "application/x-ndjson" }
	});

// Composing a translator is slow, so each (front, transport) pair is made once and reused with a fresh handler.
const made = new Map();
const apiFor = (front, extra = {}) => {
	const key = `${front}|${JSON.stringify(extra)}`;
	if (!made.has(key)) {
		const handler = { current: () => ({ body: reply({ content: "hi" }) }) };
		const transport = fakeTransport((target, init) => handler.current(target, init));
		made.set(
			key,
			make({ front, upstreams: [{ url, backend: "ollama", api: "native", models: ["qwen3"], ...extra }], detect: false, transport }).then(
				(api) => ({
					api,
					transport,
					use(next) {
						handler.current = next;
						transport.calls.length = 0;
					}
				})
			)
		);
	}
	return made.get(key);
};

const streamLines = [
	{ model: "qwen3", message: { role: "assistant", content: "", thinking: "Let me " }, done: false },
	{ model: "qwen3", message: { role: "assistant", content: "", thinking: "look." }, done: false },
	{ model: "qwen3", message: { role: "assistant", content: "Sure, " }, done: false },
	{ model: "qwen3", message: { role: "assistant", content: "reading." }, done: false },
	{
		model: "qwen3",
		message: { role: "assistant", content: "", tool_calls: [{ function: { name: "Read", arguments: { path: "/a" } } }] },
		done: false
	},
	{ model: "qwen3", message: { role: "assistant", content: "" }, done: true, done_reason: "stop", prompt_eval_count: 11, eval_count: 5 }
];

describe("native mode selection", () => {
	it("binds the ollama driver to the ollama.chat protocol and calls /api/chat; models and embeddings stay on /v1", async () => {
		const { api, transport, use } = await apiFor("anthropic");
		use(() => ({ body: reply({ content: "ok" }) }));
		expect(api.status().upstreams[0]).toMatchObject({ driver: "ollama", protocol: "ollama.chat" });
		expect(api.route({ model: "qwen3", max_tokens: 8, messages: user })).toMatchObject({
			protocol: "ollama.chat",
			backend: "ollama",
			native: false
		});
		const sent = await api.request({ model: "qwen3", max_tokens: 8, messages: user });
		expect(sent.url).toBe("http://ollama.test/api/chat");
		expect(sent.path).toBe("/api/chat");
		use((target) =>
			target.endsWith("/v1/embeddings")
				? {
						body: {
							object: "list",
							data: [{ object: "embedding", index: 0, embedding: [0.1] }],
							model: "qwen3",
							usage: { prompt_tokens: 1, total_tokens: 1 }
						}
					}
				: { body: reply({ content: "ok" }) }
		);
		const vectors = await api.embeddings.send({ model: "qwen3", input: "x" });
		expect(vectors.status).toBe(200);
		expect(transport.calls.map((entry) => new URL(entry.url).pathname)).toEqual(["/v1/embeddings"]);
	});

	it("the default is still /v1, and api: openai says so", async () => {
		const transport = fakeTransport(() => ({ body: {} }));
		const plain = await make({ upstreams: [{ url, backend: "ollama" }], detect: false, transport });
		expect(plain.status().upstreams[0].protocol).toBe("openai.chat");
		const named = await make({ upstreams: [{ url, backend: "ollama", api: "openai" }], detect: false, transport });
		expect((await named.request({ model: "m", max_tokens: 4, messages: user })).url).toBe("http://ollama.test/v1/chat/completions");
	});

	it("rejects an api value that is not openai or native, and a driver without a native API", async () => {
		await expect(make({ upstreams: [{ url, api: "grpc" }], detect: false })).rejects.toMatchObject({ code: "INVALID_CONFIG" });
		await expect(make({ upstreams: [{ url, backend: "vllm", api: "native" }], detect: false })).rejects.toMatchObject({
			code: "unsupported_api",
			message: expect.stringContaining("(ollama)")
		});
	});

	it("an auto-detected Ollama server takes the mode too", async () => {
		const transport = fakeTransport((target) => {
			const path = new URL(target).pathname;
			if (path === "/api/version") return { body: { version: "0.13.0" } };
			if (path === "/v1/models") return { body: { object: "list", data: [{ id: "qwen3", object: "model" }] } };
			return { status: 404, body: { error: "nope" } };
		});
		const api = await make({ upstreams: [{ url, api: "native" }], transport });
		expect(api.status().upstreams[0]).toMatchObject({ driver: "ollama", protocol: "ollama.chat", models: ["qwen3"] });
	});
});

describe("Anthropic front: request", () => {
	it("converts messages, tools, sampling, think and structured output to Ollama's body", async () => {
		const { api, use } = await apiFor("anthropic");
		use(() => ({ body: reply({ content: "ok" }) }));
		const sent = await api.request({
			model: "qwen3",
			max_tokens: 256,
			temperature: 0.3,
			top_p: 0.9,
			top_k: 20,
			stop_sequences: ["END"],
			system: "be brief",
			thinking: { type: "enabled", budget_tokens: 1000 },
			tools: [tool],
			output_config: { format: { type: "json_schema", schema: { type: "object", properties: { a: { type: "string" } } } } },
			messages: [
				{
					role: "user",
					content: [
						{ type: "text", text: "read it" },
						{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }
					]
				},
				{
					role: "assistant",
					content: [
						{ type: "thinking", thinking: "need file", signature: "x" },
						{ type: "tool_use", id: "toolu_1", name: "Read", input: { path: "/a" } }
					]
				},
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "body" }] }
			]
		});
		expect(sent.headers.accept).toBe("application/json");
		expect(sent.body).toEqual({
			model: "qwen3",
			stream: false,
			messages: [
				{ role: "system", content: "be brief" },
				{ role: "user", content: "read it", images: ["AAAA"] },
				{
					role: "assistant",
					content: "",
					thinking: "need file",
					tool_calls: [{ type: "function", function: { name: "Read", arguments: { path: "/a" } } }]
				},
				{ role: "tool", tool_name: "Read", content: "body" }
			],
			tools: [{ type: "function", function: { name: "Read", description: "read", parameters: tool.input_schema } }],
			options: { temperature: 0.3, top_p: 0.9, top_k: 20, num_predict: 256, stop: ["END"] },
			format: { type: "object", properties: { a: { type: "string" } } },
			think: true
		});
	});

	it("an explicit effort becomes a think level and disabled thinking turns think off", async () => {
		const { api, use } = await apiFor("anthropic");
		use(() => ({ body: reply({ content: "ok" }) }));
		const ask = async (extra) => (await api.request({ model: "qwen3", max_tokens: 8, messages: user, ...extra })).body;
		expect((await ask({ thinking: { type: "adaptive" }, output_config: { effort: "high" } })).think).toBe("high");
		expect((await ask({ thinking: { type: "enabled", budget_tokens: 1024 }, output_config: { effort: "low" } })).think).toBe("low");
		expect((await ask({ thinking: { type: "disabled" } })).think).toBe(false);
		expect(await ask({})).not.toHaveProperty("think");
	});

	it("names what Ollama cannot take: a forced tool choice, and sends the sampling setting and metadata.sampling as options", async () => {
		const { api, use } = await apiFor("anthropic", { settings: { sampling: { repetition_penalty: 1.2, num_ctx: 8192 } } });
		use(() => ({ body: reply({ content: "ok" }) }));
		const events = [];
		const sent = await api.request({
			model: "qwen3",
			max_tokens: 8,
			messages: user,
			tools: [tool],
			tool_choice: { type: "any" },
			metadata: { sampling: { mirostat: 1, num_ctx: 16384 } }
		});
		expect(sent.body.options).toEqual({ repeat_penalty: 1.2, num_ctx: 16384, mirostat: 1, num_predict: 8 });
		expect(sent.body).not.toHaveProperty("tool_choice");
		expect(sent.state.convert.dropped).toContain("tool_choice");
		expect(events).toEqual([]);
		const quiet = await api.request({ model: "qwen3", max_tokens: 8, messages: user, metadata: { sampling: "bad" } });
		expect(quiet.body.options).toEqual({ repeat_penalty: 1.2, num_ctx: 8192, num_predict: 8 });
	});
});

describe("Anthropic front: non-streaming reply", () => {
	it("converts text, thinking, a tool call with a generated id and the evaluation counts", async () => {
		const { api, use } = await apiFor("anthropic");
		use(() => ({
			body: reply({ content: "Sure", thinking: "hm", tool_calls: [{ function: { name: "Read", arguments: { path: "/a" } } }] })
		}));
		const out = await api.send({ model: "qwen3", max_tokens: 64, tools: [tool], messages: user });
		expect(out.status).toBe(200);
		expect(out.body).toMatchObject({
			type: "message",
			model: "qwen3",
			stop_reason: "tool_use",
			usage: { input_tokens: 11, output_tokens: 5 }
		});
		expect(out.body.content.map((block) => block.type)).toEqual(["thinking", "text", "tool_use"]);
		expect(out.body.content[2]).toMatchObject({ name: "Read", input: { path: "/a" } });
		expect(out.body.content[2].id).toMatch(/^call_[0-9a-f]+$/);
		expect(await out.usage).toMatchObject({ input_tokens: 11, output_tokens: 5, reason: "done" });
	});

	it("an end_turn and a length stop", async () => {
		const { api, use } = await apiFor("anthropic");
		use(() => ({ body: reply({ content: "partial" }, { done_reason: "length" }) }));
		expect((await api.send({ model: "qwen3", max_tokens: 4, messages: user })).body.stop_reason).toBe("max_tokens");
		use(() => ({ body: reply({ content: "done" }) }));
		expect((await api.send({ model: "qwen3", max_tokens: 4, messages: user })).body.stop_reason).toBe("end_turn");
	});

	it("an Ollama error body becomes the client's error", async () => {
		const { api, use } = await apiFor("anthropic");
		use(() => ({ status: 404, body: { error: "model 'qwen3' not found" } }));
		const out = await api.send({ model: "qwen3", max_tokens: 4, messages: user });
		expect(out.status).toBe(404);
		expect(out.body).toMatchObject({ type: "error", error: { message: "model 'qwen3' not found" } });
	});
});

describe("Anthropic front: streaming", () => {
	const run = async (text) => {
		const { api, use } = await apiFor("anthropic");
		use(raw(text));
		const out = await api.send({ model: "qwen3", max_tokens: 64, stream: true, tools: [tool], messages: user });
		return { events: await collect(out.stream), out };
	};

	it("converts NDJSON lines, with thinking, text and a tool call, whole or split at any byte", async () => {
		const text = ndjson(streamLines);
		const whole = (await run(text)).events;
		for (const size of [1, 7, 33]) {
			const split = (await run(slices(text, size))).events;
			expect(split.map((event) => event.event)).toEqual(whole.map((event) => event.event));
			expect(split.filter((event) => event.event === "content_block_delta").map((event) => event.data.delta)).toEqual(
				whole.filter((event) => event.event === "content_block_delta").map((event) => event.data.delta)
			);
		}
		const names = whole.map((event) => event.event);
		expect(names[0]).toBe("message_start");
		expect(names.at(-1)).toBe("message_stop");
		const starts = whole.filter((event) => event.event === "content_block_start").map((event) => event.data.content_block);
		expect(starts.map((block) => block.type)).toEqual(["thinking", "text", "tool_use"]);
		expect(starts[2].id).toMatch(/^call_[0-9a-f]+$/);
		const deltas = whole.filter((event) => event.event === "content_block_delta").map((event) => event.data.delta);
		expect(
			deltas
				.filter((delta) => delta.type === "thinking_delta")
				.map((delta) => delta.thinking)
				.join("")
		).toBe("Let me look.");
		expect(
			deltas
				.filter((delta) => delta.type === "text_delta")
				.map((delta) => delta.text)
				.join("")
		).toBe("Sure, reading.");
		expect(deltas.find((delta) => delta.type === "input_json_delta").partial_json).toBe('{"path":"/a"}');
		expect(whole.find((event) => event.event === "message_delta").data).toMatchObject({
			delta: { stop_reason: "tool_use" },
			usage: { input_tokens: 11, output_tokens: 5 }
		});
	});

	it("an error line ends the stream with an error event, and so does a stream cut before its final line", async () => {
		const failed = (await run(ndjson([streamLines[2], { error: "llama runner process has terminated" }]))).events;
		expect(failed.at(-1)).toMatchObject({ event: "error", data: { error: { message: "llama runner process has terminated" } } });
		const cut = (await run(ndjson(streamLines.slice(0, 3)))).events;
		expect(cut.at(-1)).toMatchObject({ event: "error", data: { error: { message: "Upstream stream ended before completion" } } });
		const bad = (await run('{"message":{"content":"x"},"done":false}\nnot json\n')).events;
		expect(bad.at(-1)).toMatchObject({ event: "error" });
	});
});

describe("OpenAI front", () => {
	it("converts a Chat Completions request to Ollama's body, Ollama extension fields included", async () => {
		const { api, use } = await apiFor("openai");
		use(() => ({ body: reply({ content: "ok" }) }));
		const sent = await api.request({
			model: "qwen3",
			max_completion_tokens: 100,
			temperature: 0.4,
			seed: 3,
			stop: ["x"],
			reasoning_effort: "medium",
			response_format: { type: "json_object" },
			keep_alive: "30m",
			options: { num_ctx: 8192 },
			n: 2,
			tool_choice: "required",
			tools: [{ type: "function", function: { name: "Read", description: "r", parameters: { type: "object" } } }],
			messages: [
				{ role: "system", content: "s" },
				{
					role: "user",
					content: [
						{ type: "text", text: "see" },
						{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }
					]
				},
				{
					role: "assistant",
					content: null,
					tool_calls: [{ id: "call_1", type: "function", function: { name: "Read", arguments: '{"p":1}' } }]
				},
				{ role: "tool", tool_call_id: "call_1", content: "r" }
			]
		});
		expect(sent.body).toEqual({
			model: "qwen3",
			stream: false,
			messages: [
				{ role: "system", content: "s" },
				{ role: "user", content: "see", images: ["AAAA"] },
				{ role: "assistant", content: "", tool_calls: [{ type: "function", function: { name: "Read", arguments: { p: 1 } } }] },
				{ role: "tool", tool_name: "Read", content: "r" }
			],
			tools: [{ type: "function", function: { name: "Read", description: "r", parameters: { type: "object" } } }],
			options: { temperature: 0.4, seed: 3, num_predict: 100, stop: ["x"], num_ctx: 8192 },
			format: "json",
			think: "medium",
			keep_alive: "30m"
		});
		expect(sent.state.convert.dropped).toEqual(["tool_choice", "n"]);
	});

	it("a body without messages is an invalid request", async () => {
		const { api } = await apiFor("openai");
		await expect(api.request({ model: "qwen3" })).rejects.toMatchObject({ code: "invalid_request", param: "messages" });
		await expect(api.request({ model: "qwen3", messages: "x" })).rejects.toMatchObject({ code: "invalid_request" });
	});

	it("returns a chat.completion with the client's model, generated tool-call ids, thinking and usage", async () => {
		const { api, use } = await apiFor("openai");
		use(() => ({
			body: reply({
				content: "",
				thinking: "hm",
				tool_calls: [{ function: { name: "Read", arguments: { path: "/a" } } }, { function: { name: "Read", arguments: { path: "/b" } } }]
			})
		}));
		const out = await api.send({ model: "qwen3", messages: user });
		expect(out.status).toBe(200);
		const choice = out.body.choices[0];
		expect(out.body).toMatchObject({
			object: "chat.completion",
			model: "qwen3",
			usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 }
		});
		expect(choice).toMatchObject({ finish_reason: "tool_calls", message: { reasoning: "hm" } });
		const ids = choice.message.tool_calls.map((call) => call.id);
		expect(ids.every((id) => /^call_[0-9a-f]+$/.test(id))).toBe(true);
		expect(new Set(ids).size).toBe(2);
		expect(choice.message.tool_calls[1].function).toEqual({ name: "Read", arguments: '{"path":"/b"}' });
		expect(await out.usage).toMatchObject({ input_tokens: 11, output_tokens: 5 });
	});

	it("an error reply carried in a 200 body is an upstream error", async () => {
		const { api, use } = await apiFor("openai");
		use(() => ({ body: { error: "out of memory" } }));
		const out = await api.send({ model: "qwen3", messages: user });
		expect(out.status).toBe(502);
		expect(out.body.error.message).toBe("out of memory");
	});

	it("streams chunks with one id, a stable tool-call id and a final usage chunk when asked, whole or split", async () => {
		const { api, use } = await apiFor("openai");
		const text = ndjson(streamLines);
		const read = async (chunks, body = {}) => {
			use(raw(chunks));
			const out = await api.send({ model: "qwen3", stream: true, stream_options: { include_usage: true }, messages: user, ...body });
			return (await collect(out.stream)).map((event) => event.data);
		};
		const whole = await read(text);
		// Generated ids and timestamps differ from run to run; everything else must not depend on how the bytes were split.
		const shape = (list) => JSON.parse(JSON.stringify(list, (key, value) => (key === "id" ? "id" : key === "created" ? 0 : value)));
		for (const size of [1, 5, 50]) expect(shape(await read(slices(text, size)))).toEqual(shape(whole));
		expect(whole.at(-1)).toBe("[DONE]");
		const chunks = whole.filter((chunk) => chunk !== "[DONE]");
		expect(new Set(chunks.map((chunk) => chunk.id)).size).toBe(1);
		expect(chunks.every((chunk) => chunk.model === "qwen3")).toBe(true);
		expect(chunks[0].choices[0].delta).toEqual({ role: "assistant", content: "" });
		expect(
			chunks
				.filter((chunk) => chunk.choices[0]?.delta.reasoning)
				.map((chunk) => chunk.choices[0].delta.reasoning)
				.join("")
		).toBe("Let me look.");
		expect(
			chunks
				.filter((chunk) => chunk.choices[0]?.delta.content)
				.map((chunk) => chunk.choices[0].delta.content)
				.join("")
		).toBe("Sure, reading.");
		const calls = chunks.flatMap((chunk) => chunk.choices[0]?.delta.tool_calls ?? []);
		expect(calls).toEqual([
			{ index: 0, id: expect.stringMatching(/^call_[0-9a-f]+$/), type: "function", function: { name: "Read", arguments: '{"path":"/a"}' } }
		]);
		expect(chunks.find((chunk) => chunk.choices[0]?.finish_reason)?.choices[0].finish_reason).toBe("tool_calls");
		expect(chunks.at(-1)).toMatchObject({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 } });
	});

	it("without stream_options the usage chunk is not shown, and errors end the stream", async () => {
		const { api, use } = await apiFor("openai");
		use(raw(ndjson(streamLines)));
		const quiet = await api.send({ model: "qwen3", stream: true, messages: user });
		const data = (await collect(quiet.stream)).map((event) => event.data);
		expect(data.some((chunk) => chunk !== "[DONE]" && chunk.choices.length === 0)).toBe(false);

		const failures = [
			[ndjson([streamLines[2], { error: "runner stopped" }]), "runner stopped"],
			[ndjson(streamLines.slice(0, 2)), "Upstream stream ended before completion"],
			['{"done":false}\n{broken}\n', "Upstream sent a stream line that is not valid JSON"]
		];
		for (const [body, message] of failures) {
			use(raw(body));
			const out = await api.send({ model: "qwen3", stream: true, messages: user });
			const events = (await collect(out.stream)).map((event) => event.data);
			expect(events.at(-1)).toBe("[DONE]");
			expect(events.at(-2)).toMatchObject({ error: { message } });
		}
	});
});

describe("the ollama driver in native mode", () => {
	it("does not apply the /v1 normalizations, and warns about a prompt beyond the context window", async () => {
		const { api, use } = await apiFor("anthropic", { settings: { contextWindow: 20 } });
		use(() => ({ body: reply({ content: "ok" }) }));
		const warnings = [];
		const api2 = await make({
			upstreams: [{ url, backend: "ollama", api: "native", models: ["qwen3"], settings: { contextWindow: 20 } }],
			detect: false,
			logs: true,
			onEvent: (event) => warnings.push(event),
			transport: fakeTransport(() => ({ body: reply({ content: "ok" }) }))
		});
		await api2.request({ model: "qwen3", max_tokens: 8, messages: [{ role: "user", content: "x".repeat(400) }] });
		expect(warnings.some((event) => /truncates/.test(event.message ?? ""))).toBe(true);
		const { request } = api.driver.ollama;
		const body = { model: "m", messages: user, tool_choice: "required", n: 2, options: { num_ctx: 100000 } };
		expect(request(body, { endpoint: { protocol: "ollama.chat", name: "o" }, settings: { contextWindow: 20 } })).toBe(body);
		expect(request({ ...body, options: {} }, { endpoint: { protocol: "ollama.chat" }, settings: { contextWindow: 0 } }).tool_choice).toBe(
			"required"
		);
		expect(request({ model: "m", messages: user, tool_choice: "required" }, { endpoint: { protocol: "openai.chat" } })).not.toHaveProperty(
			"tool_choice"
		);
		expect(api.driver.ollama.info().native).toEqual({ protocol: "ollama.chat", paths: { chat: "/api/chat" } });
	});

	it("an image or tool retry is not attempted in native mode", async () => {
		const { api, use } = await apiFor("anthropic");
		use(() => ({ status: 400, body: { error: "this model does not support images" } }));
		const out = await api.send({ model: "qwen3", max_tokens: 4, messages: user });
		expect(out.status).toBe(400);
	});
});

describe("the OpenAI-side converters used on their own", () => {
	it("work without a conversion state: the model is the server's and the usage chunk is on", async () => {
		const { response } = await import("../../src/api/convert/ollama/chat/to/openai/chat/response.mjs");
		const { stream } = await import("../../src/api/convert/ollama/chat/to/openai/chat/stream.mjs");
		expect(response(reply({ content: "x" })).model).toBe("qwen3");
		const events = await collect(stream(ndjson(streamLines)));
		expect(events.at(-2).data).toMatchObject({ choices: [], usage: { total_tokens: 16 } });
		expect(events.at(-1).data).toBe("[DONE]");
		const failed = await collect(stream(ndjson([{ error: "x" }])));
		expect(failed[0].data.error.message).toBe("x");
		const broken = await collect(
			stream(
				(async function* () {
					yield "";
					throw new Error("socket closed");
				})()
			)
		);
		expect(broken[0].data.error).toMatchObject({ message: "socket closed", type: "api_error" });
		const cut = await collect(stream(ndjson(streamLines.slice(0, 2))));
		expect(cut.at(-2).data.error.message).toBe("Upstream stream ended before completion");
	});
});

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/driver/tgi.test.vitest.mjs
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
 * @fileoverview Hugging Face TGI driver: strict detection through `/info`, TGI's historic tool-call deviations in full responses and
 * streams, `eos_token` finish reasons, and the grammar shapes the chat endpoint takes.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { openaiSse } from "../helpers/streams.mjs";
import { isTgiInfo } from "../../src/lib/backends.mjs";
import { grammar } from "../../src/lib/tgi.mjs";

afterEach(closeAll);

const INFO = {
	model_id: "HuggingFaceH4/zephyr-7b-beta",
	model_sha: "abc",
	model_pipeline_tag: "text-generation",
	max_concurrent_requests: 128,
	max_best_of: 2,
	max_stop_sequences: 4,
	max_input_tokens: 1024,
	max_total_tokens: 2048,
	validation_workers: 2,
	max_client_batch_size: 4,
	router: "text-generation-router",
	version: "3.3.7",
	sha: null,
	docker_label: null
};
const server = (paths) =>
	fakeTransport((url) => {
		const path = new URL(url).pathname;
		return path in paths ? { body: paths[path] } : { status: 404, body: { error: "not found" } };
	});
const chatBody = (transport) => JSON.parse(transport.calls.find((call) => call.url.endsWith("/chat/completions")).init.body);
const schema = { type: "object", properties: { a: { type: "string" } }, required: ["a"] };
const messages = [{ role: "user", content: "hi" }];
const tools = [{ type: "function", function: { name: "f", parameters: {} } }];

describe("tgi detection", () => {
	it("is bound through /info, with the version, model and token limits as facts", async () => {
		const transport = server({
			"/info": INFO,
			"/v1/models": { object: "list", data: [{ id: INFO.model_id, object: "model", owned_by: INFO.model_id }] }
		});
		const api = await make({ upstreams: ["http://tgi.test"], transport });
		expect(api.status().upstreams[0]).toMatchObject({ driver: "tgi", protocol: "openai.chat" });
		expect(api.driver.tgi.info()).toMatchObject({ order: 45, probes: ["/info"], fields: ["grammar"] });
		expect(api.driver.tgi.settings()).toMatchObject({ maxTokensField: "max_tokens", topK: false, prefill: "none", responseFormat: true });
		expect(await api.driver.tgi.detect({ endpoint: { url: "http://tgi.test" }, transport })).toEqual({
			version: "3.3.7",
			model: "HuggingFaceH4/zephyr-7b-beta",
			maxInputTokens: 1024,
			maxTotalTokens: 2048
		});
	});

	it("wins over vLLM when the server also answers /version", async () => {
		const transport = server({ "/version": { version: "3.3.7" }, "/info": INFO });
		const api = await make({ upstreams: ["http://tgi.test"], transport });
		expect(api.status().upstreams[0].driver).toBe("tgi");
	});

	it("never binds another server: /info must be TGI's exactly", async () => {
		const embeddings = { ...INFO, router: "text-embeddings-router" };
		const other = await make({ upstreams: ["http://x.test"], transport: server({ "/info": embeddings }) });
		expect(other.status().upstreams[0].driver).toBe("compatible");
		const missing = await make({ upstreams: ["http://y.test"], transport: server({}) });
		expect(missing.status().upstreams[0].driver).toBe("compatible");
		const pinned = await make({ upstreams: [{ url: "http://z.test", backend: "compatible" }], transport: server({ "/info": INFO }) });
		expect(pinned.status().upstreams[0].driver).toBe("compatible");
	});

	it("isTgiInfo rejects partial shapes", () => {
		expect(isTgiInfo(INFO)).toBe(true);
		const older = { ...INFO };
		delete older.max_input_tokens;
		expect(isTgiInfo(older)).toBe(true);
		expect(isTgiInfo({})).toBe(false);
		expect(isTgiInfo({ ...INFO, router: "x" })).toBe(false);
		expect(isTgiInfo({ ...INFO, model_id: 1 })).toBe(false);
		expect(isTgiInfo({ ...INFO, version: undefined })).toBe(false);
		expect(isTgiInfo({ ...INFO, max_total_tokens: "2048" })).toBe(false);
	});
});

describe("tgi.request", () => {
	const request = async (body, ctx) => (await make({ upstreams: ["http://tgi.test"], detect: false })).driver.tgi.request(body, ctx);

	it("drops empty tool fields and leaves a plain request alone", async () => {
		expect(await request({ model: "tgi", messages, tools: [], tool_choice: "auto" })).toEqual({ model: "tgi", messages });
		expect(await request({ model: "tgi", messages, tools, tool_choice: "required" })).toEqual({
			model: "tgi",
			messages,
			tools,
			tool_choice: "required"
		});
	});

	it("rewrites an OpenAI json_schema into TGI's json_schema grammar", async () => {
		const out = await request({
			model: "tgi",
			messages,
			response_format: { type: "json_schema", json_schema: { name: "out", schema, strict: true } }
		});
		expect(out.response_format).toEqual({ type: "json_schema", value: { name: "out", schema } });
		const unnamed = await request({ model: "tgi", messages, response_format: { type: "json_schema", json_schema: { schema } } });
		expect(unnamed.response_format).toEqual({ type: "json_schema", value: { schema } });
	});

	it("maps the Anthropic structured output to TGI's grammar through the whole pipeline", async () => {
		const transport = fakeTransport(() => ({
			body: {
				id: "c",
				object: "chat.completion",
				model: "tgi",
				choices: [{ index: 0, message: { role: "assistant", content: "{}" }, finish_reason: "eos_token" }]
			}
		}));
		const api = await make({ upstreams: [{ url: "http://tgi.test", backend: "tgi" }], transport });
		const reply = await api.send({ model: "tgi", max_tokens: 16, output_config: { format: { type: "json_schema", schema } }, messages });
		expect(chatBody(transport).response_format).toEqual({ type: "json_schema", value: { name: "output", schema } });
		expect(reply.body.stop_reason).toBe("end_turn");
	});

	it("gives json_object a permissive schema, and passes TGI's own shapes through", async () => {
		expect((await request({ model: "tgi", messages, response_format: { type: "json_object" } })).response_format).toEqual({
			type: "json",
			value: { type: "object" }
		});
		const own = { type: "json_object", value: schema };
		expect((await request({ model: "tgi", messages, response_format: own })).response_format).toBe(own);
		const regex = { type: "regex", value: "a+" };
		expect((await request({ model: "tgi", messages, response_format: regex })).response_format).toBe(regex);
		expect(grammar("text")).toBe("text");
		expect(grammar({ type: "json_schema", value: { schema } })).toEqual({ type: "json_schema", value: { schema } });
		expect(grammar({ type: "json_schema" })).toEqual({ type: "json_schema" });
	});

	it("folds a client's grammar into response_format unless response_format is set", async () => {
		const out = await request({ model: "tgi", messages, grammar: { type: "json", value: schema } });
		expect(out).toEqual({ model: "tgi", messages, response_format: { type: "json", value: schema } });
		const both = await request({
			model: "tgi",
			messages,
			grammar: { type: "regex", value: "a" },
			response_format: { type: "json", value: schema }
		});
		expect(both).toEqual({ model: "tgi", messages, response_format: { type: "json", value: schema } });
	});

	it("keeps the tools and drops response_format, which TGI refuses together with them", async () => {
		const state = { dropped: [] };
		const out = await request({ model: "tgi", messages, tools, response_format: { type: "json_object" } }, { state });
		expect(out.response_format).toBeUndefined();
		expect(out.tools).toEqual(tools);
		expect(state.dropped).toEqual(["response_format"]);
		await request({ model: "tgi", messages, tools, response_format: { type: "json_object" } }, { state });
		expect(state.dropped).toEqual(["response_format"]);
		expect((await request({ model: "tgi", messages, tools, response_format: { type: "json_object" } })).response_format).toBeUndefined();
	});

	it("the OpenAI front's grammar field reaches TGI as response_format when the passthrough filter is on", async () => {
		const transport = fakeTransport(() => ({
			body: {
				id: "c",
				object: "chat.completion",
				model: "tgi",
				choices: [{ index: 0, message: { role: "assistant", content: "{}" }, finish_reason: "stop" }]
			}
		}));
		const api = await make({
			front: "openai",
			settings: { passthroughFilter: true },
			upstreams: [{ url: "http://tgi.test", backend: "tgi" }],
			transport
		});
		await api.send({ model: "tgi", messages, grammar: { type: "json", value: schema }, kv_transfer_params: {} });
		const sent = chatBody(transport);
		expect(sent.response_format).toEqual({ type: "json", value: schema });
		expect(sent.grammar).toBeUndefined();
		expect(sent.kv_transfer_params).toBeUndefined();
	});
});

describe("tgi.response: historic deviations", () => {
	const reply = (message, finish = "eos_token", extra = {}) => ({
		id: "",
		object: "text_completion",
		model: "tgi",
		choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: finish }],
		...extra
	});
	const normalize = async (body) => (await make({ upstreams: ["http://tgi.test"], detect: false })).driver.tgi.response(body);

	it("tool_calls as a single object becomes a list", async () => {
		const out = await normalize(reply({ tool_calls: { id: "0", type: "function", function: { name: "f", arguments: "{}" } } }));
		expect(out.choices[0].message.tool_calls).toEqual([{ id: "0", type: "function", function: { name: "f", arguments: "{}" } }]);
		expect(out.object).toBe("chat.completion");
	});

	it("numeric tool-call ids become strings, and a missing id is the position", async () => {
		const out = await normalize(
			reply({
				tool_calls: [
					{ id: 7, type: "function", function: { name: "a", arguments: "{}" } },
					{ type: "function", function: { name: "b", arguments: "{}" } },
					{ id: null, type: "function", function: { name: "c", arguments: "{}" } }
				]
			})
		);
		expect(out.choices[0].message.tool_calls.map((call) => call.id)).toEqual(["7", "1", "2"]);
	});

	it("object arguments, and TGI's older `parameters`, become a JSON string", async () => {
		const out = await normalize(
			reply({
				tool_calls: [
					{ id: 0, type: "function", function: { description: null, name: "a", arguments: { city: "Paris" } } },
					{ id: 1, function: { description: null, name: "b", parameters: { n: 1 } } },
					{ id: 2, function: { name: "c", arguments: '{"k":1}' } },
					{ id: 3, function: { name: "d" } }
				]
			})
		);
		const [a, b, c, d] = out.choices[0].message.tool_calls;
		expect(a.function.arguments).toBe('{"city":"Paris"}');
		expect(b).toEqual({ id: "1", type: "function", function: { description: null, name: "b", arguments: '{"n":1}' } });
		expect(c.function.arguments).toBe('{"k":1}');
		expect(d.function).toEqual({ name: "d" });
	});

	it("eos_token and stop_sequence finish reasons are a stop, or tool_calls when the answer holds calls", async () => {
		const call = { id: 0, type: "function", function: { name: "f", arguments: {} } };
		expect((await normalize(reply({ content: "hi" }, "eos_token"))).choices[0].finish_reason).toBe("stop");
		expect((await normalize(reply({ content: "hi" }, "stop_sequence"))).choices[0].finish_reason).toBe("stop");
		expect((await normalize(reply({ tool_calls: [call] }, "eos_token"))).choices[0].finish_reason).toBe("tool_calls");
		expect((await normalize(reply({ tool_calls: [call] }, "stop"))).choices[0].finish_reason).toBe("tool_calls");
		expect((await normalize(reply({ tool_calls: [] }, "stop"))).choices[0].finish_reason).toBe("stop");
		expect((await normalize(reply({ content: "hi" }, "length"))).choices[0].finish_reason).toBe("length");
		expect((await normalize(reply({ content: "hi" }, null))).choices[0].finish_reason).toBeNull();
	});

	it("passes a current-TGI reply, and bodies without choices, through", async () => {
		const current = {
			id: "",
			object: "chat.completion",
			model: "tgi",
			choices: [
				{
					index: 0,
					message: { role: "assistant", tool_calls: [{ id: "0", type: "function", function: { name: "f", arguments: '{"a":1}' } }] },
					finish_reason: "tool_calls"
				}
			]
		};
		expect(await normalize(current)).toEqual(current);
		expect(await normalize({ error: "x" })).toEqual({ error: "x" });
		expect(await normalize(undefined)).toBeUndefined();
		const odd = {
			object: "chat.completion",
			choices: [null, { index: 0, message: { role: "assistant", tool_calls: [null] }, finish_reason: "stop" }]
		};
		expect((await normalize(odd)).choices[0]).toBeNull();
		expect((await normalize(odd)).choices[1].message.tool_calls).toEqual([null]);
		expect(
			(await normalize({ choices: [{ index: 0, message: { tool_calls: [{ id: "1", function: "x" }] } }] })).choices[0].message.tool_calls[0]
				.function
		).toBe("x");
	});

	it("end to end: a historic tool call reaches an Anthropic client as a tool_use with an eos_token stop", async () => {
		const transport = fakeTransport(() => ({
			body: reply({ tool_calls: { id: 0, type: "function", function: { description: null, name: "Read", parameters: { path: "/a" } } } })
		}));
		const api = await make({ upstreams: [{ url: "http://tgi.test", backend: "tgi" }], transport });
		const out = await api.send({
			model: "tgi",
			max_tokens: 16,
			tools: [{ name: "Read", description: "read", input_schema: { type: "object", properties: { path: { type: "string" } } } }],
			messages
		});
		expect(out.body.stop_reason).toBe("tool_use");
		expect(out.body.content).toEqual([expect.objectContaining({ type: "tool_use", name: "Read", input: { path: "/a" } })]);
	});

	it("end to end: the OpenAI front gets a standard finish reason", async () => {
		const transport = fakeTransport(() => ({ body: reply({ content: "hello" }, "eos_token") }));
		const api = await make({ front: "openai", upstreams: [{ url: "http://tgi.test", backend: "tgi" }], transport });
		const out = await api.send({ model: "tgi", messages });
		expect(out.body.choices[0]).toMatchObject({ finish_reason: "stop", message: { content: "hello" } });
	});
});

describe("tgi.chunk: streamed deviations", () => {
	const base = { id: "", object: "chat.completion.chunk", model: "tgi" };
	const frame = (delta, finish = null) => ({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] });
	const run = async (frames, config = {}, request = {}) => {
		const transport = fakeTransport(
			() => new Response(openaiSse([...frames, "[DONE]"]), { status: 200, headers: { "content-type": "text/event-stream" } })
		);
		const api = await make({ upstreams: [{ url: "http://tgi.test", backend: "tgi" }], transport, ...config });
		const reply = await api.send({ model: "tgi", max_tokens: 32, stream: true, messages, ...request });
		return collect(reply.stream);
	};
	const read = { name: "Read", description: "read", input_schema: { type: "object", properties: { path: { type: "string" } } } };
	const frames = [
		frame({ role: "assistant", content: "" }),
		frame({ tool_calls: { index: 0, id: 0, type: "function", function: { name: "Read", arguments: { path: "/a" } } } }),
		frame({}, "eos_token")
	];

	it("an Anthropic client gets one tool_use block whose input is the object arguments, and a tool_use stop", async () => {
		const events = await run(frames, {}, { tools: [read] });
		expect(events.filter((event) => event.event === "content_block_start" && event.data.content_block.type === "tool_use")).toHaveLength(1);
		const json = events
			.filter((event) => event.data?.delta?.type === "input_json_delta")
			.map((event) => event.data.delta.partial_json)
			.join("");
		expect(JSON.parse(json)).toEqual({ path: "/a" });
		expect(events.find((event) => event.event === "message_delta").data.delta.stop_reason).toBe("tool_use");
	});

	it("fragments with an empty id continue the open call", async () => {
		const events = await run(
			[
				frame({ role: "assistant" }),
				frame({ tool_calls: [{ id: "0", type: "function", function: { name: "Read", arguments: "" } }] }),
				frame({ tool_calls: [{ id: "", type: "function", function: { arguments: '{"path":' } }] }),
				frame({ tool_calls: [{ function: { arguments: '"/a"}' } }] }),
				frame({}, "eos_token")
			],
			{},
			{ tools: [read] }
		);
		expect(events.filter((event) => event.event === "content_block_start" && event.data.content_block.type === "tool_use")).toHaveLength(1);
		const json = events
			.filter((event) => event.data?.delta?.type === "input_json_delta")
			.map((event) => event.data.delta.partial_json)
			.join("");
		expect(json).toBe('{"path":"/a"}');
	});

	it("an OpenAI client gets a list, string ids and arguments, and a tool_calls finish", async () => {
		const events = await run(frames, { front: "openai" });
		const deltas = events.map((event) => event.data?.choices?.[0]).filter(Boolean);
		const call = deltas.find((choice) => choice.delta?.tool_calls).delta.tool_calls;
		expect(call).toEqual([{ index: 0, id: "0", type: "function", function: { name: "Read", arguments: '{"path":"/a"}' } }]);
		expect(deltas.at(-1).finish_reason).toBe("tool_calls");
	});

	it("a text stream finishes with stop, and odd chunks pass through", async () => {
		const events = await run([frame({ role: "assistant", content: "hi" }), frame({}, "eos_token")], { front: "openai" });
		expect(events.map((event) => event.data?.choices?.[0]?.finish_reason).filter(Boolean)).toEqual(["stop"]);
		const { chunk } = (await make({ upstreams: ["http://tgi.test"], detect: false })).driver.tgi;
		expect(chunk(undefined)).toBeUndefined();
		expect(chunk({ ...base, choices: [] })).toEqual({ ...base, choices: [] });
		expect(chunk({ ...base, choices: [null] })).toEqual({ ...base, choices: [null] });
		const usage = { ...base, choices: [], usage: { prompt_tokens: 1 } };
		expect(chunk(usage, { state: {} })).toEqual(usage);
		expect(chunk(frame({ tool_calls: [{ id: "x" }] }, "stop"), { state: {} }).choices[0].finish_reason).toBe("tool_calls");
		expect(chunk(frame({ content: "a" }, "length")).choices[0].finish_reason).toBe("length");
		expect(chunk(frame({ content: "a" })).choices[0]).toEqual({ index: 0, delta: { content: "a" }, finish_reason: null });
		const bare = chunk({ ...base, choices: [{ index: 0, delta: { content: "a" } }] });
		expect(bare.choices[0]).toEqual({ index: 0, delta: { content: "a" } });
	});
});

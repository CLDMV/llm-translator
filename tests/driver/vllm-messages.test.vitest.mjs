/**
 * @fileoverview vLLM's native `/v1/messages`: the `nativeMessages` setting, version detection, normalisation, the requests that are converted anyway and the 404 fallback.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { anthropicSse, asyncOf } from "../helpers/streams.mjs";
import * as vllm from "../../src/lib/vllm.mjs";
import { resolve } from "../../src/lib/settings.mjs";

afterEach(closeAll);

const url = "http://gpu.test:8000";
const user = [{ role: "user", content: "hi" }];
const answer = {
	id: "msg_1",
	type: "message",
	role: "assistant",
	model: "qwen",
	content: [{ type: "text", text: "ok" }],
	stop_reason: "end_turn",
	stop_sequence: null,
	usage: { input_tokens: 3, output_tokens: 2 }
};
const chatAnswer = {
	id: "c",
	object: "chat.completion",
	model: "qwen",
	choices: [{ index: 0, message: { role: "assistant", content: "chat" }, finish_reason: "stop" }],
	usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
};
const settings = (extra) => resolve(extra);

/** A vLLM upstream with a known version, on `nativeMessages: "auto"` unless the test says otherwise. */
const upstream = (extra = {}) => ({
	url,
	backend: "vllm",
	version: "0.12.0",
	models: ["qwen"],
	settings: { nativeMessages: "auto" },
	...extra
});

/** Serves `/v1/messages` and `/v1/chat/completions` and records which was called. */
const server = (messages = () => ({ body: answer })) =>
	fakeTransport((u, init) => {
		if (u.endsWith("/v1/messages")) return messages(JSON.parse(init.body), init);
		return { body: chatAnswer };
	});
const paths = (transport) => transport.calls.map((call) => new URL(call.url).pathname);
const sseResponse = (events) => new Response(anthropicSse(events), { status: 200, headers: { "content-type": "text/event-stream" } });

describe("nativeMessages setting", () => {
	it("defaults to false and accepts true, false and auto", () => {
		expect(settings().nativeMessages).toBe(false);
		for (const value of [true, false, "auto"]) expect(settings({ nativeMessages: value }).nativeMessages).toBe(value);
		expect(() => settings({ nativeMessages: "yes" })).toThrow(/Invalid setting nativeMessages/);
		expect(() => settings({ nativeMessages: 1 })).toThrow(/expected true, false or "auto"/);
	});
});

describe("vllm.wants", () => {
	const vllmEndpoint = (version, facts) => ({ driver: "vllm", version, facts });
	it("is off for another driver and for false", () => {
		expect(vllm.wants({ driver: "openai" }, settings({ nativeMessages: true }))).toBe(false);
		expect(vllm.wants(vllmEndpoint("0.12.0"), settings())).toBe(false);
	});
	it("true always uses it, even without a version", () => {
		expect(vllm.wants(vllmEndpoint(undefined), settings({ nativeMessages: true }))).toBe(true);
	});
	it("auto needs a known version of 0.11.1 or later, from detection or from the config", () => {
		const auto = settings({ nativeMessages: "auto" });
		expect(vllm.wants(vllmEndpoint(undefined), auto)).toBe(false);
		expect(vllm.wants(vllmEndpoint(undefined, { version: "0.11.0" }), auto)).toBe(false);
		expect(vllm.wants(vllmEndpoint(undefined, { version: "0.11.1" }), auto)).toBe(true);
		expect(vllm.wants(vllmEndpoint("0.20.1rc1"), auto)).toBe(true);
		expect(vllm.wants(vllmEndpoint("0.10.2"), auto)).toBe(false);
	});
});

describe("vllm.unsuited", () => {
	const s = settings();
	const tool = { type: "tool_result", tool_use_id: "t", content: [{ type: "text", text: "x" }] };
	it("accepts an ordinary request, whatever the shape of the lists", () => {
		expect(vllm.unsuited({ messages: [...user, { role: "assistant", content: "a" }, { role: "user", content: [tool] }] }, s)).toBeNull();
		expect(vllm.unsuited({ messages: user, tools: [{ name: "a", input_schema: {} }] }, s)).toBeNull();
		expect(vllm.unsuited({}, s)).toBeNull();
		expect(
			vllm.unsuited({ messages: [null, { role: "user" }, { role: "user", content: [null, { type: "tool_result", tool_use_id: "t" }] }] }, s)
		).toBeNull();
	});
	it("a trailing assistant message is a prefill", () => {
		expect(vllm.unsuited({ messages: [...user, { role: "assistant", content: "{" }] }, s)).toBe("prefill");
	});
	it("document blocks, also inside a tool result", () => {
		const doc = { type: "document", source: { type: "text", data: "x" } };
		expect(vllm.unsuited({ messages: [{ role: "user", content: [doc] }] }, s)).toBe("document");
		expect(vllm.unsuited({ messages: [{ role: "user", content: [{ ...tool, content: [doc] }] }] }, s)).toBe("document");
	});
	it("deferred tools and tool changes, unless toolSearch is native", () => {
		const deferred = { messages: user, tools: [{ name: "a", input_schema: {}, defer_loading: true }] };
		expect(vllm.unsuited(deferred, s)).toBe("toolsearch");
		expect(vllm.unsuited(deferred, settings({ toolSearch: "native" }))).toBeNull();
		for (const type of ["tool_reference", "tool_addition", "tool_removal"]) {
			expect(vllm.unsuited({ messages: [{ role: "user", content: [{ type }] }] }, s)).toBe("toolsearch");
		}
	});
});

describe("vllm.request", () => {
	it("joins the system blocks with a blank line and drops the billing header", () => {
		const out = vllm.request(
			{
				model: "m",
				system: [
					{ type: "text", text: "x-anthropic-billing-header: cc_version=1; cch=abc;", cache_control: { type: "ephemeral" } },
					{ type: "text", text: "one" },
					{ type: "image" },
					{ type: "text", text: "two" }
				],
				messages: user
			},
			settings()
		);
		expect(out.system).toBe("one\n\ntwo");
		expect(out.messages).toBe(user);
	});
	it("keeps the billing header when stripBillingHeader is off, and takes a string system", () => {
		const s = settings({ stripBillingHeader: false });
		expect(vllm.request({ system: [{ type: "text", text: "x-anthropic-billing-header: a" }] }, s).system).toBe(
			"x-anthropic-billing-header: a"
		);
		expect(vllm.request({ system: "plain" }, settings()).system).toBe("plain");
	});
	it("leaves out a system prompt that is only the billing header, and keeps a missing one missing", () => {
		expect(vllm.request({ system: [{ type: "text", text: "x-anthropic-billing-header: a" }] }, settings())).not.toHaveProperty("system");
		expect("system" in vllm.request({ model: "m" }, settings())).toBe(false);
		expect(vllm.request({ system: null }, settings()).system).toBeNull();
	});
	it("marks failed tool results only with toolErrors on", () => {
		const messages = [
			{ role: "user", content: "text" },
			{
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "a", is_error: true, content: "boom" },
					{ type: "tool_result", tool_use_id: "b", is_error: true, content: [{ type: "text", text: "x" }] },
					{ type: "tool_result", tool_use_id: "c", is_error: true },
					{ type: "tool_result", tool_use_id: "d", content: "fine" },
					{ type: "text", text: "t" }
				]
			}
		];
		expect(vllm.request({ messages }, settings()).messages).toBe(messages);
		const out = vllm.request({ messages }, settings({ toolErrors: true })).messages;
		expect(out[0]).toBe(messages[0]);
		expect(out[1].content).toEqual([
			{ type: "tool_result", tool_use_id: "a", is_error: true, content: "[error] boom" },
			{
				type: "tool_result",
				tool_use_id: "b",
				is_error: true,
				content: [
					{ type: "text", text: "[error]" },
					{ type: "text", text: "x" }
				]
			},
			{ type: "tool_result", tool_use_id: "c", is_error: true, content: "[error]" },
			{ type: "tool_result", tool_use_id: "d", content: "fine" },
			{ type: "text", text: "t" }
		]);
		expect(vllm.request({ model: "m" }, settings({ toolErrors: true }))).toEqual({ model: "m" });
	});
});

describe("vllm.response and vllm.stream", () => {
	it("signs a thinking block that has no signature", () => {
		const out = vllm.response({
			content: [
				{ type: "thinking", thinking: "a" },
				{ type: "thinking", thinking: "b", signature: "real" },
				{ type: "text", text: "t" }
			]
		});
		expect(out.content[0].signature).toMatch(/^llmt:/);
		expect(out.content[1].signature).toBe("real");
		expect(out.content[2]).toEqual({ type: "text", text: "t" });
		expect(vllm.response({ type: "error" })).toEqual({ type: "error" });
	});
	it("adds a ping after message_start and a signature to a thinking block without one", async () => {
		const events = [
			{ event: "message_start", data: { type: "message_start", message: {} } },
			{ event: "content_block_start", data: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } } },
			{ event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
			{
				event: "content_block_start",
				data: { type: "content_block_start", index: 1, content_block: { type: "thinking", thinking: "", signature: "" } }
			},
			{ event: "content_block_stop", data: { type: "content_block_stop", index: 1 } },
			{ event: "content_block_start", data: { type: "content_block_start", index: 2, content_block: { type: "thinking", thinking: "" } } },
			{ event: "content_block_delta", data: { type: "content_block_delta", index: 2, delta: { type: "signature_delta", signature: "s" } } },
			{ event: "content_block_stop", data: { type: "content_block_stop", index: 2 } },
			{ event: "content_block_start", data: { type: "content_block_start", index: 3, content_block: { type: "text", text: "" } } },
			{ event: "content_block_stop", data: { type: "content_block_stop", index: 3 } },
			{ data: "[x]" },
			{ event: "message_stop", data: { type: "message_stop" } }
		];
		const out = await collect(vllm.stream(asyncOf(events)));
		expect(out.map((e) => e.data?.type ?? e.data)).toEqual([
			"message_start",
			"ping",
			"content_block_start",
			"content_block_delta",
			"content_block_stop",
			"content_block_start",
			"content_block_stop",
			"content_block_start",
			"content_block_delta",
			"content_block_stop",
			"content_block_start",
			"content_block_stop",
			"[x]",
			"message_stop"
		]);
		expect(out[3].data).toMatchObject({ index: 0, delta: { type: "signature_delta", signature: expect.stringMatching(/^llmt:/) } });
	});
});

describe("choosing the native endpoint", () => {
	it("is off by default: the request is converted", async () => {
		const transport = server();
		const api = await make({ upstreams: [{ ...upstream(), settings: {} }], transport, detect: false });
		const sent = await api.request({ model: "qwen", max_tokens: 8, messages: user });
		expect(sent.path).toBe("/v1/chat/completions");
		expect(sent.state).toMatchObject({ native: false, messages: false });
		expect(api.status().upstreams[0].messages).toBe(false);
	});

	it("auto on a version that has it sends the Anthropic body to /v1/messages with bearer auth only", async () => {
		const api = await make({ upstreams: [upstream({ apiKey: "k" })], transport: server(), detect: false });
		const sent = await api.request(
			{ model: "qwen", max_tokens: 8, system: [{ type: "text", text: "s" }], messages: user, metadata: { sampling: { min_p: 0.1 } } },
			{ clientHeaders: { "anthropic-beta": "x", "x-api-key": "client" } }
		);
		expect(sent.path).toBe("/v1/messages");
		expect(sent.state).toMatchObject({ native: true, messages: true, front: "anthropic" });
		expect(sent.body).toEqual({ model: "qwen", max_tokens: 8, system: "s", messages: user, metadata: {} });
		expect(sent.headers.authorization).toBe("Bearer k");
		expect(sent.headers["anthropic-beta"]).toBeUndefined();
		expect(sent.headers["x-api-key"]).toBeUndefined();
		expect(api.route({ model: "qwen", messages: user })).toMatchObject({ native: true, protocol: "openai.chat", backend: "vllm" });
		expect(api.status().upstreams[0]).toMatchObject({ messages: true, protocol: "openai.chat" });
	});

	it("auto on an older or unknown version converts; true uses it regardless", async () => {
		for (const version of ["0.10.2", undefined]) {
			const api = await make({ upstreams: [upstream({ version })], transport: server(), detect: false });
			expect((await api.request({ model: "qwen", max_tokens: 8, messages: user })).path).toBe("/v1/chat/completions");
		}
		const forced = await make({
			upstreams: [upstream({ version: "0.10.2", settings: { nativeMessages: true } })],
			transport: server(),
			detect: false
		});
		expect((await forced.request({ model: "qwen", max_tokens: 8, messages: user })).path).toBe("/v1/messages");
	});

	it("the global setting applies too, and other drivers ignore it", async () => {
		const api = await make({
			upstreams: [
				{ url, backend: "vllm", version: "0.13.0", models: ["qwen"] },
				{ url: "http://o.test", backend: "openai", models: ["gpt"] }
			],
			settings: { nativeMessages: true },
			transport: server(),
			detect: false
		});
		expect((await api.request({ model: "qwen", max_tokens: 8, messages: user })).path).toBe("/v1/messages");
		expect((await api.request({ model: "gpt", max_tokens: 8, messages: user })).path).toBe("/v1/chat/completions");
		expect(api.status().upstreams.map((entry) => entry.messages)).toEqual([true, null]);
	});

	it("the OpenAI front is unaffected", async () => {
		const transport = server();
		const api = await make({ upstreams: [upstream()], transport, detect: false, front: "openai" });
		const sent = await api.request({ model: "qwen", max_tokens: 8, messages: user });
		expect(sent.path).toBe("/v1/chat/completions");
		expect(sent.state.native).toBe(true);
		expect(sent.state.messages).toBe(false);
		const reply = await api.send({ model: "qwen", max_tokens: 8, messages: user });
		expect(reply.body.choices[0].message.content).toBe("chat");
		expect(paths(transport)).toEqual(["/v1/chat/completions"]);
	});

	it("a request the endpoint cannot take is converted, and says why through nothing but the path", async () => {
		const api = await make({ upstreams: [upstream()], transport: server(), detect: false });
		const prefill = { model: "qwen", max_tokens: 8, messages: [...user, { role: "assistant", content: "{" }] };
		expect((await api.request(prefill)).path).toBe("/v1/chat/completions");
		const deferred = {
			model: "qwen",
			max_tokens: 8,
			messages: user,
			tools: [{ name: "a", input_schema: { type: "object" }, defer_loading: true }]
		};
		expect((await api.request(deferred)).path).toBe("/v1/chat/completions");
		expect((await api.request({ model: "qwen", max_tokens: 8, messages: user })).path).toBe("/v1/messages");
	});
});

describe("round trips through the native endpoint", () => {
	it("returns the reply with the client's model name", async () => {
		const transport = server((body) => ({
			body: {
				...answer,
				model: body.model,
				content: [
					{ type: "thinking", thinking: "t" },
					{ type: "text", text: "ok" }
				]
			}
		}));
		const api = await make({ upstreams: [upstream({ models: ["real"] })], aliases: { mine: "real" }, transport, detect: false });
		const reply = await api.send({ model: "mine", max_tokens: 8, messages: user });
		expect(reply.status).toBe(200);
		expect(reply.body.model).toBe("mine");
		expect(reply.body.content[0].signature).toMatch(/^llmt:/);
		expect(reply.body.usage).toEqual({ input_tokens: 3, output_tokens: 2 });
		expect(paths(transport)).toEqual(["/v1/messages"]);
		expect(JSON.parse(transport.calls[0].init.body).model).toBe("real");
	});

	it("streams the events with a ping after message_start", async () => {
		const transport = server(() =>
			sseResponse([
				{ data: { type: "message_start", message: { ...answer, content: [] } } },
				{ data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
				{ data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } } },
				{ data: { type: "content_block_stop", index: 0 } },
				{ data: { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } } },
				{ data: { type: "message_stop" } }
			])
		);
		const api = await make({ upstreams: [upstream()], transport, detect: false });
		const reply = await api.send({ model: "qwen", max_tokens: 8, stream: true, messages: user });
		const events = await collect(reply.stream);
		expect(events.map((event) => event.data.type)).toEqual([
			"message_start",
			"ping",
			"content_block_start",
			"content_block_delta",
			"content_block_stop",
			"message_delta",
			"message_stop"
		]);
		expect(events[0].data.message.model).toBe("qwen");
		expect(await reply.usage).toMatchObject({ input_tokens: 3, output_tokens: 2, complete: true });
	});

	it("renders an Anthropic-shaped error from the endpoint, a 404 for an unknown model included, and does not fall back", async () => {
		const transport = server(() => ({
			status: 404,
			body: { type: "error", error: { type: "not_found_error", message: "The model `x` does not exist." } }
		}));
		const api = await make({ upstreams: [upstream()], transport, detect: false });
		const reply = await api.send({ model: "qwen", max_tokens: 8, messages: user });
		expect(reply.status).toBe(404);
		expect(reply.body).toEqual({ type: "error", error: { type: "not_found_error", message: "The model `x` does not exist." } });
		expect(paths(transport)).toEqual(["/v1/messages"]);
		expect(api.status().upstreams[0].messages).toBe(true);
		await api.send({ model: "qwen", max_tokens: 8, messages: user });
		expect(paths(transport)).toEqual(["/v1/messages", "/v1/messages"]);
	});

	it("renders a validation error of the endpoint", async () => {
		const transport = server(() => ({ status: 422, body: { detail: [{ msg: "Field required" }] } }));
		const api = await make({ upstreams: [upstream()], transport, detect: false });
		const reply = await api.send({ model: "qwen", max_tokens: 8, messages: user });
		expect(reply.status).toBe(422);
		expect(reply.body.error.message).toBe("Field required");
	});
});

describe("fallback to conversion on 404", () => {
	const missing = () => ({ status: 404, body: { detail: "Not Found" } });

	it("converts the request, remembers it for the upstream and says so once", async () => {
		const transport = server(missing);
		const api = await make({ upstreams: [upstream()], transport, detect: false });
		const events = [];
		api.events.on("fallback", (event) => events.push(event));
		const first = await api.send({ model: "qwen", max_tokens: 8, messages: user });
		expect(first.status).toBe(200);
		expect(first.body.content[0].text).toBe("chat");
		expect(paths(transport)).toEqual(["/v1/messages", "/v1/chat/completions"]);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ kind: "messages", action: "conversion", status: 404, endpoint: "upstream-0" });
		await api.send({ model: "qwen", max_tokens: 8, messages: user });
		expect(paths(transport)).toEqual(["/v1/messages", "/v1/chat/completions", "/v1/chat/completions"]);
		expect(events).toHaveLength(1);
		expect(api.status().upstreams[0].messages).toBe(false);
		expect(api.route({ model: "qwen", messages: user }).native).toBe(false);
	});

	it("a new detection forgets it", async () => {
		const transport = server(missing);
		const api = await make({ upstreams: [upstream()], transport, detect: false });
		await api.send({ model: "qwen", max_tokens: 8, messages: user });
		expect(api.status().upstreams[0].messages).toBe(false);
		await api.detect({ network: false });
		expect(api.status().upstreams[0].messages).toBe(true);
	});

	it("also converts a streamed request", async () => {
		const transport = fakeTransport((u) =>
			u.endsWith("/v1/messages")
				? missing()
				: new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } })
		);
		const api = await make({ upstreams: [upstream()], transport, detect: false });
		const reply = await api.send({ model: "qwen", max_tokens: 8, stream: true, messages: user });
		expect(reply.status).toBe(200);
		await collect(reply.stream);
		expect(paths(transport)).toEqual(["/v1/messages", "/v1/chat/completions"]);
	});
});

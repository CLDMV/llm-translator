/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/protocol.test.vitest.mjs
 *	@Date: 2026-11-18T09:00:00-08:00 (1795021200)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-18T09:00:00-08:00 (1795021200)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * @fileoverview `api: "auto"` for the Responses API: a driver that declares it is asked on `/v1/responses` first, a 404, 405 or 501 drops
/**
 * @fileoverview The per-upstream `api` setting: accepted names, what each driver speaks, the protocol a request picks under `auto` for each client
 * protocol, the fallback to the next one (remembered per upstream), explicit values that never fall back, the deprecated `nativeMessages`
 * setting and the protocol-dependent `reasoningRoundTrip`. Every upstream is a mocked transport.
 */
import { afterAll, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { ALIASES, CHAT, MESSAGES, OLLAMA, RESPONSES, candidates, canonical, frontOf, supported } from "../../src/lib/protocol.mjs";

afterAll(closeAll);

const url = "http://box:8000";
const user = [{ role: "user", content: "hi" }];
const anthropicBody = { model: "qwen", max_tokens: 8, messages: user };
const chatBody = { model: "qwen", messages: user };

const messagesAnswer = {
	id: "m",
	type: "message",
	role: "assistant",
	model: "qwen",
	content: [{ type: "text", text: "from messages" }],
	stop_reason: "end_turn",
	stop_sequence: null,
	usage: { input_tokens: 3, output_tokens: 2 }
};
const chatAnswer = {
	id: "c",
	object: "chat.completion",
	model: "qwen",
	choices: [{ index: 0, message: { role: "assistant", content: "from chat" }, finish_reason: "stop" }],
	usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
};
const responsesAnswer = {
	id: "r",
	object: "response",
	created_at: 1700000000,
	status: "completed",
	model: "qwen",
	output: [
		{
			type: "message",
			id: "i",
			role: "assistant",
			status: "completed",
			content: [{ type: "output_text", text: "from responses", annotations: [] }]
		}
	],
	usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 }
};
const sse = (frames) => new Response(frames, { status: 200, headers: { "content-type": "text/event-stream" } });
const messagesStream = () =>
	sse(
		[
			[
				"message_start",
				{ type: "message_start", message: { ...messagesAnswer, content: [], usage: { input_tokens: 3, output_tokens: 0 } } }
			],
			["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
			["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "from messages" } }],
			["content_block_stop", { type: "content_block_stop", index: 0 }],
			["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } }],
			["message_stop", { type: "message_stop" }]
		]
			.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
			.join("")
	);
const chatStream = () =>
	sse(
		[
			{
				id: "c",
				object: "chat.completion.chunk",
				model: "qwen",
				choices: [{ index: 0, delta: { role: "assistant", content: "from chat" } }]
			},
			{ id: "c", object: "chat.completion.chunk", model: "qwen", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
			"[DONE]"
		]
			.map((chunk) => `data: ${typeof chunk === "string" ? chunk : JSON.stringify(chunk)}\n\n`)
			.join("")
	);

/**
 * A server with the three routes; `missing` lists the ones that answer `status` (404 in vLLM's FastAPI shape by default).
 * @param {Record<string, number>} [missing] - Path to status.
 * @returns {any} Transport.
 */
const server = (missing = {}) =>
	fakeTransport((target, init) => {
		const path = new URL(target).pathname;
		if (path in missing) return { status: missing[path], body: { detail: "Not Found" } };
		const streaming = JSON.parse(init.body).stream === true;
		if (path === "/v1/messages") return streaming ? messagesStream() : { body: messagesAnswer };
		if (path === "/v1/responses") return { body: responsesAnswer };
		return streaming ? chatStream() : { body: chatAnswer };
	});
const paths = (transport) => transport.calls.map((entry) => new URL(entry.url).pathname);
const vllm = (extra = {}) => ({ url, backend: "vllm", version: "0.12.0", models: ["qwen"], ...extra });
const build = (upstream, extra = {}, transport = server()) =>
	make({ front: "anthropic", upstreams: [upstream], transport, detect: false, ...extra }).then((api) => ({ api, transport }));
const asResponses = { front: "openai", wire: "responses" };
const asChat = { front: "openai" };
const reasoningWarning = /no reasoning to send back/;

describe("lib/protocol", () => {
	it("maps every accepted name to a canonical id, case-insensitively, and nothing else", () => {
		expect(Object.keys(ALIASES).sort()).toEqual(
			[
				MESSAGES,
				"messages",
				"anthropic",
				"claude",
				CHAT,
				"chat",
				"openai",
				"chatgpt",
				RESPONSES,
				"responses",
				"codex",
				OLLAMA,
				"native",
				"ollama",
				"auto"
			].sort()
		);
		const expected = {
			messages: MESSAGES,
			anthropic: MESSAGES,
			claude: MESSAGES,
			chat: CHAT,
			openai: CHAT,
			chatgpt: CHAT,
			responses: RESPONSES,
			codex: RESPONSES,
			native: OLLAMA,
			ollama: OLLAMA,
			auto: "auto"
		};
		for (const [name, id] of Object.entries(expected)) {
			expect(canonical(name)).toBe(id);
			expect(canonical(name.toUpperCase())).toBe(id);
		}
		for (const id of [MESSAGES, CHAT, RESPONSES, OLLAMA]) expect(canonical(id)).toBe(id);
		for (const bad of ["grpc", "", "toString", 3, null, undefined, {}]) expect(canonical(bad)).toBeUndefined();
	});

	it("reads the protocols of a driver, also from the older flags", () => {
		expect(supported({ protocol: CHAT, protocols: [MESSAGES, CHAT, CHAT] })).toEqual([MESSAGES, CHAT]);
		expect(supported({ protocol: CHAT, responses: true, native: { protocol: OLLAMA } })).toEqual([CHAT, RESPONSES, OLLAMA]);
		expect(supported({ protocols: [CHAT] })).toEqual([CHAT]);
		expect(supported({})).toEqual([]);
	});

	it("names the protocol of each client", () => {
		expect(frontOf("anthropic")).toBe(MESSAGES);
		expect(frontOf("anthropic", "responses")).toBe(MESSAGES);
		expect(frontOf("openai")).toBe(CHAT);
		expect(frontOf("openai", "responses")).toBe(RESPONSES);
	});

	it("orders the candidates: the client's protocol, Chat Completions, then the driver's own", () => {
		const info = { protocol: CHAT, protocols: [MESSAGES, CHAT, RESPONSES] };
		expect(candidates({ api: "auto", front: MESSAGES, info })).toEqual([MESSAGES, CHAT]);
		expect(candidates({ api: "auto", front: CHAT, info })).toEqual([CHAT]);
		expect(candidates({ api: "auto", front: RESPONSES, info })).toEqual([RESPONSES, CHAT]);
		expect(candidates({ api: "auto", front: RESPONSES, info, missing: new Set([RESPONSES]) })).toEqual([CHAT]);
		expect(candidates({ api: "auto", front: MESSAGES, info, usable: (protocol) => protocol !== MESSAGES })).toEqual([CHAT]);
		expect(candidates({ api: "auto", front: CHAT, info: { protocol: MESSAGES } })).toEqual([MESSAGES]);
		expect(candidates({ api: RESPONSES, front: MESSAGES, info, missing: new Set([RESPONSES]) })).toEqual([RESPONSES]);
		expect(candidates({ api: MESSAGES, front: CHAT, info, usable: () => false })).toEqual([CHAT]);
	});
});

describe("the api setting", () => {
	it("defaults to auto", async () => {
		const { api } = await build(vllm());
		expect(api.status().upstreams[0]).toMatchObject({ api: "auto", protocols: [MESSAGES, CHAT, RESPONSES] });
	});

	it("accepts every canonical id and alias, and stores the canonical one", async () => {
		for (const [name, id] of Object.entries(ALIASES)) {
			const backend = id === OLLAMA ? "ollama" : "vllm";
			const { api } = await build({ url, backend, models: ["qwen"], api: name });
			expect(api.status().upstreams[0].api, name).toBe(id);
		}
		const { api } = await build(vllm({ api: "Codex" }));
		expect(api.status().upstreams[0].api).toBe(RESPONSES);
	});

	it("rejects anything else with the accepted values listed", async () => {
		for (const bad of ["grpc", 4, true, null]) {
			await expect(build(vllm({ api: bad }))).rejects.toMatchObject({
				code: "INVALID_CONFIG",
				message: expect.stringMatching(/upstreams\[0\]\.api must be one of "auto".*"anthropic\.messages".*"codex"/)
			});
		}
	});

	it("fails detection with unsupported_api when the driver's server does not speak it", async () => {
		await expect(build({ url, backend: "deepseek", api: "responses" })).rejects.toMatchObject({
			code: "unsupported_api",
			message: expect.stringContaining("speaks openai.chat")
		});
		await expect(build({ url, backend: "anthropic", api: "chat" })).rejects.toMatchObject({ code: "unsupported_api" });
		await expect(build({ url, backend: "vllm", api: "ollama" })).rejects.toMatchObject({ code: "unsupported_api" });
	});

	it("every driver declares what its server speaks", async () => {
		const { api } = await build(vllm());
		const speaks = Object.fromEntries(Object.keys(api.driver).map((name) => [name, api.driver[name].info?.().protocols]));
		expect(speaks.vllm).toEqual([MESSAGES, CHAT, RESPONSES]);
		expect(speaks.ollama).toEqual([CHAT, RESPONSES, OLLAMA]);
		expect(speaks.anthropic).toEqual([MESSAGES]);
		for (const name of ["openai", "compatible", "lmstudio", "llamacpp", "sglang", "localai"])
			expect(speaks[name], name).toEqual([CHAT, RESPONSES]);
		for (const name of ["azure", "groq", "fireworks", "xai", "openrouter", "deepseek", "gemini", "mistral", "tgi", "together"]) {
			expect(speaks[name], name).toEqual([CHAT]);
		}
	});
});

describe("auto: the protocol each client gets", () => {
	it("an Anthropic client goes to a vLLM that has /v1/messages, a Chat Completions client to chat, a Responses client to Responses", async () => {
		const { api, transport } = await build(vllm());
		expect((await api.send(anthropicBody)).body.content[0].text).toBe("from messages");
		expect((await api.send(chatBody, asChat)).body.choices[0].message.content).toBe("from chat");
		expect((await api.send(chatBody, asResponses)).body.choices[0].message.content).toBe("from responses");
		expect(paths(transport)).toEqual(["/v1/messages", "/v1/chat/completions", "/v1/responses"]);
		expect(api.route(anthropicBody).protocol).toBe(MESSAGES);
		expect(api.route(chatBody, asChat).protocol).toBe(CHAT);
		expect(api.route(chatBody, asResponses).protocol).toBe(RESPONSES);
		expect(api.status().upstreams[0]).toMatchObject({ protocol: MESSAGES, messages: true, responses: false });
	});

	it("an Anthropic client streams over /v1/messages, and a vLLM before 0.11.1 or of unknown version gets Chat Completions", async () => {
		const { api, transport } = await build(vllm());
		const reply = await api.send({ ...anthropicBody, stream: true });
		expect((await collect(reply.stream)).map((event) => event.event)).toContain("message_stop");
		expect(paths(transport)).toEqual(["/v1/messages"]);
		for (const version of ["0.10.2", undefined]) {
			const old = await build(vllm({ version }));
			expect((await old.api.send(anthropicBody)).body.content[0].text).toBe("from chat");
			expect(paths(old.transport)).toEqual(["/v1/chat/completions"]);
		}
	});

	it("an Anthropic client goes over Chat Completions to a server that has no Messages route of its own", async () => {
		for (const backend of ["openai", "ollama", "groq", "deepseek"]) {
			const { api, transport } = await build({ url, backend, models: ["qwen"] });
			expect((await api.send(anthropicBody)).body.content[0].text, backend).toBe("from chat");
			expect(paths(transport).map((path) => path.replace("/openai", ""))).toEqual(["/v1/chat/completions"]);
		}
	});

	it("the Anthropic driver stays on Messages, for every client", async () => {
		const transport = server();
		const { api } = await build({ url: "https://api.anthropic.com", backend: "anthropic", apiKey: "k", models: ["qwen"] }, {}, transport);
		expect((await api.send(anthropicBody)).body.content[0].text).toBe("from messages");
		expect((await api.send(chatBody, asChat)).body.choices[0].message.content).toBe("from messages");
		expect((await api.send(chatBody, asResponses)).body.choices[0].message.content).toBe("from messages");
		expect(paths(transport)).toEqual(["/v1/messages", "/v1/messages", "/v1/messages"]);
	});

	it("a body /v1/messages cannot take is converted for that request only", async () => {
		const { api, transport } = await build(vllm());
		await api.send({ ...anthropicBody, messages: [...user, { role: "assistant", content: "{" }] });
		await api.send(anthropicBody);
		expect(paths(transport)).toEqual(["/v1/chat/completions", "/v1/messages"]);
	});

	it("a count goes through Chat Completions messages even where the request would go to /v1/messages", async () => {
		const { api, transport } = await build(vllm());
		const counted = await api.token.count(anthropicBody);
		expect(counted.input_tokens).toBeGreaterThan(0);
		expect(paths(transport).every((path) => path !== "/v1/messages")).toBe(true);
	});
});

describe("auto: falling back to the next protocol", () => {
	it("remembers a missing /v1/messages, once, and keeps the other protocols as they were", async () => {
		const transport = server({ "/v1/messages": 404 });
		const { api } = await build(vllm(), {}, transport);
		const events = [];
		api.events.on("fallback", (event) => events.push(event));
		expect((await api.send(anthropicBody)).body.content[0].text).toBe("from chat");
		expect((await api.send(anthropicBody)).body.content[0].text).toBe("from chat");
		expect(paths(transport)).toEqual(["/v1/messages", "/v1/chat/completions", "/v1/chat/completions"]);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ kind: "messages", action: "conversion", status: 404 });
		expect(events[0].message).toContain('Set api on this upstream (for example "chat")');
		// The other clients still get theirs.
		expect((await api.send(chatBody, asResponses)).body.choices[0].message.content).toBe("from responses");
		expect(api.status().upstreams[0]).toMatchObject({ protocol: CHAT, messages: false });
	});

	it("remembers a missing Responses API for a Responses client only, whatever the status (404, 405, 501)", async () => {
		for (const status of [404, 405, 501]) {
			const transport = server({ "/v1/responses": status });
			const { api } = await build(vllm(), {}, transport);
			expect((await api.send(chatBody, asResponses)).body.choices[0].message.content).toBe("from chat");
			expect((await api.send(chatBody, asResponses)).body.choices[0].message.content).toBe("from chat");
			expect(paths(transport)).toEqual(["/v1/responses", "/v1/chat/completions", "/v1/chat/completions"]);
			expect((await api.send(anthropicBody)).body.content[0].text).toBe("from messages");
			expect(api.route(chatBody, asResponses).protocol).toBe(CHAT);
		}
	});

	it("falls back for a streamed request of each client", async () => {
		const transport = server({ "/v1/messages": 404, "/v1/responses": 404 });
		const { api } = await build(vllm(), {}, transport);
		const anthropic = await api.send({ ...anthropicBody, stream: true });
		expect((await collect(anthropic.stream)).map((event) => event.event)).toContain("message_stop");
		const responses = await api.send({ ...chatBody, stream: true }, asResponses);
		const chunks = (await collect(responses.stream)).map((entry) => entry.data).filter((chunk) => chunk.choices?.length);
		expect(chunks.map((chunk) => chunk.choices[0].delta.content).join("")).toBe("from chat");
		expect(paths(transport).filter((path) => path !== "/tokenize")).toEqual([
			"/v1/messages",
			"/v1/chat/completions",
			"/v1/responses",
			"/v1/chat/completions"
		]);
	});

	it("does not call an Anthropic-shaped 404, another status or a Chat Completions error a missing route", async () => {
		const shaped = fakeTransport(() => ({ status: 404, body: { type: "error", error: { type: "not_found_error", message: "no model" } } }));
		const a = await build(vllm(), {}, shaped);
		expect((await a.api.send(anthropicBody)).status).toBe(404);
		expect(paths(shaped)).toEqual(["/v1/messages"]);
		const other = server({ "/v1/messages": 500, "/v1/chat/completions": 404 });
		const b = await build(vllm(), {}, other);
		expect((await b.api.send(anthropicBody)).status).toBe(500);
		expect((await b.api.send(chatBody, asChat)).status).toBe(404);
		expect(paths(other)).toEqual(["/v1/messages", "/v1/chat/completions"]);
	});

	it("never marks the Anthropic driver's own Messages route missing: it has nothing to fall back to", async () => {
		const transport = fakeTransport(() => ({ status: 404, body: { detail: "Not Found" } }));
		const { api } = await build({ url: "https://api.anthropic.com", backend: "anthropic", apiKey: "k" }, {}, transport);
		expect((await api.send(anthropicBody)).status).toBe(404);
		expect(paths(transport)).toEqual(["/v1/messages"]);
	});

	it("a new detection forgets what was missing", async () => {
		const { api } = await build(vllm(), {}, server({ "/v1/messages": 404, "/v1/responses": 404 }));
		await api.send(anthropicBody);
		await api.send(chatBody, asResponses);
		expect(api.route(anthropicBody).protocol).toBe(CHAT);
		expect(api.route(chatBody, asResponses).protocol).toBe(CHAT);
		await api.detect({ network: false });
		expect(api.route(anthropicBody).protocol).toBe(MESSAGES);
		expect(api.route(chatBody, asResponses).protocol).toBe(RESPONSES);
	});

	it("reads a reply that was already on its way when the upstream moved on", async () => {
		const { api } = await build(vllm(), {}, server({ "/v1/messages": 404 }));
		const sent = await api.request(anthropicBody);
		await api.send(anthropicBody);
		expect(sent.state.protocol).toBe(MESSAGES);
		expect((await api.response(messagesAnswer, sent.state)).content[0].text).toBe("from messages");
	});
});

describe("an explicit api", () => {
	it("is that protocol for every client, and never falls back", async () => {
		for (const [api, path, clients] of [
			["messages", "/v1/messages", [anthropicBody]],
			["responses", "/v1/responses", [chatBody]],
			["chat", "/v1/chat/completions", [anthropicBody, chatBody]]
		]) {
			const transport = server({ [path]: 404 });
			const built = await build(vllm({ api }), {}, transport);
			for (const body of clients) {
				const reply = await built.api.send(body, body === chatBody ? asResponses : undefined);
				expect(reply.status, `${api}`).toBe(404);
			}
			expect(
				paths(transport).every((called) => called === path),
				api
			).toBe(true);
			expect(built.api.status().upstreams[0].api).toBe(canonical(api));
		}
	});

	it("api: messages on vLLM is for Anthropic clients; the other clients go over Chat Completions", async () => {
		const { api, transport } = await build(vllm({ api: "messages", version: "0.10.2" }));
		await api.send(anthropicBody);
		await api.send(chatBody, asChat);
		await api.send(chatBody, asResponses);
		expect(paths(transport)).toEqual(["/v1/messages", "/v1/chat/completions", "/v1/chat/completions"]);
	});

	it("api: chat sends an Anthropic client to Chat Completions on a vLLM that has /v1/messages", async () => {
		const { api, transport } = await build(vllm({ api: "chat" }));
		await api.send(anthropicBody);
		expect(paths(transport)).toEqual(["/v1/chat/completions"]);
	});

	it("api: responses sends an Anthropic client through the Responses API", async () => {
		const { api, transport } = await build(vllm({ api: "codex" }));
		expect((await api.send(anthropicBody)).body.content[0].text).toBe("from responses");
		expect(paths(transport)).toEqual(["/v1/responses"]);
	});
});

describe("nativeMessages (deprecated)", () => {
	const watch = async (upstream, extra = {}) => {
		const events = [];
		const built = await build(upstream, { onEvent: (event) => events.push(event), ...extra });
		return { ...built, deprecations: events.filter((event) => event.kind === "deprecated") };
	};

	it("reads true as api: anthropic.messages, auto as auto and false as api: openai.chat, and warns", async () => {
		for (const [value, id, path] of [
			[true, MESSAGES, "/v1/messages"],
			["auto", "auto", "/v1/chat/completions"],
			[false, CHAT, "/v1/chat/completions"]
		]) {
			const { api, transport, deprecations } = await watch(vllm({ version: undefined, settings: { nativeMessages: value } }));
			expect(api.status().upstreams[0].api).toBe(id);
			expect(deprecations).toHaveLength(1);
			expect(deprecations[0]).toMatchObject({
				type: "detect",
				kind: "deprecated",
				level: "warn",
				endpoint: "upstream-0",
				setting: "nativeMessages"
			});
			expect(deprecations[0].message).toContain(`api: "${id}"`);
			await api.send(anthropicBody);
			expect(paths(transport)).toEqual([path]);
		}
	});

	it("reads the global setting too, and leaves other drivers alone", async () => {
		const { api, deprecations } = await watch({ url, backend: "openai", models: ["qwen"] }, { settings: { nativeMessages: true } });
		expect(deprecations).toHaveLength(0);
		expect(api.status().upstreams[0].api).toBe("auto");
		const vllmApi = await watch(vllm(), { settings: { nativeMessages: false } });
		expect(vllmApi.api.status().upstreams[0].api).toBe(CHAT);
		expect(vllmApi.deprecations).toHaveLength(1);
	});

	it("is ignored, with a warning, when api is set too", async () => {
		const { api, deprecations } = await watch(vllm({ api: "responses", settings: { nativeMessages: true } }));
		expect(api.status().upstreams[0].api).toBe(RESPONSES);
		expect(deprecations).toHaveLength(1);
		expect(deprecations[0].message).toContain("ignored");
	});

	it("false leaves a Responses client on Chat Completions", async () => {
		const { api, transport } = await build(vllm({ settings: { nativeMessages: false } }));
		await api.send(chatBody, asResponses);
		expect(paths(transport)).toEqual(["/v1/chat/completions"]);
	});
});

describe("reasoningRoundTrip follows the protocol", () => {
	const turn = [
		{ role: "user", content: "go" },
		{ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: {} }] },
		{ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "x" }] }
	];
	const tool = { name: "Read", description: "read", input_schema: { type: "object", properties: {} } };
	const ask = { model: "qwen", max_tokens: 8, tools: [tool], messages: turn };

	it("is on for the Responses API and off for Chat Completions, unless a setting says otherwise", async () => {
		const warnings = [];
		const events = { logs: false, onEvent: (event) => event.type === "warning" && warnings.push(event.message) };
		const chat = await build(vllm({ version: undefined }), events);
		await chat.api.send(ask);
		expect(warnings.filter((message) => reasoningWarning.test(message))).toHaveLength(0);
		const forced = await build(vllm({ version: undefined, settings: { reasoningRoundTrip: true } }), events);
		await forced.api.send(ask);
		expect(warnings.filter((message) => reasoningWarning.test(message))).toHaveLength(1);
		const responses = await build(vllm({ api: "responses" }));
		expect((await responses.api.request(ask)).body.include).toEqual(["reasoning.encrypted_content"]);
		const off = await build(vllm({ api: "responses", settings: { reasoningRoundTrip: false } }));
		expect((await off.api.request(ask)).body.include).toBeUndefined();
	});

	it("is off again once an auto upstream has moved from the Responses API to Chat Completions", async () => {
		const { api } = await build(vllm(), {}, server({ "/v1/responses": 404 }));
		const first = await api.request(chatBody, asResponses);
		expect(first.state.protocol).toBe(RESPONSES);
		await api.send(chatBody, asResponses);
		const next = await api.request(chatBody, asResponses);
		expect(next.state.protocol).toBe(CHAT);
		expect(next.body.include).toBeUndefined();
	});
});

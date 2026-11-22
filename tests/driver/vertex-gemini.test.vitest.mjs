/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/driver/vertex-gemini.test.vitest.mjs
 *	@Date: 2026-11-22T10:00:00-08:00 (1795370400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T10:00:00-08:00 (1795370400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Vertex AI driver on Google-published models: the Gemini protocol chosen by the model id, the publisher path, Google authentication, both fronts, streaming, token counting and errors, all against a local stand-in for Google. Nothing here reaches the internet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeAll, collect, make } from "../helpers/translator.mjs";
import { fakeGoogle } from "../helpers/google.mjs";
import { content } from "../helpers/gemini.mjs";
import * as google from "../../src/lib/google-auth.mjs";
import { gemini as isGemini, geminiCache, geminiRoute } from "../../src/lib/vertex.mjs";

const servers = [];
const start = async (options) => {
	const server = await fakeGoogle(options);
	servers.push(server);
	return server;
};
beforeEach(() => google.reset());
afterEach(async () => {
	vi.unstubAllEnvs();
	await closeAll();
	while (servers.length > 0) await servers.pop().close();
});

const MODEL = "gemini-2.5-flash";
const BASE = "/v1/projects/proj/locations/us-east5/publishers/google/models";
const user = [{ role: "user", content: "hi" }];
const reply = (res, status, body) => {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
};
const sse = (res, frames) => {
	res.writeHead(200, { "content-type": "text/event-stream" });
	for (const frame of frames) res.write(`data: ${JSON.stringify(frame)}\n\n`);
	res.end();
};
const upstream = (server, vertex = {}, extra = {}) => ({
	url: server.url,
	backend: "vertex",
	vertex: { project: "proj", region: "us-east5", accessToken: "tok", ...vertex },
	...extra
});
const vertexCalls = (server) => server.requests.filter((entry) => entry.method === "POST" && entry.url !== "/token");
const ok = (frame) => (_req, _body, res) => reply(res, 200, frame);

describe("model publisher selection", () => {
	it("recognizes Gemini model ids, with or without a prefix, and routes them to the Google publisher", () => {
		for (const id of ["gemini-2.5-flash", "models/gemini-2.5-flash", "publishers/google/models/gemini-3-pro-preview"]) {
			expect(isGemini(id), id).toBe(true);
		}
		for (const id of ["claude-sonnet-4-5@20250929", "gemma-3", "my-tuned", undefined]) expect(isGemini(id), String(id)).toBe(false);
		const endpoint = { name: "v", url: "https://x", vertex: { project: "p q", region: "global" } };
		expect(geminiRoute(endpoint, "publishers/google/models/gemini-2.5-flash")).toBe(
			"/v1/projects/p%20q/locations/global/publishers/google/models/gemini-2.5-flash:generateContent"
		);
		expect(geminiRoute(endpoint, "models/gemini-x", { stream: true })).toBe(
			"/v1/projects/p%20q/locations/global/publishers/google/models/gemini-x:streamGenerateContent?alt=sse"
		);
		expect(geminiRoute(endpoint, "gemini-x", { count: true })).toMatch(/gemini-x:countTokens$/);
	});

	it("under api auto a Gemini model goes through generateContent and Claude through rawPredict, and an explicit api wins", async () => {
		const server = await start();
		const api = await make({ front: "openai", upstreams: [upstream(server)], detect: false });
		expect(api.status().upstreams[0]).toMatchObject({ driver: "vertex", protocols: ["anthropic.messages", "google.gemini"] });
		const gem = await api.request({ model: MODEL, messages: user });
		expect(gem.path).toBe(`${BASE}/${MODEL}:generateContent`);
		expect(gem.state.protocol).toBe("google.gemini");
		const claude = await api.request({ model: "claude-sonnet-4-5@20250929", messages: user, max_tokens: 5 });
		expect(claude.path).toBe("/v1/projects/proj/locations/us-east5/publishers/anthropic/models/claude-sonnet-4-5@20250929:rawPredict");
		const forced = await make({ front: "openai", upstreams: [upstream(server, {}, { api: "gemini" })], detect: false });
		expect((await forced.request({ model: "my-tuned", messages: user })).path).toBe(`${BASE}/my-tuned:generateContent`);
		const messages = await make({ front: "openai", upstreams: [upstream(server, {}, { api: "messages" })], detect: false });
		expect((await messages.request({ model: MODEL, messages: user, max_tokens: 5 })).path).toBe(
			`/v1/projects/proj/locations/us-east5/publishers/anthropic/models/${MODEL}:rawPredict`
		);
	});

	it("takes the region from the host, uses the global host for global, and names a missing project before anything is sent", async () => {
		const server = await start();
		const global = await make({
			front: "openai",
			upstreams: [{ url: server.url, backend: "vertex", vertex: { project: "proj", region: "global", accessToken: "tok" } }],
			detect: false
		});
		expect((await global.request({ model: MODEL, messages: user })).path).toBe(
			`/v1/projects/proj/locations/global/publishers/google/models/${MODEL}:generateContent`
		);
		vi.stubEnv("GOOGLE_CLOUD_PROJECT", "");
		vi.stubEnv("ANTHROPIC_VERTEX_PROJECT_ID", "");
		vi.stubEnv("GCLOUD_PROJECT", "");
		const bare = await make({
			front: "openai",
			upstreams: [{ url: server.url, backend: "vertex", vertex: { region: "us-east5", accessToken: "tok" } }],
			detect: false
		});
		await expect(bare.request({ model: MODEL, messages: user })).rejects.toThrow(/no Google Cloud project/);
		expect(vertexCalls(server)).toEqual([]);
	});
});

describe("round trips", () => {
	it("OpenAI front: a body with no model, stream or version, a bearer token, and the reply converted", async () => {
		const server = await start({ vertex: ok(content([{ text: "Hello from Vertex" }])) });
		const api = await make({ front: "openai", upstreams: [upstream(server)], detect: false });
		const out = await api.send({ model: MODEL, max_tokens: 20, messages: [{ role: "system", content: "be brief" }, ...user] });
		const [call] = vertexCalls(server);
		expect(call.url).toBe(`${BASE}/${MODEL}:generateContent`);
		expect(call.headers.authorization).toBe("Bearer tok");
		expect(call.headers["x-goog-api-key"]).toBeUndefined();
		expect(call.body).toEqual({
			contents: [{ role: "user", parts: [{ text: "hi" }] }],
			systemInstruction: { parts: [{ text: "be brief" }] },
			generationConfig: { maxOutputTokens: 20 }
		});
		expect(out.body).toMatchObject({ object: "chat.completion", model: MODEL, choices: [{ message: { content: "Hello from Vertex" } }] });
		expect(out.body.usage).toMatchObject({ prompt_tokens: 12, completion_tokens: 5 });
	});

	it("Anthropic front: tools, thinking with its signature, and a streamed reply", async () => {
		const tool = { name: "Read", input_schema: { type: "object", properties: { path: { type: "string" } } } };
		const server = await start({
			vertex: (req, _body, res) =>
				req.url.includes("streamGenerateContent")
					? sse(res, [
							content([{ text: "think", thought: true }], { finishReason: undefined }, null),
							content(
								[{ functionCall: { id: "f1", name: "Read", args: { path: "a" } }, thoughtSignature: "SIG" }],
								{},
								{ promptTokenCount: 4, candidatesTokenCount: 3 }
							)
						])
					: reply(res, 200, content([{ functionCall: { id: "f1", name: "Read", args: { path: "a" } }, thoughtSignature: "SIG" }]))
		});
		const api = await make({ front: "anthropic", upstreams: [upstream(server)], detect: false });
		const out = await api.send({ model: MODEL, max_tokens: 64, tools: [tool], messages: user });
		expect(out.body.content.at(-1)).toEqual({ type: "tool_use", id: "f1", name: "Read", input: { path: "a" } });
		expect(out.body.content[0].signature).toMatch(/^llmt:/);
		const streamed = await api.send({ model: MODEL, max_tokens: 64, stream: true, tools: [tool], messages: user });
		const events = await collect(streamed.stream);
		expect(events.find((entry) => entry.event === "message_delta").data.delta.stop_reason).toBe("tool_use");
		const calls = vertexCalls(server);
		expect(calls[1].url).toBe(`${BASE}/${MODEL}:streamGenerateContent?alt=sse`);
		expect(calls[1].headers.accept).toBe("text/event-stream");
	});

	it("sends the signature back, and a Google error comes back in the client's shape", async () => {
		const server = await start({ vertex: ok(content([{ text: "x" }])) });
		const api = await make({ front: "openai", upstreams: [upstream(server)], detect: false });
		const assistant = {
			role: "assistant",
			content: "",
			tool_calls: [{ id: "f1", type: "function", function: { name: "Read", arguments: "{}" } }],
			reasoning_details: [{ type: "reasoning.encrypted", format: "google-gemini-v1", index: 0, data: "SIG", for: "call", id: "f1" }]
		};
		await api.send({
			model: MODEL,
			tools: [{ type: "function", function: { name: "Read" } }],
			messages: [...user, assistant, { role: "tool", tool_call_id: "f1", content: "a" }]
		});
		expect(vertexCalls(server)[0].body.contents[1].parts[0]).toMatchObject({ thoughtSignature: "SIG" });
		const denied = await start({
			vertex: (_req, _body, res) => reply(res, 403, { error: { code: 403, message: "Permission denied", status: "PERMISSION_DENIED" } })
		});
		const failing = await make({ front: "openai", upstreams: [upstream(denied)], detect: false });
		const out = await failing.send({ model: MODEL, messages: user });
		expect(out.status).toBe(403);
		expect(out.body.error).toMatchObject({ message: "Permission denied", code: "PERMISSION_DENIED" });
	});
});

describe("token counting", () => {
	const ask = { model: MODEL, max_tokens: 8, system: "be brief", messages: [{ role: "user", content: "x".repeat(400) }] };

	it("uses the publisher's countTokens with the prompt as contents, and only the fields it takes", async () => {
		const server = await start({ vertex: ok({ totalTokens: 77, totalBillableCharacters: 400 }) });
		const api = await make({ front: "anthropic", upstreams: [upstream(server)], detect: false });
		expect(await api.token.count(ask)).toEqual({ input_tokens: 77 });
		const [call] = vertexCalls(server);
		expect(call.url).toBe(`${BASE}/${MODEL}:countTokens`);
		expect(call.headers.authorization).toBe("Bearer tok");
		expect(Object.keys(call.body).sort()).toEqual(["contents", "systemInstruction"]);
	});

	it("falls back to the estimate when it fails, and sends tools when there are some", async () => {
		const server = await start();
		const api = await make({ front: "anthropic", upstreams: [upstream(server)], detect: false });
		expect((await api.token.count(ask)).input_tokens).toBeGreaterThan(90);
		const odd = await start({ vertex: ok({ totalTokens: "many" }) });
		const second = await make({ front: "anthropic", upstreams: [upstream(odd)], detect: false });
		const tool = { name: "Read", input_schema: { type: "object", properties: { p: { type: "string" } } } };
		expect((await second.token.count({ ...ask, tools: [tool] })).input_tokens).toBeGreaterThan(90);
		expect(vertexCalls(odd)[0].body.tools[0].functionDeclarations[0].name).toBe("Read");
		const down = await make({ front: "anthropic", upstreams: [{ ...upstream(odd), url: "http://127.0.0.1:1" }], detect: false });
		expect((await down.token.count(ask)).input_tokens).toBeGreaterThan(90);
	});

	it("the usage report counts a reply with no usage through countTokens", async () => {
		const server = await start({
			vertex: (req, _body, res) =>
				req.url.endsWith(":countTokens") ? reply(res, 200, { totalTokens: 33 }) : reply(res, 200, content([{ text: "x" }], {}, null))
		});
		const api = await make({ front: "openai", upstreams: [upstream(server)], detect: false });
		const out = await api.send({ model: MODEL, messages: user });
		expect(await out.usage).toMatchObject({ reported: false, estimated: { input_tokens: 33 } });
	});
});

describe("driver leaves", () => {
	it("request(): a Gemini body loses model and stream and gets no version, a Messages body keeps the old shape", async () => {
		const server = await start();
		const api = await make({ front: "openai", upstreams: [upstream(server)], detect: false });
		const { request } = api.driver.vertex;
		expect(request({ model: "m", stream: true, contents: [] }, { protocol: "google.gemini" })).toEqual({ contents: [] });
		expect(JSON.parse(JSON.stringify(request({ model: "m", max_tokens: 1 })))).toEqual({
			anthropic_version: "vertex-2023-10-16",
			max_tokens: 1
		});
	});

	it("path(): the protocol picks the publisher", async () => {
		const server = await start();
		const api = await make({ front: "openai", upstreams: [upstream(server)], detect: false });
		const endpoint = { name: "v", url: server.url, vertex: { project: "proj", region: "us-east5" } };
		expect(api.driver.vertex.path("gemini", { endpoint, model: MODEL, protocol: "google.gemini", stream: true })).toBe(
			`${BASE}/${MODEL}:streamGenerateContent?alt=sse`
		);
		expect(api.driver.vertex.path("messages", { endpoint, model: "claude-x", protocol: "anthropic.messages" })).toMatch(
			/publishers\/anthropic/
		);
	});
});

describe("cached contents", () => {
	it("names the collection and the model resource of the project and region", () => {
		const endpoint = { name: "v", url: "https://x", vertex: { project: "p q", region: "europe-west1" } };
		expect(geminiCache(endpoint, "publishers/google/models/gemini-2.5-flash")).toEqual({
			path: "/v1/projects/p%20q/locations/europe-west1/cachedContents",
			resource: "projects/p q/locations/europe-west1/publishers/google/models/gemini-2.5-flash"
		});
		expect(geminiCache(endpoint, "models/gemini-x").resource).toMatch(/publishers\/google\/models\/gemini-x$/);
	});

	it("a cache_control breakpoint creates a cached content in the project and region, and the request uses it", async () => {
		const made = [];
		const server = await start({
			vertex: (req, body, res) => {
				if (req.url.endsWith("/cachedContents")) {
					made.push([req.url, body]);
					return reply(res, 200, { name: "projects/proj/locations/us-east5/cachedContents/9" });
				}
				return reply(res, 200, content([{ text: "ok" }]));
			}
		});
		const api = await make({ front: "anthropic", upstreams: [upstream(server)], detect: false });
		const system = [{ type: "text", text: "Be careful. ".repeat(500), cache_control: { type: "ephemeral" } }];
		const out = await api.send({ model: MODEL, max_tokens: 8, system, messages: user });
		expect(out.status).toBe(200);
		expect(made[0][0]).toBe("/v1/projects/proj/locations/us-east5/cachedContents");
		expect(made[0][1].model).toBe(`projects/proj/locations/us-east5/publishers/google/models/${MODEL}`);
		const calls = vertexCalls(server);
		expect(calls.map((entry) => entry.url)).toEqual([
			"/v1/projects/proj/locations/us-east5/cachedContents",
			`${BASE}/${MODEL}:generateContent`
		]);
		expect(calls[0].headers.authorization).toBe("Bearer tok");
		expect(calls[1].body.cachedContent).toBe("projects/proj/locations/us-east5/cachedContents/9");
		expect(calls[1].body.systemInstruction).toBeUndefined();
	});
});

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/driver/vertex.test.vitest.mjs
 *	@Date: 2026-11-19T09:00:00-08:00 (1795107600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-19T09:00:00-08:00 (1795107600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Vertex AI driver (Claude): detection, URL and body shape, Google authentication, streaming, token counting and errors, all against a
 * local stand-in for Google. Nothing here reaches the internet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { anthropicSse } from "../helpers/streams.mjs";
import { authorizedUser, fakeGoogle, serviceAccount } from "../helpers/google.mjs";
import * as google from "../../src/lib/google-auth.mjs";

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

const MODEL = "claude-sonnet-4-5@20250929";
const hello = { model: MODEL, max_tokens: 64, messages: [{ role: "user", content: "hi" }] };
const BASE = "/v1/projects/proj/locations/us-east5/publishers/anthropic/models";
const message = (content, extra = {}) => ({
	id: "msg_1",
	type: "message",
	role: "assistant",
	model: MODEL,
	content,
	stop_reason: "end_turn",
	stop_sequence: null,
	usage: { input_tokens: 9, output_tokens: 4 },
	...extra
});
const reply = (res, status, body) => {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
};
const upstream = (server, vertex = {}, extra = {}) => ({
	url: server.url,
	backend: "vertex",
	vertex: { project: "proj", region: "us-east5", accessToken: "tok", ...vertex },
	...extra
});
const vertexCalls = (server) => server.requests.filter((entry) => entry.method === "POST" && entry.url !== "/token");

describe("detection and facts", () => {
	it("binds the aiplatform.googleapis.com host names with no request, and nothing that only looks like them", async () => {
		const transport = fakeTransport(() => ({ body: {} }));
		const api = await make({ upstreams: ["https://us-east5-aiplatform.googleapis.com", "https://aiplatform.googleapis.com"], transport });
		expect(api.status().upstreams.map((entry) => entry.driver)).toEqual(["vertex", "vertex"]);
		expect(api.status().upstreams[0]).toMatchObject({ protocol: "anthropic.messages", protocols: ["anthropic.messages"] });
		expect(transport.calls).toHaveLength(0);
		const { detect } = api.driver.vertex;
		expect(detect({ endpoint: { url: "https://europe-west1-aiplatform.googleapis.com/v1" } })).toEqual({
			host: "europe-west1-aiplatform.googleapis.com"
		});
		expect(detect({ endpoint: { url: "https://aiplatform.us.rep.googleapis.com" } })).toEqual({ host: "aiplatform.us.rep.googleapis.com" });
		expect(detect({ endpoint: { url: "https://aiplatform.googleapis.com.evil.example" } })).toBeNull();
		expect(detect({ endpoint: { url: "https://notaiplatform.googleapis.com" } })).toBeNull();
		expect(detect({ endpoint: { url: "not a url" } })).toBeNull();
		expect(api.driver.vertex.info()).toMatchObject({
			name: "vertex",
			protocol: "anthropic.messages",
			order: 39,
			auth: "bearer",
			strict: false
		});
		expect(api.driver.vertex.settings()).toEqual({});
	});

	it("an explicit backend wins, and api: messages is accepted while chat is not", async () => {
		const server = await start();
		const transport = fakeTransport(() => ({ body: {} }));
		const api = await make({ upstreams: [{ url: "https://aiplatform.googleapis.com", backend: "compatible" }], transport });
		expect(api.status().upstreams[0].driver).toBe("compatible");
		await make({ upstreams: [upstream(server, {}, { api: "messages" })], detect: false });
		await expect(make({ upstreams: [upstream(server, {}, { api: "chat" })], detect: false })).rejects.toMatchObject({
			code: "unsupported_api"
		});
	});
});

describe("configuration", () => {
	it("the url defaults to the region's host when the backend is vertex", async () => {
		const regional = await make({ upstreams: [{ backend: "vertex", vertex: { project: "p", region: "europe-west1" } }], detect: false });
		expect(regional.status().upstreams[0].url).toBe("https://europe-west1-aiplatform.googleapis.com");
		const global = await make({ upstreams: [{ backend: "vertex", vertex: { project: "p", region: "global" } }], detect: false });
		expect(global.status().upstreams[0].url).toBe("https://aiplatform.googleapis.com");
		vi.stubEnv("CLOUD_ML_REGION", "us-east5");
		const env = await make({ upstreams: [{ backend: "vertex", vertex: { project: "p" } }, { backend: "vertex" }], detect: false });
		expect(env.status().upstreams.map((entry) => entry.url)).toEqual(Array(2).fill("https://us-east5-aiplatform.googleapis.com"));
		vi.stubEnv("CLOUD_ML_REGION", "");
		await expect(make({ upstreams: [{ backend: "vertex", vertex: { project: "p" } }], detect: false })).rejects.toThrow(/needs a "url"/);
		await expect(make({ upstreams: [{ backend: "compatible", vertex: { region: "us-east5" } }], detect: false })).rejects.toThrow(
			/needs a "url"/
		);
	});

	it("rejects a malformed vertex object", async () => {
		const url = "https://us-east5-aiplatform.googleapis.com";
		for (const vertex of ["x", null, ["a"], { project: "" }, { region: 5 }, { accessToken: {} }]) {
			await expect(make({ upstreams: [{ url, vertex }], detect: false })).rejects.toMatchObject({ code: "INVALID_CONFIG" });
		}
		await expect(make({ upstreams: [{ url, vertex: { getToken: "nope" } }], detect: false })).rejects.toThrow(
			/getToken must be a function/
		);
		await make({
			upstreams: [{ url, vertex: { project: "p", region: "us-east5", getToken: () => "t", credentials: "/some/file" } }],
			detect: false
		});
	});
});

describe("the request", () => {
	it("goes to rawPredict under the project, region and model, with the version in the body and the model out of it", async () => {
		const server = await start();
		const api = await make({ upstreams: [upstream(server)], detect: false });
		const sent = await api.request({ ...hello, system: "be brief", temperature: 0.2 });
		expect(sent.method).toBe("POST");
		expect(sent.path).toBe(`${BASE}/${MODEL}:rawPredict`);
		expect(sent.url).toBe(`${server.url}${BASE}/${MODEL}:rawPredict`);
		expect(sent.body.anthropic_version).toBe("vertex-2023-10-16");
		expect(sent.body.model).toBe(MODEL);
		expect(JSON.parse(JSON.stringify(sent.body))).toEqual({
			anthropic_version: "vertex-2023-10-16",
			max_tokens: 64,
			messages: hello.messages,
			system: "be brief",
			temperature: 0.2
		});
		expect(sent.headers).toMatchObject({ authorization: "Bearer tok", accept: "application/json", "content-type": "application/json" });
		expect(sent.headers).not.toHaveProperty("x-api-key");
		expect(sent.headers).not.toHaveProperty("anthropic-version");
	});

	it("streams through streamRawPredict, keeping stream in the body", async () => {
		const server = await start();
		const api = await make({ upstreams: [upstream(server)], detect: false });
		const sent = await api.request({ ...hello, stream: true });
		expect(sent.path).toBe(`${BASE}/${MODEL}:streamRawPredict`);
		expect(sent.headers.accept).toBe("text/event-stream");
		expect(JSON.parse(JSON.stringify(sent.body)).stream).toBe(true);
	});

	it("uses the global host and path for region global", async () => {
		const api = await make({
			upstreams: [{ url: "https://aiplatform.googleapis.com", vertex: { project: "p", region: "global", accessToken: "t" } }],
			transport: fakeTransport(() => ({ body: {} }))
		});
		const sent = await api.request(hello);
		expect(sent.url).toBe(
			`https://aiplatform.googleapis.com/v1/projects/p/locations/global/publishers/anthropic/models/${MODEL}:rawPredict`
		);
	});

	it("uses the multi-region host and location for us and eu", async () => {
		const api = await make({
			upstreams: [{ backend: "vertex", vertex: { project: "p", region: "eu", accessToken: "t" } }],
			transport: fakeTransport(() => ({ body: {} }))
		});
		const sent = await api.request(hello);
		expect(sent.url).toBe(
			`https://aiplatform.eu.rep.googleapis.com/v1/projects/p/locations/eu/publishers/anthropic/models/${MODEL}:rawPredict`
		);
	});

	it("takes the region from the host and the project from the environment", async () => {
		vi.stubEnv("ANTHROPIC_VERTEX_PROJECT_ID", "env-project");
		const api = await make({
			upstreams: [{ url: "https://europe-west1-aiplatform.googleapis.com", vertex: { accessToken: "t" } }],
			transport: fakeTransport(() => ({ body: {} }))
		});
		const sent = await api.request(hello);
		expect(sent.path).toBe(`/v1/projects/env-project/locations/europe-west1/publishers/anthropic/models/${MODEL}:rawPredict`);
	});

	it("forwards anthropic-beta from the client, and drops anthropic-version and the key header", async () => {
		const server = await start();
		const api = await make({ upstreams: [upstream(server, {}, { headers: { "x-goog-user-project": "billing" } })], detect: false });
		const sent = await api.request(hello, {
			clientHeaders: { "anthropic-beta": "context-1m-2025-08-07", "anthropic-version": "2023-06-01", "x-api-key": "client-key" }
		});
		expect(sent.headers["anthropic-beta"]).toBe("context-1m-2025-08-07");
		expect(sent.headers["x-goog-user-project"]).toBe("billing");
		expect(sent.headers).not.toHaveProperty("anthropic-version");
		expect(sent.headers).not.toHaveProperty("x-api-key");
		expect(sent.headers.authorization).toBe("Bearer tok");
	});

	it("tells a missing project or region before anything is sent", async () => {
		vi.stubEnv("GOOGLE_CLOUD_PROJECT", "");
		vi.stubEnv("GCLOUD_PROJECT", "");
		vi.stubEnv("ANTHROPIC_VERTEX_PROJECT_ID", "");
		vi.stubEnv("CLOUD_ML_REGION", "");
		const server = await start();
		const noProject = await make({
			upstreams: [{ url: server.url, backend: "vertex", vertex: { region: "us-east5", accessToken: "t" } }],
			detect: false
		});
		await expect(noProject.request(hello)).rejects.toMatchObject({ code: "INVALID_CONFIG" });
		const reply = await noProject.send(hello);
		expect(reply).toMatchObject({ status: 500, body: { type: "error" } });
		expect(reply.body.error.message).toMatch(/no Google Cloud project/);
		const noRegion = await make({
			upstreams: [{ url: server.url, backend: "vertex", vertex: { project: "p", accessToken: "t" } }],
			detect: false
		});
		await expect(noRegion.request(hello)).rejects.toThrow(/no Vertex AI region/);
		expect(server.requests).toHaveLength(0);
	});
});

describe("round trips", () => {
	it("sends a non-streaming request and returns the Messages reply as it is", async () => {
		const server = await start({ vertex: (_req, _body, res) => reply(res, 200, message([{ type: "text", text: "Hello from Vertex" }])) });
		const api = await make({ upstreams: [upstream(server)], detect: false });
		const answer = await api.send(hello);
		expect(answer.status).toBe(200);
		expect(answer.body).toMatchObject({
			type: "message",
			content: [{ type: "text", text: "Hello from Vertex" }],
			usage: { input_tokens: 9, output_tokens: 4 }
		});
		const [call] = vertexCalls(server);
		expect(call.url).toBe(`${BASE}/${MODEL}:rawPredict`);
		expect(call.headers.authorization).toBe("Bearer tok");
		expect(call.body).toEqual({ anthropic_version: "vertex-2023-10-16", max_tokens: 64, messages: hello.messages });
		expect(call.body).not.toHaveProperty("model");
		const usage = await answer.usage;
		expect(usage).toMatchObject({ model: MODEL, input_tokens: 9, output_tokens: 4, complete: true });
	});

	it("streams the standard Anthropic events through streamRawPredict", async () => {
		const events = [
			{ data: { type: "message_start", message: message([], { stop_reason: null, usage: { input_tokens: 9, output_tokens: 1 } }) } },
			{ data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
			{ data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hel" } } },
			{ data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "lo" } } },
			{ data: { type: "content_block_stop", index: 0 } },
			{ data: { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 4 } } },
			{ data: { type: "message_stop" } }
		];
		const server = await start({
			vertex: (_req, _body, res) => {
				res.writeHead(200, { "content-type": "text/event-stream" });
				res.end(anthropicSse(events));
			}
		});
		const api = await make({ upstreams: [upstream(server)], detect: false });
		const answer = await api.send({ ...hello, stream: true });
		expect(answer.status).toBe(200);
		const received = await collect(answer.stream);
		expect(received.map((entry) => entry.data.type ?? entry.event)).toEqual(events.map((entry) => entry.data.type));
		expect(
			received
				.filter((entry) => entry.data.delta?.type === "text_delta")
				.map((entry) => entry.data.delta.text)
				.join("")
		).toBe("Hello");
		const [call] = vertexCalls(server);
		expect(call.url).toBe(`${BASE}/${MODEL}:streamRawPredict`);
		expect(call.body.stream).toBe(true);
		expect(call.headers.accept).toBe("text/event-stream");
		expect(await answer.usage).toMatchObject({ input_tokens: 9, output_tokens: 4, complete: true });
	});

	it("carries tool use both ways", async () => {
		const tool = {
			name: "get_weather",
			description: "Weather",
			input_schema: { type: "object", properties: { city: { type: "string" } } }
		};
		const server = await start({
			vertex: (_req, body, res) =>
				body.messages.at(-1).role === "user" && body.messages.at(-1).content[0]?.type === "tool_result"
					? reply(res, 200, message([{ type: "text", text: "Sunny in Paris" }]))
					: reply(
							res,
							200,
							message([{ type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "Paris" } }], { stop_reason: "tool_use" })
						)
		});
		const api = await make({ upstreams: [upstream(server)], detect: false });
		const first = await api.send({ ...hello, tools: [tool], tool_choice: { type: "auto" } });
		expect(first.body.stop_reason).toBe("tool_use");
		expect(first.body.content[0]).toMatchObject({ type: "tool_use", id: "toolu_1", input: { city: "Paris" } });
		const second = await api.send({
			...hello,
			tools: [tool],
			messages: [
				...hello.messages,
				{ role: "assistant", content: first.body.content },
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "sunny" }] }
			]
		});
		expect(second.body.content[0].text).toBe("Sunny in Paris");
		const [call] = vertexCalls(server);
		expect(call.body.tools).toEqual([tool]);
		expect(call.body.tool_choice).toEqual({ type: "auto" });
		expect(vertexCalls(server)[1].body.messages[2].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1" });
	});

	it("answers an OpenAI-front request by converting to the Messages body", async () => {
		const server = await start({ vertex: (_req, _body, res) => reply(res, 200, message([{ type: "text", text: "Bonjour" }])) });
		const api = await make({ front: "openai", upstreams: [upstream(server)], detect: false });
		const answer = await api.send({ model: MODEL, max_tokens: 20, messages: [{ role: "user", content: "salut" }] });
		expect(answer.status).toBe(200);
		expect(answer.body.choices[0].message.content).toBe("Bonjour");
		const [call] = vertexCalls(server);
		expect(call.url).toBe(`${BASE}/${MODEL}:rawPredict`);
		expect(call.body).toMatchObject({ anthropic_version: "vertex-2023-10-16", max_tokens: 20, messages: [{ role: "user" }] });
		expect(call.body).not.toHaveProperty("model");
	});
});

describe("Google authentication", () => {
	it("a service account key is exchanged once and the token reused", async () => {
		const server = await start({ vertex: (_req, _body, res) => reply(res, 200, message([{ type: "text", text: "ok" }])) });
		const api = await make({
			upstreams: [upstream(server, { accessToken: undefined, credentials: serviceAccount(server.tokenUrl) })],
			detect: false
		});
		await api.send(hello);
		await api.send(hello);
		expect(server.tokens).toHaveLength(1);
		expect(server.tokens[0].form.grant_type).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
		expect(vertexCalls(server).map((call) => call.headers.authorization)).toEqual(["Bearer ya29.1", "Bearer ya29.1"]);
	});

	it("takes the project from the credentials when none is set", async () => {
		const server = await start({ vertex: (_req, _body, res) => reply(res, 200, message([{ type: "text", text: "ok" }])) });
		const api = await make({
			upstreams: [upstream(server, { project: undefined, accessToken: undefined, credentials: serviceAccount(server.tokenUrl) })],
			detect: false
		});
		await api.send(hello);
		expect(vertexCalls(server)[0].url).toContain("/projects/sa-project/");
	});

	it("an authorized_user file from GOOGLE_APPLICATION_CREDENTIALS refreshes its token", async () => {
		const server = await start({ vertex: (_req, _body, res) => reply(res, 200, message([{ type: "text", text: "ok" }])) });
		vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", JSON.stringify(authorizedUser(server.tokenUrl)));
		const api = await make({ upstreams: [upstream(server, { accessToken: undefined })], detect: false });
		await api.send(hello);
		expect(server.tokens[0].form).toMatchObject({ grant_type: "refresh_token", refresh_token: "refresh-1" });
		expect(vertexCalls(server)[0].headers.authorization).toBe("Bearer ya29.1");
	});

	it("getToken wins over every other source and is called for each request", async () => {
		const server = await start({ vertex: (_req, _body, res) => reply(res, 200, message([{ type: "text", text: "ok" }])) });
		let n = 0;
		const getToken = async () => `cb-${++n}`;
		const api = await make({
			upstreams: [upstream(server, { getToken, accessToken: "static", credentials: serviceAccount(server.tokenUrl) }, { apiKey: "key" })],
			detect: false
		});
		await api.send(hello);
		await api.send(hello);
		expect(vertexCalls(server).map((call) => call.headers.authorization)).toEqual(["Bearer cb-1", "Bearer cb-2"]);
		expect(server.tokens).toHaveLength(0);
	});

	it("the upstream apiKey is a bearer token when nothing more specific is set", async () => {
		const server = await start();
		const api = await make({ upstreams: [upstream(server, { accessToken: undefined }, { apiKey: "from-key" })], detect: false });
		expect((await api.request(hello)).headers.authorization).toBe("Bearer from-key");
	});

	it("a refused or missing credential is a 401 reply that names the cause, and nothing is sent to Vertex", async () => {
		const server = await start({
			token: () => ({ status: 400, body: { error: "invalid_grant", error_description: "Invalid JWT Signature." } })
		});
		const bad = await make({
			upstreams: [upstream(server, { accessToken: undefined, credentials: serviceAccount(server.tokenUrl) })],
			detect: false
		});
		const refused = await bad.send(hello);
		expect(refused.status).toBe(401);
		expect(refused.body).toMatchObject({ type: "error", error: { type: "authentication_error" } });
		expect(refused.body.error.message).toContain("Invalid JWT Signature.");
		vi.stubEnv("GOOGLE_ACCESS_TOKEN", "");
		vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "");
		vi.stubEnv("CLOUDSDK_CONFIG", "/nonexistent");
		const none = await make({ upstreams: [upstream(server, { accessToken: undefined })], detect: false });
		const missing = await none.send(hello);
		expect(missing.status).toBe(401);
		expect(missing.body.error.message).toMatch(/No Google credentials for Vertex AI/);
		expect(vertexCalls(server)).toHaveLength(0);
	});

	it("never puts the token or a key in the status", async () => {
		const server = await start();
		const api = await make({ upstreams: [upstream(server, { credentials: serviceAccount(server.tokenUrl) })], detect: false });
		expect(JSON.stringify(api.status())).not.toMatch(/BEGIN PRIVATE KEY|"tok"/);
	});
});

describe("token counting", () => {
	it("uses count-tokens with the model in the body and only the fields it accepts", async () => {
		const server = await start({ vertex: (_req, _body, res) => reply(res, 200, { input_tokens: 123 }) });
		const api = await make({ upstreams: [upstream(server)], detect: false });
		const tool = { name: "t", description: "d", input_schema: { type: "object", properties: {} } };
		const counted = await api.token.count({ ...hello, system: "be brief", tools: [tool], temperature: 0.5 });
		expect(counted).toEqual({ input_tokens: 123 });
		const [call] = vertexCalls(server);
		expect(call.url).toBe(`${BASE}/count-tokens:rawPredict`);
		expect(call.headers.authorization).toBe("Bearer tok");
		expect(call.body).toEqual({ model: MODEL, messages: hello.messages, system: "be brief", tools: [tool] });
	});

	it("falls back to the estimate on a 404, a malformed answer, a network error or missing credentials", async () => {
		const server = await start();
		const api = await make({ upstreams: [upstream(server, { headers: undefined })], detect: false });
		const estimated = await api.token.count(hello);
		expect(estimated.input_tokens).toBeGreaterThan(0);
		expect(vertexCalls(server)).toHaveLength(1);
		const odd = await start({ vertex: (_req, _body, res) => reply(res, 200, { input_tokens: "many" }) });
		const second = await make({ upstreams: [upstream(odd)], detect: false });
		expect(await second.token.count(hello)).toEqual(estimated);
		const down = await make({ upstreams: [{ ...upstream(odd), url: "http://127.0.0.1:1" }], detect: false });
		expect(await down.token.count(hello)).toEqual(estimated);
		vi.stubEnv("GOOGLE_ACCESS_TOKEN", "");
		vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "");
		vi.stubEnv("CLOUDSDK_CONFIG", "/nonexistent");
		const bare = await make({ upstreams: [upstream(odd, { accessToken: undefined })], detect: false });
		const before = vertexCalls(odd).length;
		expect(await bare.token.count(hello)).toEqual(estimated);
		expect(vertexCalls(odd)).toHaveLength(before);
	});

	it("sends the upstream's extra headers", async () => {
		const server = await start({ vertex: (_req, _body, res) => reply(res, 200, { input_tokens: 5 }) });
		const api = await make({ upstreams: [upstream(server, {}, { headers: { "x-goog-user-project": "billing" } })], detect: false });
		await api.token.count(hello);
		expect(vertexCalls(server)[0].headers["x-goog-user-project"]).toBe("billing");
	});
});

describe("errors", () => {
	const failing = async (status, body, front = "anthropic") => {
		const server = await start({ vertex: (_req, _body, res) => reply(res, status, body) });
		const api = await make({ front, upstreams: [upstream(server)], detect: false });
		return api.send(hello);
	};

	it("maps Google's envelope to the Anthropic error shape by status", async () => {
		const notFound = await failing(404, {
			error: {
				code: 404,
				message: "Publisher Model `projects/p/locations/us-east5/publishers/anthropic/models/x` not found.",
				status: "NOT_FOUND"
			}
		});
		expect(notFound).toMatchObject({ status: 404, body: { type: "error", error: { type: "not_found_error" } } });
		expect(notFound.body.error.message).toContain("Publisher Model");
		expect((await failing(403, { error: { code: 403, message: "Permission denied", status: "PERMISSION_DENIED" } })).body.error.type).toBe(
			"permission_error"
		);
		expect((await failing(429, { error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } })).body.error.type).toBe(
			"rate_limit_error"
		);
		expect((await failing(400, { error: { code: 400, message: "bad", status: "INVALID_ARGUMENT" } })).body.error.type).toBe(
			"invalid_request_error"
		);
		expect((await failing(503, { error: { code: 503, message: "later", status: "UNAVAILABLE" } })).status).toBe(503);
	});

	it("reads an envelope wrapped in an array and keeps Claude's own error type", async () => {
		const wrapped = await failing(400, [{ error: { code: 400, message: "wrapped message", status: "INVALID_ARGUMENT" } }]);
		expect(wrapped.body.error).toEqual({ type: "invalid_request_error", message: "wrapped message" });
		const own = await failing(529, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } });
		expect(own).toMatchObject({ status: 529, body: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } } });
	});

	it("keeps a body that is plain text, and Google's status as the code for an OpenAI client", async () => {
		const text = await failing(502, "upstream connect error");
		expect(text.body.error.message).toBe("upstream connect error");
		const chat = await failing(404, { error: { code: 404, message: "gone", status: "NOT_FOUND" } }, "openai");
		expect(chat).toMatchObject({ status: 404, body: { error: { message: "gone", type: "not_found_error", code: "NOT_FOUND" } } });
		const bare = await failing(500, {}, "openai");
		expect(bare.body.error.code).toBe(500);
	});

	it("reports a driver error normalizer result for a body without an envelope", async () => {
		const server = await start();
		const api = await make({ upstreams: [upstream(server)], detect: false });
		expect(api.driver.vertex.error(401, { error: { code: 401, message: "no", status: "UNAUTHENTICATED" } })).toEqual({
			error: { message: "no", type: undefined, param: null, code: "UNAUTHENTICATED" }
		});
		expect(api.driver.vertex.error(500, null).error.code).toBe(500);
	});
});

describe("model list", () => {
	it("has no live list: the configured models are returned", async () => {
		const server = await start();
		const api = await make({ upstreams: [upstream(server, {}, { models: [MODEL] })], detect: false });
		expect(api.driver.vertex.model).toBeUndefined();
		const listed = await api.model.list();
		expect(listed.data.map((entry) => entry.id)).toEqual([MODEL]);
		expect(server.requests).toHaveLength(0);
	});
});

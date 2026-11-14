/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/driver/azure.test.vitest.mjs
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
 * @fileoverview Azure OpenAI driver: host detection, `api-key` header, v1 and classic URLs, token field, content filter replies and errors.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { openaiSse } from "../helpers/streams.mjs";
import { route } from "../../src/lib/azure.mjs";
import * as http from "../../src/lib/http.mjs";

afterEach(closeAll);

const url = "https://res.openai.azure.com";
const user = [{ role: "user", content: "hi" }];
const completion = (choice, extra = {}) => ({
	id: "c",
	object: "chat.completion",
	model: "gpt-4o",
	choices: [{ index: 0, ...choice }],
	usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
	...extra
});
const ok = () => ({ body: completion({ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }) });
const sse = (frames) => () => new Response(openaiSse(frames), { status: 200, headers: { "content-type": "text/event-stream" } });

describe("azure detection and facts", () => {
	it("matches the three Azure host families by host, with the api-key header", async () => {
		const api = await make({ upstreams: [url], transport: fakeTransport(() => ({ body: {} })) });
		expect(api.status().upstreams[0]).toMatchObject({ driver: "azure", protocol: "openai.chat" });
		const { detect } = api.driver.azure;
		for (const host of ["res.openai.azure.com", "res.cognitiveservices.azure.com", "res.services.ai.azure.com"]) {
			expect(detect({ endpoint: { url: `https://${host}/openai/v1` } })).toEqual({ host });
		}
		expect(detect({ endpoint: { url: "https://openai.azure.com.evil.example" } })).toBeNull();
		expect(detect({ endpoint: { url: "https://azure.example.com" } })).toBeNull();
		expect(detect({ endpoint: { url: "not a url" } })).toBeNull();
		expect(api.driver.azure.info()).toMatchObject({ order: 32, auth: "api-key" });
		expect(api.driver.azure.settings()).toMatchObject({ maxTokensField: "max_completion_tokens", topK: false });
	});

	it("an explicit backend wins", async () => {
		const api = await make({ upstreams: [{ url, backend: "compatible" }], transport: fakeTransport(() => ({ body: {} })) });
		expect(api.status().upstreams[0].driver).toBe("compatible");
	});
});

describe("azure URLs and headers", () => {
	it("route builds the v1 and the classic form", () => {
		expect(route("chat", { url })).toBe("/openai/v1/chat/completions");
		expect(route("embeddings", { url })).toBe("/openai/v1/embeddings");
		expect(route("models", { url })).toBe("/openai/v1/models");
		expect(route("chat", { url, apiVersion: "2024-10-21" }, "gpt-4o")).toBe(
			"/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21"
		);
		expect(route("chat", { url, apiVersion: "2024-10-21", deployment: "my dep" }, "gpt-4o")).toBe(
			"/openai/deployments/my%20dep/chat/completions?api-version=2024-10-21"
		);
		expect(route("embeddings", { url, apiVersion: "v" }, "emb")).toBe("/openai/deployments/emb/embeddings?api-version=v");
		expect(route("models", { url, apiVersion: "2024-10-21" })).toBe("/openai/models?api-version=2024-10-21");
		expect(route("chat", { url, apiVersion: "v" })).toBe("/openai/deployments//chat/completions?api-version=v");
		// A base URL pasted with `/openai/v1` is trimmed to `/openai` by the config, so the prefix is not repeated.
		expect(route("chat", { url: `${url}/openai` })).toBe("/v1/chat/completions");
		expect(route("chat", { url: `${url}/openai`, apiVersion: "v", deployment: "d" })).toBe("/deployments/d/chat/completions?api-version=v");
		expect(route("models", { url: `${url}/openai`, apiVersion: "v" })).toBe("/models?api-version=v");
	});

	it("v1: model in the body, api-key header and no Authorization", async () => {
		const api = await make({ upstreams: [{ url, apiKey: "k1", backend: "azure" }], detect: false });
		const sent = await api.request({ model: "gpt-4o", max_tokens: 16, messages: user });
		expect(sent.url).toBe("https://res.openai.azure.com/openai/v1/chat/completions");
		expect(sent.path).toBe("/openai/v1/chat/completions");
		expect(sent.headers["api-key"]).toBe("k1");
		expect(sent.headers.authorization).toBeUndefined();
		expect(sent.body.model).toBe("gpt-4o");
		expect(sent.body.max_completion_tokens).toBe(16);
	});

	it("v1: a pasted .../openai/v1 base URL gives the same URL", async () => {
		const api = await make({ upstreams: [{ url: `${url}/openai/v1/`, backend: "azure" }], detect: false });
		const sent = await api.request({ model: "gpt-4o", max_tokens: 16, messages: user });
		expect(sent.url).toBe("https://res.openai.azure.com/openai/v1/chat/completions");
	});

	it("classic: deployment from the model by default, api-version in the query", async () => {
		const api = await make({ upstreams: [{ url, apiKey: "k", apiVersion: "2024-10-21", backend: "azure" }], detect: false });
		const sent = await api.request({ model: "my-gpt4o", max_tokens: 16, messages: user });
		expect(sent.url).toBe("https://res.openai.azure.com/openai/deployments/my-gpt4o/chat/completions?api-version=2024-10-21");
		expect(sent.headers["api-key"]).toBe("k");
	});

	it("classic: the configured deployment wins over the model", async () => {
		const upstream = { url, apiVersion: "2024-10-21", deployment: "prod", backend: "azure" };
		const api = await make({ upstreams: [upstream], detect: false });
		const sent = await api.request({ model: "gpt-4o", max_tokens: 16, messages: user });
		expect(sent.url).toContain("/openai/deployments/prod/chat/completions?api-version=2024-10-21");
	});

	it("rejects an empty or non-string apiVersion or deployment", async () => {
		await expect(make({ upstreams: [{ url, apiVersion: "" }], detect: false })).rejects.toMatchObject({ code: "INVALID_CONFIG" });
		await expect(make({ upstreams: [{ url, deployment: 3 }], detect: false })).rejects.toThrow(/deployment must be a non-empty string/);
	});

	it("sends a chat call to the built URL end to end", async () => {
		const transport = fakeTransport(ok);
		const api = await make({ upstreams: [{ url, apiKey: "k", apiVersion: "2024-10-21" }], transport });
		const reply = await api.send({ model: "gpt-4o", max_tokens: 16, messages: user });
		expect(reply.status).toBe(200);
		const call = transport.calls.find((entry) => entry.url.includes("/chat/completions"));
		expect(call.url).toBe("https://res.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21");
		expect(call.init.headers["api-key"]).toBe("k");
	});

	it("embeddings use the same URL forms", async () => {
		const v1 = fakeTransport(() => ({ body: { object: "list", data: [], model: "emb" } }));
		const first = await make({ front: "openai", upstreams: [{ url, apiKey: "k", models: ["emb"], backend: "azure" }], transport: v1 });
		await first.embeddings.send({ model: "emb", input: "x" });
		expect(v1.calls[0].url).toBe("https://res.openai.azure.com/openai/v1/embeddings");
		expect(v1.calls[0].init.headers["api-key"]).toBe("k");
		const classic = fakeTransport(() => ({ body: { object: "list", data: [], model: "emb" } }));
		const second = await make({
			front: "openai",
			upstreams: [{ url, models: ["emb"], apiVersion: "2024-10-21", backend: "azure" }],
			transport: classic
		});
		await second.embeddings.send({ model: "emb", input: "x" });
		expect(classic.calls[0].url).toBe("https://res.openai.azure.com/openai/deployments/emb/embeddings?api-version=2024-10-21");
	});

	it("model listing asks the Azure models path with the api-key header", async () => {
		const transport = fakeTransport(() => ({ body: { object: "list", data: [{ id: "gpt-4o", object: "model" }] } }));
		const api = await make({ front: "openai", upstreams: [{ url, apiKey: "k", backend: "azure" }], transport });
		const listed = await api.model.list();
		expect(listed.data.map((entry) => entry.id)).toEqual(["gpt-4o"]);
		expect(transport.calls[0].url).toBe("https://res.openai.azure.com/openai/v1/models");
		expect(transport.calls[0].init.headers["api-key"]).toBe("k");
	});
});

describe("http helpers", () => {
	it("headers puts the key in api-key, and probe keys it separately from the bearer request", async () => {
		expect(http.headers({ apiKey: "k", headers: {} }, "api-key")).toEqual({ "api-key": "k" });
		expect(http.headers({ apiKey: "k", headers: {} })).toEqual({ authorization: "Bearer k" });
		const seen = [];
		const transport = async (target, init) => {
			seen.push(init.headers);
			return new Response("{}", { status: 200 });
		};
		const context = { endpoint: { url, apiKey: "k", headers: {} }, transport, probes: new Map() };
		await http.probe(context, "/x");
		await http.probe(context, "/x", { auth: "api-key" });
		await http.probe(context, "/x", { auth: "api-key" });
		expect(seen).toEqual([{ authorization: "Bearer k" }, { "api-key": "k" }]);
	});

	it("pathOf falls back to the standard OpenAI paths", async () => {
		const driver = { info: { paths: { chat: "/c" } } };
		expect(await http.pathOf(driver, "chat", {})).toBe("/c");
		expect(await http.pathOf(driver, "embeddings", {})).toBe("/v1/embeddings");
		expect(await http.pathOf(driver, "models", {})).toBe("/v1/models");
	});
});

describe("azure.request", () => {
	it("drops empty tool fields and keeps max_completion_tokens on the v1 API and current versions", async () => {
		const { request } = (await make({ upstreams: [url], detect: false })).driver.azure;
		expect(request({ model: "m", messages: user, tools: [], tool_choice: "auto", max_completion_tokens: 5 })).toEqual({
			model: "m",
			messages: user,
			max_completion_tokens: 5
		});
		const body = { model: "m", messages: user, max_completion_tokens: 5 };
		expect(request(body)).toEqual(body);
		expect(request(body, { endpoint: {} })).toEqual(body);
		expect(request(body, { endpoint: { apiVersion: "2024-10-21" } })).toEqual(body);
		expect(request(body, { endpoint: { apiVersion: "2024-09-01-preview" } })).toEqual(body);
		expect(request(body, { endpoint: { apiVersion: "preview" } })).toEqual(body);
	});

	it("sends max_tokens for an api-version older than 2024-09-01", async () => {
		const { request } = (await make({ upstreams: [url], detect: false })).driver.azure;
		const endpoint = { apiVersion: "2024-06-01" };
		expect(request({ model: "m", messages: user, max_completion_tokens: 5 }, { endpoint })).toEqual({
			model: "m",
			messages: user,
			max_tokens: 5
		});
		expect(request({ model: "m", messages: user }, { endpoint })).toEqual({ model: "m", messages: user });
	});

	it("an old api-version sends max_tokens end to end", async () => {
		const api = await make({ upstreams: [{ url, apiVersion: "2023-05-15", backend: "azure" }], detect: false });
		const sent = await api.request({ model: "gpt-35", max_tokens: 16, messages: user });
		expect(sent.body.max_tokens).toBe(16);
		expect(sent.body.max_completion_tokens).toBeUndefined();
	});
});

describe("azure content filter", () => {
	const filtered = { hate: { filtered: true, severity: "high" }, violence: { filtered: false, severity: "safe" } };

	it("non-stream: finish_reason content_filter is a refusal with the category", async () => {
		const body = completion({
			message: { role: "assistant", content: "" },
			finish_reason: "content_filter",
			content_filter_results: filtered
		});
		const api = await make({ upstreams: [url], transport: fakeTransport(() => ({ body })) });
		const reply = await api.send({ model: "gpt-4o", max_tokens: 16, messages: user });
		expect(reply.body.stop_reason).toBe("refusal");
		expect(reply.body.stop_details).toMatchObject({ type: "refusal", category: "general_harms" });
	});

	it("non-stream: a content_filter stop without a filtered harm has no category", async () => {
		const body = completion({
			message: { role: "assistant", content: "" },
			finish_reason: "content_filter",
			content_filter_results: { protected_material_text: { filtered: true, detected: true } }
		});
		const api = await make({ upstreams: [url], transport: fakeTransport(() => ({ body })) });
		const reply = await api.send({ model: "gpt-4o", max_tokens: 16, messages: user });
		expect(reply.body.stop_reason).toBe("refusal");
		expect(reply.body.stop_details.category).toBeNull();
	});

	it("non-stream, OpenAI front: finish_reason passes as content_filter", async () => {
		const body = completion({ message: { role: "assistant", content: "" }, finish_reason: "content_filter" });
		const api = await make({ front: "openai", upstreams: [url], transport: fakeTransport(() => ({ body })) });
		const reply = await api.send({ model: "gpt-4o", messages: user });
		expect(reply.body.choices[0].finish_reason).toBe("content_filter");
	});

	const base = { id: "c", object: "chat.completion.chunk", model: "gpt-4o" };
	const frames = [
		{
			...base,
			choices: [],
			prompt_filter_results: [{ prompt_index: 0, content_filter_results: { hate: { filtered: false, severity: "safe" } } }]
		},
		{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "Hel" }, finish_reason: null, content_filter_results: {} }] },
		{ ...base, choices: [{ index: 0, delta: {}, finish_reason: "content_filter", content_filter_results: filtered }] },
		"[DONE]"
	];

	it("stream: a content_filter finish ends in a refusal stop", async () => {
		const api = await make({ upstreams: [url], transport: fakeTransport(sse(frames)) });
		const reply = await api.send({ model: "gpt-4o", max_tokens: 16, stream: true, messages: user });
		const events = await collect(reply.stream);
		const stop = events.find((event) => event.event === "message_delta").data.delta;
		expect(stop.stop_reason).toBe("refusal");
		expect(stop.stop_details).toMatchObject({ category: "general_harms" });
	});

	it("a filtered prompt (HTTP 400) keeps its code and names the categories", async () => {
		const upstreamBody = {
			error: {
				message: "The response was filtered due to the prompt triggering Azure OpenAI's content management policy.",
				type: null,
				param: "prompt",
				code: "content_filter",
				status: 400,
				innererror: { code: "ResponsibleAIPolicyViolation", content_filter_result: { ...filtered, sexual: { filtered: true } } }
			}
		};
		const transport = fakeTransport(() => ({ status: 400, body: upstreamBody }));
		const openai = await make({ front: "openai", upstreams: [url], transport });
		const reply = await openai.send({ model: "gpt-4o", messages: user });
		expect(reply.status).toBe(400);
		expect(reply.body.error).toMatchObject({ code: "content_filter", param: "prompt", type: "invalid_request_error" });
		expect(reply.body.error.message).toContain("Filtered categories: hate (high), sexual.");
		const anthropic = await make({ upstreams: [url], transport });
		const other = await anthropic.send({ model: "gpt-4o", max_tokens: 16, messages: user });
		expect(other.body.error.type).toBe("invalid_request_error");
		expect(other.body.error.message).toContain("hate (high)");
	});

	it("error leaves other errors and odd filter results alone", async () => {
		const { error } = (await make({ upstreams: [url], detect: false })).driver.azure;
		expect(error(429, { error: { message: "slow down", code: "429" } })).toEqual({
			error: { message: "slow down", type: undefined, param: null, code: "429" }
		});
		expect(error(500, "boom").error).toMatchObject({ message: "boom", code: 500 });
		const bare = {
			error: { message: "filtered", code: "content_filter", innererror: { content_filter_result: { hate: { filtered: true } } } }
		};
		expect(error(400, bare).error.message).toBe("filtered Filtered categories: hate.");
		expect(error(400, { error: { message: "filtered", code: "content_filter" } }).error.message).toBe("filtered");
		expect(
			error(400, { error: { message: "f", code: "content_filter", innererror: { content_filter_result: { hate: { filtered: false } } } } })
				.error.message
		).toBe("f");
		expect(error(400, { error: { message: "f", code: "content_filter", innererror: { content_filter_result: "x" } } }).error.message).toBe(
			"f"
		);
	});
});

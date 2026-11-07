/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/embeddings.test.vitest.mjs
 *	@Date: 2026-11-06T12:00:00-08:00 (1794081600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-06T12:00:00-08:00 (1794081600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview `embeddings.send` and `POST /v1/embeddings`: pass-through, routing, failover and error shapes.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, fakeTransport, make } from "../helpers/translator.mjs";

afterEach(closeAll);

const host = (url) => new URL(url).hostname.replace(".test", "");
const vector = {
	object: "list",
	data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2] }],
	model: "embed-1",
	usage: { prompt_tokens: 3, total_tokens: 3 }
};
const ask = { model: "embed-1", input: ["hello"], encoding_format: "float", custom_field: 1 };

/**
 * A translator whose upstreams are fake hosts; `handlers[name](init)` answers (or throws) for each.
 * @param {Record<string, Function>} handlers - Per-host handlers.
 * @param {Record<string, any>} [upstreams] - Extra fields per upstream name.
 * @param {object} [config] - Extra translator config.
 * @returns {Promise<{api: any, transport: any}>} Translator and transport.
 */
async function farm(handlers, upstreams = {}, config = {}) {
	const transport = fakeTransport((url, init) => handlers[host(url)](init, url));
	const api = await make({
		upstreams: Object.keys(handlers).map((name) => ({
			name,
			url: `http://${name}.test`,
			backend: "vllm",
			models: ["embed-1"],
			...upstreams[name]
		})),
		transport,
		detect: false,
		front: "openai",
		...config
	});
	return { api, transport };
}
const down = () => {
	throw new TypeError("fetch failed");
};

describe("embeddings.send", () => {
	it("forwards the body unchanged and returns the reply unchanged", async () => {
		const { api, transport } = await farm({ a: () => ({ body: vector }) }, { a: { apiKey: "secret" } });
		const reply = await api.embeddings.send(ask);
		expect(reply).toEqual({ status: 200, headers: { "content-type": "application/json" }, body: vector });
		expect(transport.calls).toHaveLength(1);
		expect(transport.calls[0].url).toBe("http://a.test/v1/embeddings");
		expect(JSON.parse(transport.calls[0].init.body)).toEqual(ask);
		expect(transport.calls[0].init.headers.authorization).toBe("Bearer secret");
	});

	it("sends the upstream's name for an aliased model", async () => {
		const { api, transport } = await farm({ a: () => ({ body: vector }) }, {}, { aliases: { small: "embed-1" } });
		await api.embeddings.send({ ...ask, model: "small" });
		expect(JSON.parse(transport.calls[0].init.body).model).toBe("embed-1");
	});

	it("routes to the endpoint that lists the model", async () => {
		const { api, transport } = await farm({ a: () => ({ body: vector }), b: () => ({ body: vector }) }, { a: { models: ["other"] } });
		await api.embeddings.send(ask);
		expect(transport.calls.map((call) => host(call.url))).toEqual(["b"]);
	});

	it("fails over on a connection error and on a 5xx", async () => {
		const { api, transport } = await farm({
			a: down,
			b: () => ({ status: 503, body: { error: { message: "busy" } } }),
			c: () => ({ body: vector })
		});
		const reply = await api.embeddings.send(ask);
		expect(reply.status).toBe(200);
		expect(transport.calls.map((call) => host(call.url))).toEqual(["a", "b", "c"]);
		expect(api.endpoint.status().endpoints.find((entry) => entry.name === "a").healthy).toBe(false);
	});

	it("answers 502 when every endpoint is unreachable", async () => {
		const { api } = await farm({ a: down, b: down });
		const reply = await api.embeddings.send(ask);
		expect(reply.status).toBe(502);
		expect(reply.body.error).toMatchObject({ type: "server_error", code: "upstream_unreachable" });
		expect(reply.body.error.message).toContain("Could not reach the upstream (b)");
	});

	it("returns the last upstream 5xx in the OpenAI shape when every endpoint fails with one", async () => {
		const { api } = await farm({ a: () => ({ status: 500, body: { error: { message: "boom" } } }) });
		const reply = await api.embeddings.send(ask);
		expect(reply).toMatchObject({ status: 500, body: { error: { message: "boom", type: "server_error" } } });
	});

	it("maps an upstream 4xx to an OpenAI error without failing over", async () => {
		const { api, transport } = await farm({
			a: () => ({ status: 400, body: { error: { message: "input too long", type: "BadRequestError", code: 400 } } }),
			b: () => ({ body: vector })
		});
		const reply = await api.embeddings.send(ask);
		expect(reply.status).toBe(400);
		expect(reply.body.error.message).toBe("input too long");
		expect(transport.calls).toHaveLength(1);
	});

	it("answers 502 when the upstream reply is not a JSON object", async () => {
		const { api } = await farm({ a: () => ({ body: "<html>" }) });
		expect(await api.embeddings.send(ask)).toMatchObject({ status: 502, body: { error: { code: "bad_gateway" } } });
	});

	it("answers 404 for an unlisted model even when the only upstream serves one model (no substitution)", async () => {
		const { api, transport } = await farm({ a: () => ({ body: vector }) });
		expect((await api.embeddings.send({ ...ask, model: "nope" })).status).toBe(404);
		expect(transport.calls).toHaveLength(0);
	});

	it("answers 404 model_not_found when no upstream serves the model", async () => {
		const { api, transport } = await farm({ a: () => ({ body: vector }) }, { a: { models: ["embed-1", "embed-2"] } });
		const reply = await api.embeddings.send({ ...ask, model: "nope" });
		expect(reply).toMatchObject({ status: 404, body: { error: { type: "not_found_error", code: "model_not_found", param: "model" } } });
		expect(transport.calls).toHaveLength(0);
	});

	it("answers 400 for a missing model and for a body that is not an object", async () => {
		const { api } = await farm({ a: () => ({ body: vector }) });
		expect((await api.embeddings.send({ input: "x" })).body.error).toMatchObject({ param: "model" });
		expect((await api.embeddings.send({ model: "", input: "x" })).status).toBe(400);
		expect((await api.embeddings.send([])).status).toBe(400);
		expect((await api.embeddings.send(null)).body.error.code).toBe("invalid_body");
	});

	it("answers 400 embeddings_unsupported for a model served only by an Anthropic-protocol upstream", async () => {
		const { api, transport } = await farm({ a: () => ({ body: vector }) }, { a: { backend: "anthropic", models: ["claude-x"] } });
		const reply = await api.embeddings.send({ ...ask, model: "claude-x" });
		expect(reply).toMatchObject({ status: 400, body: { error: { type: "invalid_request_error", code: "embeddings_unsupported" } } });
		expect(reply.body.error.message).toContain("no embeddings API");
		expect(transport.calls).toHaveLength(0);
	});

	it("skips an Anthropic-protocol endpoint in a mixed pool", async () => {
		const { api, transport } = await farm(
			{ a: () => ({ body: vector }), b: () => ({ body: vector }) },
			{ a: { backend: "anthropic", models: ["embed-1"] } }
		);
		expect((await api.embeddings.send(ask)).status).toBe(200);
		expect(transport.calls.map((call) => host(call.url))).toEqual(["b"]);
	});

	it("answers 499 aborted when the caller aborts", async () => {
		const controller = new AbortController();
		const { api } = await farm({
			a: (init) => {
				controller.abort(new Error("gone"));
				init.signal.throwIfAborted();
			}
		});
		expect(await api.embeddings.send(ask, { signal: controller.signal })).toMatchObject({
			status: 499,
			body: { error: { code: "aborted" } }
		});
	});
});

describe("POST /v1/embeddings", () => {
	it("serves the route on the OpenAI front with the apiKey, the authorize hook and error shapes", async () => {
		const seen = [];
		const { api, transport } = await farm({ a: () => ({ body: vector }) }, { a: { models: ["embed-1", "embed-2"] } });
		const server = await api.server.start({
			port: 0,
			apiKey: "k",
			authorize: (request) => {
				seen.push(request.route?.model);
				return request.route?.model === "embed-1" ? true : { ok: false, status: 403, message: "model not allowed" };
			}
		});
		const post = (body, headers = { authorization: "Bearer k" }) =>
			fetch(`${server.url}/v1/embeddings`, {
				method: "POST",
				headers: { "content-type": "application/json", ...headers },
				body: JSON.stringify(body)
			});
		const ok = await post(ask);
		expect(ok.status).toBe(200);
		expect(await ok.json()).toEqual(vector);
		expect(JSON.parse(transport.calls[0].init.body)).toEqual(ask);
		const denied = await post({ ...ask, model: "embed-2" });
		expect(denied.status).toBe(403);
		expect((await denied.json()).error.message).toBe("model not allowed");
		const anonymous = await post(ask, {});
		expect(anonymous.status).toBe(401);
		expect((await anonymous.json()).error.type).toBe("authentication_error");
		expect(seen).toEqual(["embed-1", "embed-2"]);
	});

	it("is not served on the Anthropic front", async () => {
		const { api } = await farm({ a: () => ({ body: vector }) }, {}, { front: "anthropic" });
		const server = await api.server.start({ port: 0 });
		const res = await fetch(`${server.url}/v1/embeddings`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
		expect(res.status).toBe(404);
		expect((await res.json()).type).toBe("error");
	});

	it("answers nothing when the client leaves first", async () => {
		const { api } = await farm({
			a: async (init) => {
				await new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
			}
		});
		const server = await api.server.start({ port: 0 });
		const controller = new AbortController();
		const sending = fetch(`${server.url}/v1/embeddings`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(ask),
			signal: controller.signal
		});
		await new Promise((resolve) => setTimeout(resolve, 50));
		controller.abort();
		await expect(sending).rejects.toThrow();
		// The server is still healthy afterwards.
		expect((await fetch(`${server.url}/`)).status).toBe(200);
	});
});

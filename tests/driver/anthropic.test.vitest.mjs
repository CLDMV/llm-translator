/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/driver/anthropic.test.vitest.mjs
 *	@Date: 2026-10-31T14:00:00-07:00 (1793480400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-31T14:00:00-07:00 (1793480400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**

/**
 * @fileoverview Anthropic driver: detection by host and by the Anthropic-shaped `/v1/models` probe, and that no OpenAI-compatible
 * server is ever taken for it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, fakeTransport, make } from "../helpers/translator.mjs";
import * as http from "../../src/lib/http.mjs";

afterEach(closeAll);

const entry = (id) => ({ type: "model", id, display_name: id, created_at: "2025-02-19T00:00:00Z" });
const list = (...ids) => ({ data: ids.map(entry), has_more: false, first_id: ids[0] ?? null, last_id: ids.at(-1) ?? null });
const openai = { object: "list", data: [{ id: "llama3", object: "model", owned_by: "library" }] };

/** A server that answers `/v1/models` with `anthropic` when the Anthropic headers are sent and with `plain` otherwise. */
const server = (anthropic, plain = openai, extra = {}) =>
	fakeTransport((url, init) => {
		const path = new URL(url).pathname;
		if (path === "/v1/models") return { body: init.headers["anthropic-version"] ? anthropic : plain };
		return path in extra ? { body: extra[path] } : { status: 404, body: { error: "not found" } };
	});
const bound = async (transport, upstream = "http://box.test") => {
	const api = await make({ upstreams: [upstream], transport });
	return api.status().upstreams[0];
};

describe("anthropic detection by probe", () => {
	it("binds a self-hosted Anthropic-compatible server and takes its model list", async () => {
		const transport = server(list("claude-local", "claude-other"));
		expect(await bound(transport)).toMatchObject({ driver: "anthropic", models: ["claude-local", "claude-other"] });
		const probe = transport.calls.find((call) => call.init.headers["anthropic-version"]);
		expect(probe.url).toBe("http://box.test/v1/models");
		expect(probe.init.headers["anthropic-version"]).toBe("2023-06-01");
		expect(probe.init.headers.authorization).toBeUndefined();
	});

	it("sends the upstream's key as x-api-key on the probe", async () => {
		const transport = server(list("claude-local"));
		await make({ upstreams: [{ url: "http://box.test", apiKey: "sk-1" }], transport });
		const probe = transport.calls.find((call) => call.init.headers["anthropic-version"]);
		expect(probe.init.headers["x-api-key"]).toBe("sk-1");
		expect(probe.init.headers.authorization).toBeUndefined();
	});

	it("binds a server with an empty model list", async () => {
		expect(await bound(server(list()))).toMatchObject({ driver: "anthropic", models: [] });
	});

	it("asks only one extra request, in the same batch as the other probes", async () => {
		const transport = server(list("claude-local"), openai, { "/props": { build_info: "b1", total_slots: 1 } });
		await bound(transport);
		const paths = transport.calls.map((call) => new URL(call.url).pathname);
		// One bearer `/v1/models` shared by vLLM, llama.cpp and the generic driver, and one with the Anthropic headers.
		expect(paths.filter((path) => path === "/v1/models")).toHaveLength(2);
		expect(paths.filter((path) => path === "/props")).toHaveLength(1);
	});

	it("never binds an OpenAI-shaped answer, whatever headers it is sent", async () => {
		const transport = server(openai);
		expect(await bound(transport)).toMatchObject({ driver: "compatible", models: ["llama3"] });
	});

	// One test per body: each binds a fresh translator, and a single test looping over all of them can outlast the timeout on a busy machine.
	it.each(
		[
			{ ...list("a"), object: "list" },
			{ data: [{ ...entry("a"), type: undefined, object: "model" }], has_more: false, first_id: "a", last_id: "a" },
			{ data: [entry("a")] },
			{ ...list("a"), has_more: "no" },
			{ ...list("a"), first_id: 3 },
			{ ...list("a"), last_id: undefined },
			{ ...list("a"), data: [{ ...entry("a"), display_name: undefined }] },
			{ ...list("a"), data: [{ ...entry("a"), id: 5 }], first_id: "a" },
			{ ...list("a"), data: [null] },
			{ ...list("a", "b"), first_id: "b" },
			{ ...list("a", "b"), last_id: "a" },
			{ ...list(), first_id: "a" },
			{ data: "x", has_more: false, first_id: null, last_id: null },
			[list("a")],
			"text",
			null
			// Wrapped one per row: it.each spreads an array row into arguments, which would unwrap the [list("a")] case.
		].map((body) => [body])
	)("never binds a list that mixes the shapes or is missing a marker (%#)", async (body) => {
		expect((await bound(server(body))).driver).toBe("compatible");
	});

	it("does not bind when the Anthropic probe is refused or the server is down", async () => {
		const refused = fakeTransport((url, init) => (init.headers["anthropic-version"] ? { status: 401, body: list("a") } : { body: openai }));
		expect((await bound(refused)).driver).toBe("compatible");
		const down = fakeTransport(() => {
			throw new Error("down");
		});
		expect(await bound(down)).toMatchObject({ driver: "compatible" });
	});

	it("leaves the OpenAI-compatible backends alone", async () => {
		const ollama = server(openai, openai, { "/api/version": { version: "0.12.3" } });
		expect((await bound(ollama)).driver).toBe("ollama");
		const llama = server(openai, openai, { "/props": { build_info: "b1", total_slots: 1 } });
		expect((await bound(llama)).driver).toBe("llamacpp");
		const sglang = server(openai, { object: "list", data: [{ id: "q", object: "model", owned_by: "sglang" }] });
		expect((await bound(sglang)).driver).toBe("sglang");
		const vllm = server(
			openai,
			{ object: "list", data: [{ id: "q", object: "model", owned_by: "vllm" }] },
			{ "/version": { version: "0.11.0" } }
		);
		const bindVllm = await bound(vllm);
		expect(bindVllm.driver).toBe("vllm");
		expect(vllm.calls.some((call) => call.init.headers["anthropic-version"])).toBe(false);
	});

	it("skips the probe for an explicit backend and when detection is off", async () => {
		const transport = server(list("claude-local"));
		const api = await make({ upstreams: [{ url: "http://box.test", backend: "compatible" }], transport });
		expect(api.status().upstreams[0].driver).toBe("compatible");
		expect(transport.calls).toHaveLength(0);
		const off = await make({ upstreams: ["http://box.test"], transport, detect: false });
		expect(off.status().upstreams[0].driver).toBe("compatible");
		expect(transport.calls).toHaveLength(0);
	});

	it("matches api.anthropic.com by host with no request of its own and does not start the batch", async () => {
		const transport = server(list("claude-x"));
		expect(await bound(transport, "https://api.anthropic.com")).toMatchObject({ driver: "anthropic" });
		const paths = transport.calls.map((call) => new URL(call.url).pathname);
		expect(paths).not.toContain("/props");
		expect(transport.calls.some((call) => call.init.headers["anthropic-version"])).toBe(false);
	});

	it("an endpoint URL that cannot be parsed falls through to the probes", async () => {
		const transport = fakeTransport(() => ({ status: 404, body: {} }));
		const api = await make({ upstreams: [{ url: "not a url", backend: "auto" }], transport });
		expect(api.status().upstreams[0].driver).toBe("compatible");
		expect(await api.driver.anthropic.detect({ endpoint: { url: "nope", headers: {} }, transport })).toBeNull();
	});
});

describe("http.probe with a driver", () => {
	const endpoint = { url: "http://x.test", headers: { "x-extra": "1" }, apiKey: "k" };

	it("shares a plain path but keeps Anthropic-style requests apart", async () => {
		const transport = fakeTransport(() => ({ body: {} }));
		const context = { endpoint, transport, probes: new Map() };
		await Promise.all([
			http.probe(context, "/v1/models"),
			http.probe(context, "/v1/models", { auth: "bearer" }),
			http.probe(context, "/v1/models", { auth: "x-api-key", headers: { "anthropic-version": "1" } }),
			http.probe(context, "/v1/models", { auth: "x-api-key", headers: { "anthropic-version": "1" } })
		]);
		expect(transport.calls).toHaveLength(2);
		expect(transport.calls[0].init.headers.authorization).toBe("Bearer k");
		expect(transport.calls[1].init.headers).toMatchObject({ "x-api-key": "k", "anthropic-version": "1", "x-extra": "1" });
	});

	it("a bearer driver with its own headers is a separate request, and a probe without a cache just runs", async () => {
		const transport = fakeTransport(() => ({ body: {} }));
		const context = { endpoint, transport, probes: new Map() };
		await http.probe(context, "/p");
		await http.probe(context, "/p", { auth: "bearer", headers: { "x-driver": "1" } });
		expect(transport.calls).toHaveLength(2);
		expect(transport.calls[1].init.headers).toMatchObject({ authorization: "Bearer k", "x-driver": "1" });
		await http.probe({ endpoint, transport }, "/p");
		await http.probe({ endpoint, transport }, "/p");
		expect(transport.calls).toHaveLength(4);
	});
});

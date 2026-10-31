/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/server/authorize.test.vitest.mjs
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
 * @fileoverview The `authorize` hook and server-level `onUsage` for `server.start` and `server.plugin`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { closeAll, fakeTransport, make } from "../helpers/translator.mjs";
import { fakeVllm, sse, textChunks } from "../helpers/fake-server.mjs";

afterEach(closeAll);

const hello = { model: "qwen3-coder", max_tokens: 64, messages: [{ role: "user", content: "hi" }] };
const post = (url, body, headers = {}) =>
	fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Start a fake upstream, a translator and a server.
 * @param {object} server - Options for `server.start`.
 * @param {object} [config] - Extra translator config.
 * @returns {Promise<{upstream: any, api: any, server: any}>} Running pieces (the caller closes the upstream).
 */
async function boot(server, config = {}) {
	const upstream = await fakeVllm();
	const api = await make({ upstreams: [upstream.url], ...config });
	return { upstream, api, server: await api.server.start({ port: 0, ...server }) };
}

describe("authorize (anthropic front)", () => {
	it("allows with true and with { ok: true }, and the request reaches the upstream", async () => {
		for (const verdict of [true, { ok: true }]) {
			const { upstream, server } = await boot({ authorize: () => verdict });
			try {
				const reply = await post(`${server.url}/v1/messages`, hello);
				expect(reply.status).toBe(200);
				expect((await reply.json()).type).toBe("message");
			} finally {
				await upstream.close();
			}
		}
	});

	it("refuses in the Anthropic error format: false, sync and async objects, custom status and message", async () => {
		const verdicts = [
			[() => false, 401, "unauthorized"],
			[() => ({ ok: false }), 401, "unauthorized"],
			[() => ({ ok: false, status: 403, message: "model not allowed" }), 403, "model not allowed"],
			[async () => ({ ok: false, status: 429, message: "quota used up" }), 429, "quota used up"],
			[() => ({ ok: false, status: 200, message: "" }), 401, "unauthorized"],
			[() => "yes", 401, "unauthorized"],
			[() => undefined, 401, "unauthorized"],
			[() => ({ ok: "true" }), 401, "unauthorized"]
		];
		for (const [authorize, status, message] of verdicts) {
			const { upstream, server } = await boot({ authorize });
			try {
				const reply = await post(`${server.url}/v1/messages`, hello);
				expect(reply.status).toBe(status);
				const body = await reply.json();
				expect(body.type).toBe("error");
				expect(body.error.message).toBe(message);
				expect(upstream.requests.some((entry) => (JSON.stringify(entry.body) ?? "").includes('"hi"'))).toBe(false);
			} finally {
				await upstream.close();
			}
		}
	});

	it("treats a thrown or rejected hook as a 401 and logs the error", async () => {
		for (const authorize of [
			() => {
				throw new Error("key store down");
			},
			async () => Promise.reject(new Error("key store down"))
		]) {
			const lines = [];
			const stream = { write: (line) => lines.push(line) };
			const { upstream, server } = await boot({ authorize, logger: { level: "error", stream } });
			try {
				const reply = await post(`${server.url}/v1/messages`, hello);
				expect(reply.status).toBe(401);
				expect((await reply.json()).error.message).toBe("unauthorized");
				expect(lines.join("")).toContain("key store down");
			} finally {
				await upstream.close();
			}
		}
	});

	it("shows the hook the method, url, headers, parsed body, front and the resolved route", async () => {
		const seen = [];
		const { upstream, api, server } = await boot(
			{ authorize: (request) => (seen.push(request), true) },
			{ aliases: { opus: "qwen3-coder" } }
		);
		try {
			await post(`${server.url}/v1/messages?beta=true`, { ...hello, model: "opus" }, { "x-tenant": "t1" });
			expect(seen[0]).toMatchObject({ method: "POST", url: "/v1/messages?beta=true", front: "anthropic", body: { model: "opus" } });
			expect(seen[0].headers["x-tenant"]).toBe("t1");
			expect(seen[0].route).toEqual(api.route({ model: "opus" }));
			expect(seen[0].route).toMatchObject({ requested: "opus", model: "qwen3-coder" });
			// GET: no body, no route. A body without a model, and a body that is not an object: no route either; the handler answers.
			await fetch(`${server.url}/v1/models`);
			expect(seen[1]).toMatchObject({ method: "GET", url: "/v1/models", body: undefined, route: null });
			await post(`${server.url}/v1/messages`, { max_tokens: 1, messages: [] });
			expect(seen[2].route).toBeNull();
			const array = await post(`${server.url}/v1/messages`, []);
			expect(seen[3]).toMatchObject({ body: [], route: null });
			expect(array.status).toBe(400);
		} finally {
			await upstream.close();
		}
	});

	it("checks apiKey first, then authorize; public routes skip both", async () => {
		const authorize = vi.fn(() => true);
		const { upstream, server } = await boot({ apiKey: "k", authorize });
		try {
			expect((await post(`${server.url}/v1/messages`, hello)).status).toBe(401);
			expect(authorize).not.toHaveBeenCalled();
			const ok = await post(`${server.url}/v1/messages`, hello, { "x-api-key": "k" });
			expect(ok.status).toBe(200);
			expect(authorize).toHaveBeenCalledTimes(1);
			const refused = await boot({ apiKey: "k", authorize: () => ({ ok: false, status: 403, message: "no" }) });
			try {
				expect((await post(`${refused.server.url}/v1/messages`, hello, { "x-api-key": "k" })).status).toBe(403);
			} finally {
				await refused.upstream.close();
			}
			expect((await fetch(`${server.url}/`)).status).toBe(200);
			expect((await fetch(`${server.url}/api/hello`, { method: "HEAD" })).status).toBe(200);
			expect(authorize).toHaveBeenCalledTimes(1);
		} finally {
			await upstream.close();
		}
	});

	it("passes the hook's context to the server onUsage for JSON and stream replies", async () => {
		const reports = [];
		const { upstream, server } = await boot({
			authorize: (request) => ({ ok: true, context: { key: request.headers["x-key"] } }),
			onUsage: (report, context) => reports.push({ report, context })
		});
		try {
			await (await post(`${server.url}/v1/messages`, hello, { "x-key": "alpha" })).json();
			expect(reports).toHaveLength(1);
			expect(reports[0].context).toEqual({ key: "alpha" });
			expect(reports[0].report).toMatchObject({ reported: true, complete: true, reason: "done", input_tokens: 12, stream: false });
			await (await post(`${server.url}/v1/messages`, { ...hello, stream: true }, { "x-key": "beta" })).text();
			expect(reports).toHaveLength(2);
			expect(reports[1].context).toEqual({ key: "beta" });
			expect(reports[1].report).toMatchObject({ reported: true, complete: true, stream: true, model: "qwen3-coder" });
		} finally {
			await upstream.close();
		}
	});

	it("calls onUsage without a context when there is no authorize hook, and survives a throwing onUsage", async () => {
		const reports = [];
		const { upstream, server } = await boot(
			{
				onUsage: (report, context) => {
					reports.push({ report, context });
					throw new Error("meter down");
				}
			},
			{ silent: true }
		);
		try {
			const reply = await post(`${server.url}/v1/messages`, hello);
			expect(reply.status).toBe(200);
			expect(reports[0].context).toBeUndefined();
		} finally {
			await upstream.close();
		}
	});

	it("reports a request whose client left before the reply, even if the upstream ignores the abort", async () => {
		const reports = [];
		const transport = fakeTransport(async () => {
			await pause(150);
			return new Response("data: [DONE]\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });
		});
		const api = await make({ upstreams: [{ url: "http://a.test", backend: "vllm" }], detect: false, transport });
		const server = await api.server.start({ port: 0, onUsage: (report) => reports.push(report) });
		const controller = new AbortController();
		const pending = fetch(`${server.url}/v1/messages`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ ...hello, stream: true }),
			signal: controller.signal
		});
		await pause(40);
		controller.abort();
		await expect(pending).rejects.toThrow();
		await vi.waitFor(() => expect(reports).toHaveLength(1));
		expect(reports[0]).toMatchObject({ complete: false, reason: "aborted", reported: false });
	});
});

describe("authorize (openai front)", () => {
	it("refuses in the OpenAI error format", async () => {
		const { upstream, server } = await boot({ front: "openai", authorize: () => ({ ok: false, status: 403, message: "nope" }) });
		try {
			const reply = await post(`${server.url}/v1/chat/completions`, hello);
			expect(reply.status).toBe(403);
			expect(await reply.json()).toMatchObject({ error: { message: "nope" } });
			const thrown = await boot({
				front: "openai",
				authorize: () => {
					throw new Error("x");
				}
			});
			try {
				const second = await post(`${thrown.server.url}/v1/chat/completions`, hello);
				expect(second.status).toBe(401);
				expect((await second.json()).error.message).toBe("unauthorized");
			} finally {
				await thrown.upstream.close();
			}
		} finally {
			await upstream.close();
		}
	});

	it("sees the OpenAI front and meters a usage chunk", async () => {
		const seen = [];
		const reports = [];
		const upstream = await fakeVllm({ chat: (_req, body, res) => sse(res, textChunks(["Hi"])) });
		try {
			const api = await make({ upstreams: [upstream.url] });
			const server = await api.server.start({
				port: 0,
				front: "openai",
				authorize: (request) => (seen.push(request.front), { ok: true, context: "ctx" }),
				onUsage: (report, context) => reports.push({ report, context })
			});
			await (await post(`${server.url}/v1/chat/completions`, { ...hello, stream: true, stream_options: { include_usage: true } })).text();
			expect(seen).toEqual(["openai"]);
			expect(reports[0].context).toBe("ctx");
			expect(reports[0].report).toMatchObject({ front: "openai", reported: true, input_tokens: 12, complete: true });
		} finally {
			await upstream.close();
		}
	});
});

describe("authorize on start-up and in the plugin", () => {
	it("a non-loopback bind is accepted with authorize, refused without it", async () => {
		const api = await make({ upstreams: [{ url: "http://a.test", backend: "vllm" }], detect: false });
		await expect(api.server.start({ host: "0.0.0.0", port: 0 })).rejects.toMatchObject({ code: "unauthenticated_bind" });
		await expect(api.server.start({ host: "0.0.0.0", port: 0, authorize: "nope" })).rejects.toMatchObject({ code: "unauthenticated_bind" });
		const handle = await api.server.start({ host: "0.0.0.0", port: 0, authorize: () => true });
		expect(handle.host).toBe("0.0.0.0");
	});

	it("the plugin accepts authorize and onUsage", async () => {
		const upstream = await fakeVllm();
		try {
			const api = await make({ upstreams: [upstream.url] });
			const reports = [];
			const app = Fastify();
			await app.register(api.server.plugin, {
				prefix: "/llm",
				authorize: (request) =>
					request.headers["x-key"] === "good" ? { ok: true, context: "good-key" } : { ok: false, status: 403, message: "bad key" },
				onUsage: (report, context) => reports.push({ report, context })
			});
			await app.ready();
			const denied = await app.inject({ method: "POST", url: "/llm/v1/messages", payload: hello, headers: { "x-key": "bad" } });
			expect(denied.statusCode).toBe(403);
			expect(denied.json()).toMatchObject({ type: "error", error: { message: "bad key" } });
			const ok = await app.inject({ method: "POST", url: "/llm/v1/messages", payload: hello, headers: { "x-key": "good" } });
			expect(ok.statusCode).toBe(200);
			expect(reports[0]).toMatchObject({ context: "good-key", report: { reported: true } });
			expect((await app.inject({ method: "GET", url: "/llm/" })).statusCode).toBe(200);
			await app.close();
		} finally {
			await upstream.close();
		}
	});

	it("the plugin rejects an authorize or onUsage that is not a function", async () => {
		const api = await make({ upstreams: [{ url: "http://a.test", backend: "vllm" }], detect: false });
		for (const options of [{ authorize: "yes" }, { onUsage: {} }]) {
			const app = Fastify();
			await expect(app.register(api.server.plugin, options)).rejects.toMatchObject({ code: "invalid_config" });
		}
	});
});

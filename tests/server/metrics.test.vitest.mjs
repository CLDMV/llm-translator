/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/server/metrics.test.vitest.mjs
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
 * @fileoverview `GET /metrics`: off by default, authentication, exposition format and counters after mocked requests.
 */
import { afterEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { closeAll, make } from "../helpers/translator.mjs";
import { fakeVllm, json, sse, textChunks } from "../helpers/fake-server.mjs";

afterEach(closeAll);

const hello = { model: "qwen3-coder", max_tokens: 64, messages: [{ role: "user", content: "hi" }] };
const post = (url, body, headers = {}) =>
	fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Scrape until `predicate(text)` holds (recording happens when a response closes, just after the client has the reply).
 * @param {string} url - Server URL.
 * @param {(text: string) => boolean} predicate - Condition.
 * @param {Record<string, string>} [headers] - Request headers.
 * @returns {Promise<string>} The text that satisfied it.
 */
async function scrape(url, predicate, headers = {}) {
	let text = "";
	for (let attempt = 0; attempt < 100; attempt++) {
		text = await (await fetch(`${url}/metrics`, { headers })).text();
		if (predicate(text)) return text;
		await pause(20);
	}
	throw new Error(`metrics never matched:\n${text}`);
}

const sample = (text, name) => text.split("\n").filter((line) => line.startsWith(`${name}{`) || line.startsWith(`${name} `));

/**
 * Start a fake upstream, a translator and a server.
 * @param {object} server - Options for `server.start`.
 * @param {object} [upstreamOptions] - Options for the fake upstream.
 * @param {object} [config] - Extra translator config.
 * @returns {Promise<{upstream: any, api: any, server: any}>} Running pieces.
 */
async function boot(server, upstreamOptions = {}, config = {}) {
	const upstream = await fakeVllm(upstreamOptions);
	const api = await make({ upstreams: [{ name: "gpu", url: upstream.url }], ...config });
	return { upstream, api, server: await api.server.start({ port: 0, ...server }) };
}

describe("metrics off (default)", () => {
	it("answers 404 in the client error shape, like any unknown route", async () => {
		const { upstream, server } = await boot({});
		try {
			const reply = await fetch(`${server.url}/metrics`);
			expect(reply.status).toBe(404);
			expect((await reply.json()).type).toBe("error");
		} finally {
			await upstream.close();
		}
	});
});

describe("metrics on", () => {
	it("serves the text format with the right content type and HELP/TYPE lines", async () => {
		const { upstream, server } = await boot({ metrics: true });
		try {
			const reply = await fetch(`${server.url}/metrics`);
			expect(reply.status).toBe(200);
			expect(reply.headers.get("content-type")).toBe("text/plain; version=0.0.4; charset=utf-8");
			const text = await reply.text();
			expect(text.endsWith("\n")).toBe(true);
			for (const [name, type] of [
				["llm_translator_requests_total", "counter"],
				["llm_translator_request_duration_seconds", "histogram"],
				["llm_translator_tokens_total", "counter"],
				["llm_translator_errors_total", "counter"],
				["llm_translator_upstream_up", "gauge"]
			]) {
				expect(text).toContain(`# TYPE ${name} ${type}\n`);
				expect(text).toMatch(new RegExp(`# HELP ${name} .+\\n# TYPE ${name} `));
			}
			expect(text).toContain('llm_translator_upstream_up{upstream="gpu",driver="vllm"} 1');
		} finally {
			await upstream.close();
		}
	});

	it("counts a JSON request with its tokens and duration, and does not count scrapes", async () => {
		const { upstream, server } = await boot({ metrics: true });
		try {
			expect((await post(`${server.url}/v1/messages`, hello)).status).toBe(200);
			const text = await scrape(server.url, (body) => body.includes("llm_translator_requests_total{"));
			expect(sample(text, "llm_translator_requests_total")).toEqual([
				'llm_translator_requests_total{front="anthropic",route="/v1/messages",driver="vllm",code="200"} 1'
			]);
			expect(text).toContain('llm_translator_tokens_total{driver="vllm",type="input"} 12');
			expect(text).toContain('llm_translator_tokens_total{driver="vllm",type="output"} 4');
			const labels = 'front="anthropic",route="/v1/messages",driver="vllm",code="200"';
			expect(text).toContain(`llm_translator_request_duration_seconds_count{${labels}} 1`);
			expect(text).toContain(`llm_translator_request_duration_seconds_bucket{${labels},le="+Inf"} 1`);
			expect(text).toMatch(new RegExp(`llm_translator_request_duration_seconds_sum\\{${labels.replace(/"/g, '"')}\\} [0-9.e-]+`));
			expect(sample(text, "llm_translator_errors_total")).toEqual([]);
			expect(text).not.toContain('route="/metrics"');
		} finally {
			await upstream.close();
		}
	});

	it("measures a streamed request to the end of the response", async () => {
		const { upstream, server } = await boot(
			{ metrics: true },
			{ chat: (_req, body, res) => sse(res, textChunks(["a", "b", "c"]), { delay: 60 }) }
		);
		try {
			const reply = await post(`${server.url}/v1/messages`, { ...hello, stream: true });
			expect(reply.status).toBe(200);
			await reply.text();
			const text = await scrape(server.url, (body) => body.includes("llm_translator_tokens_total{"));
			const labels = 'front="anthropic",route="/v1/messages",driver="vllm",code="200"';
			expect(text).toContain(`llm_translator_requests_total{${labels}} 1`);
			expect(text).toContain('llm_translator_tokens_total{driver="vllm",type="output"} 4');
			const sum = Number(text.match(new RegExp(`llm_translator_request_duration_seconds_sum\\{${labels}\\} (\\S+)`))[1]);
			expect(sum).toBeGreaterThan(0.15);
		} finally {
			await upstream.close();
		}
	});

	it("counts an upstream error as an upstream error and a 5xx marks the upstream down", async () => {
		const { upstream, server } = await boot(
			{ metrics: true },
			{ chat: (_req, _body, res) => json(res, 500, { error: { message: "boom" } }) }
		);
		try {
			expect((await post(`${server.url}/v1/messages`, hello)).status).toBeGreaterThanOrEqual(500);
			const text = await scrape(server.url, (body) => body.includes("llm_translator_errors_total{"));
			expect(sample(text, "llm_translator_errors_total")).toEqual(['llm_translator_errors_total{kind="upstream"} 1']);
			expect(text).toMatch(/llm_translator_requests_total\{front="anthropic",route="\/v1\/messages",driver="vllm",code="5\d\d"\} 1/);
			expect(text).toContain('llm_translator_upstream_up{upstream="gpu",driver="vllm"} 0');
		} finally {
			await upstream.close();
		}
	});

	it("counts refused requests as client errors with no driver", async () => {
		const { upstream, server } = await boot({ metrics: true });
		try {
			expect((await post(`${server.url}/v1/messages`, [])).status).toBe(400);
			const text = await scrape(server.url, (body) => body.includes("llm_translator_errors_total{"));
			expect(sample(text, "llm_translator_errors_total")).toEqual(['llm_translator_errors_total{kind="client"} 1']);
			expect(text).toContain('driver="none",code="400"');
			expect(text).not.toContain("llm_translator_tokens_total{");
		} finally {
			await upstream.close();
		}
	});

	it("records a client that leaves mid-stream as 499, not as an error", async () => {
		const { upstream, server } = await boot(
			{ metrics: true },
			{ chat: (_req, _body, res) => sse(res, textChunks(["a", "b", "c", "d"]), { delay: 200 }) }
		);
		try {
			const controller = new AbortController();
			const reply = await fetch(`${server.url}/v1/messages`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ ...hello, stream: true }),
				signal: controller.signal
			});
			await reply.body.getReader().read();
			controller.abort();
			const text = await scrape(server.url, (body) => body.includes('code="499"'));
			expect(text).toContain('route="/v1/messages"');
			expect(sample(text, "llm_translator_errors_total")).toEqual([]);
		} finally {
			await upstream.close();
		}
	});

	it("labels the OpenAI front and embeddings by route, and counts the model list", async () => {
		const { upstream, server } = await boot({ metrics: true, front: "openai" });
		try {
			await fetch(`${server.url}/v1/models`);
			await post(`${server.url}/v1/chat/completions`, { model: "qwen3-coder", messages: [{ role: "user", content: "hi" }] });
			await post(`${server.url}/v1/embeddings`, { model: "nope", input: "x" });
			const text = await scrape(server.url, (body) => body.includes('route="/v1/embeddings"'));
			expect(text).toContain('front="openai",route="/v1/models",driver="none",code="200"');
			expect(text).toContain('front="openai",route="/v1/chat/completions",driver="vllm",code="200"');
			expect(text).toMatch(/front="openai",route="\/v1\/embeddings",driver="none",code="4\d\d"/);
		} finally {
			await upstream.close();
		}
	});

	it("keeps labels bounded: the requested model, unknown paths and the key never appear", async () => {
		const { upstream, server } = await boot({ metrics: true, apiKey: "sk-secret" });
		try {
			await post(`${server.url}/v1/messages`, { ...hello, model: "made-up-model" }, { "x-api-key": "sk-secret" });
			const text = await scrape(server.url, (body) => body.includes("llm_translator_requests_total{"), { "x-api-key": "sk-secret" });
			expect(text).not.toContain("made-up-model");
			expect(text).not.toContain("sk-secret");
		} finally {
			await upstream.close();
		}
	});

	it("follows the server's authentication: apiKey and authorize apply to /metrics", async () => {
		const { upstream, server } = await boot({ metrics: true, apiKey: "k1" });
		try {
			expect((await fetch(`${server.url}/metrics`)).status).toBe(401);
			expect((await fetch(`${server.url}/metrics`, { headers: { "x-api-key": "bad" } })).status).toBe(401);
			expect((await fetch(`${server.url}/metrics`, { headers: { authorization: "Bearer k1" } })).status).toBe(200);
			// The refused scrapes are not counted, a refused API request is.
			await post(`${server.url}/v1/messages`, hello);
			const text = await scrape(server.url, (body) => body.includes('code="401"'), { "x-api-key": "k1" });
			expect(text).toContain('route="/v1/messages",driver="none",code="401"');
		} finally {
			await upstream.close();
		}
		const seen = [];
		const hooked = await boot({
			metrics: true,
			authorize: (request) => {
				seen.push(request.url);
				return request.headers["x-ok"] === "1";
			}
		});
		try {
			expect((await fetch(`${hooked.server.url}/metrics`)).status).toBe(401);
			expect((await fetch(`${hooked.server.url}/metrics`, { headers: { "x-ok": "1" } })).status).toBe(200);
			expect(seen).toEqual(["/metrics", "/metrics"]);
		} finally {
			await hooked.upstream.close();
		}
	});

	it("works as a plugin under a prefix and does not count its own scrapes", async () => {
		const upstream = await fakeVllm();
		const api = await make({ upstreams: [{ name: "gpu", url: upstream.url }] });
		const app = Fastify();
		await app.register(api.server.plugin, { prefix: "/llm", metrics: true });
		await app.listen({ port: 0, host: "127.0.0.1" });
		const url = `http://127.0.0.1:${app.server.address().port}/llm`;
		try {
			expect((await post(`${url}/v1/messages`, hello)).status).toBe(200);
			const text = await (async () => {
				for (let attempt = 0; attempt < 100; attempt++) {
					const body = await (await fetch(`${url}/metrics`)).text();
					if (body.includes("requests_total{")) return body;
					await pause(20);
				}
				throw new Error("never recorded");
			})();
			expect(sample(text, "llm_translator_requests_total")).toEqual([
				'llm_translator_requests_total{front="anthropic",route="/llm/v1/messages",driver="vllm",code="200"} 1'
			]);
		} finally {
			await app.close();
			await upstream.close();
		}
	});

	it("rejects a non-boolean metrics option on the plugin", async () => {
		const upstream = await fakeVllm();
		try {
			const api = await make({ upstreams: [upstream.url] });
			const app = Fastify();
			app.register(api.server.plugin, { metrics: "yes" });
			await expect(app.ready()).rejects.toThrow(/metrics must be true or false/);
			await app.close();
		} finally {
			await upstream.close();
		}
	});
});

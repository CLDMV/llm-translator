/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/server/hardening.test.vitest.mjs
 *	@Date: 2026-11-17T09:00:00-08:00 (1794934800)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-17T09:00:00-08:00 (1794934800)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Optional server hardening: TLS, per-client rate limits and CORS.
 */
import { afterEach, describe, expect, it } from "vitest";
import https from "node:https";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { closeAll, make } from "../helpers/translator.mjs";
import { fakeVllm } from "../helpers/fake-server.mjs";
import * as guard from "../../src/lib/guard.mjs";

afterEach(closeAll);

// The key and certificate are a throwaway self-signed pair made for these tests (CN=localhost); they protect nothing.
const key = fileURLToPath(new URL("../fixtures/tls/key.pem", import.meta.url));
const cert = fileURLToPath(new URL("../fixtures/tls/cert.pem", import.meta.url));

const hello = { model: "qwen3-coder", max_tokens: 64, messages: [{ role: "user", content: "hi" }] };
const post = (url, body, headers = {}) =>
	fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

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

/**
 * GET over HTTPS, trusting the test certificate.
 * @param {string} url - Server URL.
 * @param {string} [path] - Request path.
 * @returns {Promise<{status: number, body: string}>} Reply.
 */
const secureGet = (url, path = "/") =>
	new Promise((resolve, reject) => {
		https
			.get(`${url}${path}`, { ca: readFileSync(cert) }, (res) => {
				const chunks = [];
				res.on("data", (chunk) => chunks.push(chunk));
				res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
			})
			.on("error", reject);
	});

describe("TLS", () => {
	it("serves HTTPS when key and cert are set", async () => {
		const { upstream, server } = await boot({ tls: { key, cert } });
		try {
			expect(server.url.startsWith("https://127.0.0.1:")).toBe(true);
			expect((await secureGet(server.url)).status).toBe(200);
			await expect(fetch(server.url)).rejects.toThrow();
		} finally {
			await upstream.close();
		}
	});

	it("takes a CA list and a passphrase", async () => {
		const { upstream, server } = await boot({ tls: { key, cert, ca: [cert], passphrase: "unused" } });
		try {
			expect((await secureGet(server.url)).status).toBe(200);
		} finally {
			await upstream.close();
		}
	});

	it("stays on plain HTTP without a tls option, or with an empty one", async () => {
		const { upstream, server } = await boot({ tls: {} });
		try {
			expect(server.url.startsWith("http://")).toBe(true);
			expect((await fetch(server.url)).status).toBe(200);
		} finally {
			await upstream.close();
		}
	});

	it("refuses to start with only one of key and cert", async () => {
		const upstream = await fakeVllm();
		const api = await make({ upstreams: [upstream.url] });
		try {
			await expect(api.server.start({ port: 0, tls: { key } })).rejects.toThrow(/tls needs both key and cert \(got key only\)/);
			await expect(api.server.start({ port: 0, tls: { cert } })).rejects.toThrow(/got cert only/);
			await expect(api.server.start({ port: 0, tls: { ca: cert } })).rejects.toThrow(/needs both key and cert/);
		} finally {
			await upstream.close();
		}
	});

	it("refuses files it cannot read and values of the wrong type", async () => {
		const upstream = await fakeVllm();
		const api = await make({ upstreams: [upstream.url] });
		try {
			await expect(api.server.start({ port: 0, tls: { key: "/no/such/key.pem", cert } })).rejects.toThrow(
				/tls\.key: cannot read \/no\/such\/key\.pem \(ENOENT\)/
			);
			await expect(api.server.start({ port: 0, tls: { key, cert: "/no/such/cert.pem" } })).rejects.toThrow(/tls\.cert: cannot read/);
			await expect(api.server.start({ port: 0, tls: { key, cert, ca: "/no/such/ca.pem" } })).rejects.toThrow(/tls\.ca: cannot read/);
			await expect(api.server.start({ port: 0, tls: { key: 5, cert } })).rejects.toThrow(/tls\.key must be a file path/);
			await expect(api.server.start({ port: 0, tls: { key, cert, passphrase: 5 } })).rejects.toThrow(/tls\.passphrase must be a string/);
			await expect(api.server.start({ port: 0, tls: "yes" })).rejects.toThrow(/tls must be an object/);
			await expect(api.server.start({ port: 0, tls: [key, cert] })).rejects.toThrow(/tls must be an object/);
		} finally {
			await upstream.close();
		}
	});
});

describe("rate limit", () => {
	it("answers 429 with retry-after in the Anthropic error shape once a key is over its limit", async () => {
		const { upstream, server } = await boot({ apiKey: ["alpha", "beta"], rateLimit: { requests: 2, windowMs: 30000 } });
		try {
			const send = (k) => post(`${server.url}/v1/messages`, hello, { "x-api-key": k });
			expect((await send("alpha")).status).toBe(200);
			expect((await send("alpha")).status).toBe(200);
			const refused = await send("alpha");
			expect(refused.status).toBe(429);
			const wait = Number(refused.headers.get("retry-after"));
			expect(wait).toBeGreaterThanOrEqual(1);
			expect(wait).toBeLessThanOrEqual(30);
			expect(await refused.json()).toMatchObject({ type: "error", error: { type: "rate_limit_error", message: "rate limit exceeded" } });
			// Another key has its own bucket, the same key as a bearer token shares the first one, and the open routes are not counted.
			expect((await send("beta")).status).toBe(200);
			expect((await post(`${server.url}/v1/messages`, hello, { authorization: "Bearer alpha" })).status).toBe(429);
			expect((await fetch(`${server.url}/`)).status).toBe(200);
		} finally {
			await upstream.close();
		}
	});

	it("answers in the OpenAI error shape on the OpenAI front", async () => {
		const { upstream, server } = await boot({ front: "openai", rateLimit: { requests: 1 } }, { front: "openai" });
		try {
			const send = () => post(`${server.url}/v1/chat/completions`, hello);
			expect((await send()).status).toBe(200);
			const refused = await send();
			expect(refused.status).toBe(429);
			expect(refused.headers.get("retry-after")).toBe("60");
			expect((await refused.json()).error).toMatchObject({ message: "rate limit exceeded" });
		} finally {
			await upstream.close();
		}
	});

	it("counts requests without a known key by remote address, so made-up keys do not get fresh buckets", async () => {
		const { upstream, server } = await boot({ apiKey: "real", rateLimit: { requests: 2, windowMs: 30000 } });
		try {
			const bad = (k) => post(`${server.url}/v1/messages`, hello, { "x-api-key": k });
			expect((await bad("a")).status).toBe(401);
			expect((await bad("b")).status).toBe(401);
			expect((await bad("c")).status).toBe(429);
			// The caller's real key is a different bucket from its address.
			expect((await bad("real")).status).toBe(200);
		} finally {
			await upstream.close();
		}
	});

	it("counts by remote address when auth is off, and lets the window start over", async () => {
		const { upstream, server } = await boot({ rateLimit: { requests: 1, windowMs: 1000 } });
		try {
			expect((await post(`${server.url}/v1/messages`, hello, { "x-api-key": "made-up-1" })).status).toBe(200);
			expect((await post(`${server.url}/v1/messages`, hello, { "x-api-key": "made-up-2" })).status).toBe(429);
			await new Promise((resolve) => setTimeout(resolve, 1100));
			expect((await post(`${server.url}/v1/messages`, hello)).status).toBe(200);
		} finally {
			await upstream.close();
		}
	});

	it("is off by default and refuses bad values", async () => {
		const { upstream, api, server } = await boot({});
		try {
			for (let i = 0; i < 5; i++) expect((await post(`${server.url}/v1/messages`, hello)).status).toBe(200);
			for (const rateLimit of [
				{},
				{ requests: 0 },
				{ requests: 1.5 },
				{ requests: "5" },
				{ requests: 1, windowMs: 0 },
				{ requests: 1, windowMs: "x" }
			]) {
				await expect(api.server.start({ port: 0, rateLimit })).rejects.toThrow(/Invalid|rateLimit\./);
			}
		} finally {
			await upstream.close();
		}
	});
});

describe("limiter", () => {
	it("evicts stale buckets while requests keep coming, without any timer", () => {
		let at = 0;
		const limit = guard.rateLimit({ requests: 1, windowMs: 1000 }, () => at);
		for (let i = 0; i < 50; i++) expect(limit.take(`ip:${i}`)).toBe(0);
		expect(limit.size()).toBe(50);
		expect(limit.take("ip:0")).toBe(1);
		at = 1500;
		expect(limit.take("ip:fresh")).toBe(0);
		expect(limit.size()).toBe(1);
		expect(limit.take("ip:fresh")).toBe(1);
		at = 1999;
		expect(limit.take("ip:fresh")).toBe(1);
		at = 2500;
		expect(limit.take("ip:fresh")).toBe(0);
	});

	it("rounds the wait up to whole seconds, never below one", () => {
		let at = 0;
		const limit = guard.rateLimit({ requests: 1, windowMs: 2500 }, () => at);
		limit.take("k");
		at = 100;
		expect(limit.take("k")).toBe(3);
		at = 2499;
		expect(limit.take("k")).toBe(1);
		expect(guard.rateLimit(undefined)).toBeNull();
		expect(guard.rateLimit(null)).toBeNull();
		expect(guard.rateLimit(false)).toBeNull();
	});
});

describe("CORS", () => {
	const allowed = "https://app.example.com";

	it("adds the allow headers and vary to replies for an allowed origin, errors and streams included", async () => {
		const { upstream, server } = await boot({ apiKey: "k", cors: [allowed] });
		try {
			const ok = await post(`${server.url}/v1/messages`, hello, { "x-api-key": "k", origin: allowed });
			expect(ok.status).toBe(200);
			expect(ok.headers.get("access-control-allow-origin")).toBe(allowed);
			expect(ok.headers.get("vary")).toBe("origin");
			expect(ok.headers.get("access-control-expose-headers")).toContain("retry-after");
			const stream = await post(
				`${server.url}/v1/messages`,
				{ ...hello, stream: true },
				{ "x-api-key": "k", origin: "https://APP.example.com/" }
			);
			expect(stream.headers.get("content-type")).toContain("text/event-stream");
			expect(stream.headers.get("access-control-allow-origin")).toBe("https://APP.example.com/");
			await stream.text();
			const denied = await post(`${server.url}/v1/messages`, hello, { origin: allowed });
			expect(denied.status).toBe(401);
			expect(denied.headers.get("access-control-allow-origin")).toBe(allowed);
		} finally {
			await upstream.close();
		}
	});

	it("also covers a 429, so a browser can read retry-after", async () => {
		const { upstream, server } = await boot({ cors: [allowed], rateLimit: { requests: 1 } });
		try {
			await post(`${server.url}/v1/messages`, hello, { origin: allowed });
			const refused = await post(`${server.url}/v1/messages`, hello, { origin: allowed });
			expect(refused.status).toBe(429);
			expect(refused.headers.get("access-control-allow-origin")).toBe(allowed);
		} finally {
			await upstream.close();
		}
	});

	it("gives a disallowed origin no CORS headers, and leaves requests without an Origin alone", async () => {
		const { upstream, server } = await boot({ cors: [allowed] });
		try {
			const other = await post(`${server.url}/v1/messages`, hello, { origin: "https://evil.example.com" });
			expect(other.status).toBe(200);
			expect(other.headers.get("access-control-allow-origin")).toBeNull();
			expect(other.headers.get("vary")).toBe("origin");
			const none = await post(`${server.url}/v1/messages`, hello);
			expect(none.status).toBe(200);
			expect(none.headers.get("access-control-allow-origin")).toBeNull();
			expect(none.headers.get("vary")).toBeNull();
		} finally {
			await upstream.close();
		}
	});

	it("answers a preflight with 204 and the allowed methods and headers, without a key and outside the rate limit", async () => {
		const { upstream, server } = await boot({ apiKey: "k", cors: { origins: [allowed] }, rateLimit: { requests: 1 } });
		try {
			for (let i = 0; i < 3; i++) {
				const reply = await fetch(`${server.url}/v1/messages`, {
					method: "OPTIONS",
					headers: { origin: allowed, "access-control-request-method": "POST" }
				});
				expect(reply.status).toBe(204);
				expect(reply.headers.get("access-control-allow-origin")).toBe(allowed);
				expect(reply.headers.get("access-control-allow-methods")).toBe("GET, HEAD, POST, OPTIONS");
				const headers = reply.headers.get("access-control-allow-headers");
				for (const name of ["authorization", "x-api-key", "content-type", "anthropic-version", "anthropic-beta"])
					expect(headers).toContain(name);
				expect(reply.headers.get("vary")).toBe("origin");
			}
			const echoed = await fetch(`${server.url}/`, {
				method: "OPTIONS",
				headers: { origin: allowed, "access-control-request-headers": "x-stainless-os, content-type" }
			});
			expect(echoed.status).toBe(204);
			expect(echoed.headers.get("access-control-allow-headers")).toBe("x-stainless-os, content-type");
		} finally {
			await upstream.close();
		}
	});

	it("gives a preflight from a disallowed origin (or without one) no CORS headers", async () => {
		const { upstream, server } = await boot({ cors: [allowed] });
		try {
			const bad = await fetch(`${server.url}/v1/messages`, { method: "OPTIONS", headers: { origin: "https://evil.example.com" } });
			expect(bad.status).toBe(204);
			expect(bad.headers.get("access-control-allow-origin")).toBeNull();
			expect(bad.headers.get("access-control-allow-methods")).toBeNull();
			const plain = await fetch(`${server.url}/v1/messages`, { method: "OPTIONS" });
			expect(plain.status).toBe(204);
			expect(plain.headers.get("access-control-allow-origin")).toBeNull();
		} finally {
			await upstream.close();
		}
	});

	it("allows every origin with *", async () => {
		const { upstream, server } = await boot({ cors: ["*"] });
		try {
			const reply = await post(`${server.url}/v1/messages`, hello, { origin: "https://anything.example.net" });
			expect(reply.headers.get("access-control-allow-origin")).toBe("*");
			const preflight = await fetch(`${server.url}/v1/messages`, { method: "OPTIONS", headers: { origin: "http://localhost:5173" } });
			expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
		} finally {
			await upstream.close();
		}
	});

	it("is off by default: an OPTIONS request stays a 404 without CORS headers", async () => {
		const { upstream, server } = await boot({});
		try {
			const reply = await fetch(`${server.url}/v1/messages`, { method: "OPTIONS", headers: { origin: allowed } });
			expect(reply.status).toBe(404);
			expect(reply.headers.get("access-control-allow-origin")).toBeNull();
		} finally {
			await upstream.close();
		}
	});

	it("accepts a single origin string and refuses bad lists", async () => {
		const { upstream, api, server } = await boot({ cors: allowed });
		try {
			const reply = await post(`${server.url}/v1/messages`, hello, { origin: allowed });
			expect(reply.headers.get("access-control-allow-origin")).toBe(allowed);
			for (const cors of [[""], [5], ["*", null]])
				await expect(api.server.start({ port: 0, cors })).rejects.toThrow(/cors origins must be non-empty strings/);
			expect(guard.cors([])).toBeNull();
			expect(guard.cors({})).toBeNull();
			expect(guard.cors(null)).toBeNull();
			expect(guard.cors(false)).toBeNull();
		} finally {
			await upstream.close();
		}
	});
});

describe("all three together", () => {
	it("serves HTTPS with CORS and a limit", async () => {
		const { upstream, server } = await boot({ tls: { key, cert }, cors: ["*"], rateLimit: { requests: 5 } });
		try {
			const reply = await new Promise((resolve, reject) => {
				https
					.get(`${server.url}/`, { ca: readFileSync(cert), headers: { origin: "https://x.example" } }, (res) => {
						res.resume();
						resolve(res.headers);
					})
					.on("error", reject);
			});
			expect(reply["access-control-allow-origin"]).toBe("*");
		} finally {
			await upstream.close();
		}
	});
});

describe("with metrics", () => {
	it("counts a refused 429, skips preflights, and never rate limits the scrape", async () => {
		const origin = "https://app.example.com";
		const { upstream, server } = await boot({ apiKey: "k", metrics: true, cors: [origin], rateLimit: { requests: 2, windowMs: 30000 } });
		try {
			const headers = { "x-api-key": "k", origin };
			expect((await post(`${server.url}/v1/messages`, hello, headers)).status).toBe(200);
			expect((await post(`${server.url}/v1/messages`, hello, headers)).status).toBe(200);
			const refused = await post(`${server.url}/v1/messages`, hello, headers);
			expect(refused.status).toBe(429);
			expect(refused.headers.get("access-control-allow-origin")).toBe(origin);
			expect((await fetch(`${server.url}/v1/messages`, { method: "OPTIONS", headers: { origin } })).status).toBe(204);
			let text = "";
			for (let attempt = 0; attempt < 100; attempt++) {
				const scrape = await fetch(`${server.url}/metrics`, { headers: { "x-api-key": "k" } });
				expect(scrape.status).toBe(200);
				text = await scrape.text();
				if (text.includes('code="429"') && text.includes('code="200"')) break;
				await new Promise((resolve) => setTimeout(resolve, 20));
			}
			expect(text).toMatch(/llm_translator_requests_total\{[^}]*route="\/v1\/messages"[^}]*code="429"\} 1/);
			expect(text).toMatch(/llm_translator_requests_total\{[^}]*route="\/v1\/messages"[^}]*code="200"\} 2/);
			expect(text).not.toContain('route="/*"');
			expect(text).not.toContain('code="204"');
			expect(text).not.toContain('route="/metrics"');
		} finally {
			await upstream.close();
		}
	});
});

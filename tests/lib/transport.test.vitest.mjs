import http from "node:http";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { transport } from "../../src/lib/transport.mjs";

let server;
let base;
const seen = [];

beforeAll(async () => {
	server = http.createServer((req, res) => {
		const chunks = [];
		req.on("data", (c) => chunks.push(c));
		req.on("end", () => {
			const body = Buffer.concat(chunks).toString();
			seen.push({ method: req.method, url: req.url, headers: req.headers, body });
			if (req.url === "/json") {
				res.writeHead(200, { "content-type": "application/json", "set-cookie": ["a=1", "b=2"] });
				res.end(JSON.stringify({ echo: body }));
			} else if (req.url === "/stream") {
				res.writeHead(200, { "content-type": "text/event-stream" });
				res.write("data: one\n\n");
				setTimeout(() => res.end("data: two\n\n"), 20);
			} else if (req.url === "/empty") {
				res.writeHead(204);
				res.end();
			} else if (req.url === "/redirect") {
				res.writeHead(302, { location: "http://127.0.0.1:1/elsewhere" });
				res.end();
			} else if (req.url === "/nolocation") {
				res.writeHead(301);
				res.end();
			} else if (req.url === "/hang") {
				res.writeHead(200);
				res.write("partial");
			} else if (req.url === "/silent") {
				// never answers
			} else {
				res.writeHead(500);
				res.end("boom");
			}
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
	server.closeAllConnections();
	await new Promise((resolve) => server.close(resolve));
});

describe("transport", () => {
	test("GET with defaults: identity encoding, parsed JSON, repeated headers", async () => {
		const res = await transport(`${base}/json`);
		expect(res.ok).toBe(true);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ echo: "" });
		expect(res.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
		expect(seen.at(-1)).toMatchObject({ method: "GET", headers: { "accept-encoding": "identity", connection: "close" } });
		expect(seen.at(-1).headers).not.toHaveProperty("content-length");
	});

	test("POST sends the body with a content-length and the given headers", async () => {
		const res = await transport(new URL(`${base}/json`), {
			method: "POST",
			headers: { "x-test": "1", "accept-encoding": "gzip" },
			body: "héllo"
		});
		expect((await res.json()).echo).toBe("héllo");
		expect(seen.at(-1).headers).toMatchObject({
			"x-test": "1",
			"content-length": String(Buffer.byteLength("héllo")),
			"accept-encoding": "gzip"
		});
	});

	test("error statuses are returned, not thrown; redirects are not followed", async () => {
		const failed = await transport(`${base}/other`);
		expect(failed.ok).toBe(false);
		expect(await failed.text()).toBe("boom");
		const moved = await transport(`${base}/redirect`);
		expect(moved.status).toBe(302);
		expect(moved.headers.get("location")).toBe("http://127.0.0.1:1/elsewhere");
		await expect(transport(`${base}/redirect`, { redirect: "error" })).rejects.toThrow(
			/unexpected redirect to http:\/\/127.0.0.1:1\/elsewhere/
		);
		expect((await transport(`${base}/empty`, { redirect: "error" })).status).toBe(204);
		expect((await transport(`${base}/nolocation`, { redirect: "error" })).status).toBe(301);
	});

	test("the body is a web stream delivered incrementally", async () => {
		const res = await transport(`${base}/stream`);
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		const parts = [];
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			parts.push(decoder.decode(value));
		}
		expect(parts.join("")).toBe("data: one\n\ndata: two\n\n");
	});

	test("responses without a body", async () => {
		const res = await transport(`${base}/empty`);
		expect(res.status).toBe(204);
		expect(res.body).toBeNull();
	});

	test("connection failures reject with the underlying error", async () => {
		await expect(transport("http://127.0.0.1:1/")).rejects.toMatchObject({ code: "ECONNREFUSED" });
	});

	test("aborting before the request, while waiting for headers, and while streaming", async () => {
		const early = AbortSignal.abort(new Error("early"));
		await expect(transport(`${base}/json`, { signal: early })).rejects.toThrow("early");

		const controller = new AbortController();
		const waiting = transport(`${base}/silent`, { signal: controller.signal });
		setTimeout(() => controller.abort(new Error("while waiting")), 30);
		await expect(waiting).rejects.toThrow("while waiting");

		const second = new AbortController();
		const res = await transport(`${base}/hang`, { signal: second.signal });
		const reader = res.body.getReader();
		expect((await reader.read()).done).toBe(false);
		second.abort(new Error("while streaming"));
		await expect(reader.read()).rejects.toThrow("while streaming");
	});

	test("https URLs use the https module", async () => {
		const calls = [];
		const fakeHttps = {
			request: (target, options, callback) => (calls.push(target.protocol), http.request(`${base}/json`, options, callback))
		};
		const res = await transport("https://example.invalid/json", {}, { http, https: fakeHttps });
		expect(calls).toEqual(["https:"]);
		expect(res.status).toBe(200);
	});
});

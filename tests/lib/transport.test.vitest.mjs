/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/transport.test.vitest.mjs
 *	@Date: 2026-10-25T21:38:02-07:00 (1792989482)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-26T15:39:11-07:00 (1793054351)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import http from "node:http";
import { EventEmitter } from "node:events";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
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

describe("transport connect timeout", () => {
	afterEach(() => vi.useRealTimers());

	/** Fake protocol modules whose request emits `socket` with the given socket and records its destruction. */
	const fake = (socket) => {
		const request = Object.assign(new EventEmitter(), {
			end: () => request.emit("socket", socket),
			destroy: (error) => {
				request.emit("error", error);
				request.emit("close");
			}
		});
		return { http: { request: () => request }, https: { request: () => request } };
	};

	test("rejects when the connection is not made in time", async () => {
		vi.useFakeTimers();
		const socket = Object.assign(new EventEmitter(), { connecting: true });
		const pending = transport("http://host.test/", { connectTimeout: 500 }, fake(socket));
		const rejected = expect(pending).rejects.toThrow("connect timeout after 500 ms");
		await vi.advanceTimersByTimeAsync(500);
		await rejected;
	});

	test("stops the timer once connected", async () => {
		vi.useFakeTimers();
		const socket = Object.assign(new EventEmitter(), { connecting: true });
		const modules = fake(socket);
		const pending = transport("http://host.test/", { connectTimeout: 500 }, modules);
		socket.emit("connect");
		await vi.advanceTimersByTimeAsync(1000);
		let settled = false;
		pending.then(
			() => (settled = true),
			() => (settled = true)
		);
		await vi.advanceTimersByTimeAsync(0);
		expect(settled).toBe(false);
	});

	test("ignores a socket that is already connected", async () => {
		vi.useFakeTimers();
		const socket = Object.assign(new EventEmitter(), { connecting: false });
		let settled = false;
		transport("http://host.test/", { connectTimeout: 500 }, fake(socket)).then(
			() => (settled = true),
			() => (settled = true)
		);
		await vi.advanceTimersByTimeAsync(1000);
		expect(settled).toBe(false);
	});

	test("for https the timer also covers the TLS handshake", async () => {
		vi.useFakeTimers();
		// TCP is connected (connecting is false) but the handshake has not finished.
		const stalled = Object.assign(new EventEmitter(), { connecting: false });
		const failing = transport("https://host.test/", { connectTimeout: 500 }, fake(stalled));
		const rejected = expect(failing).rejects.toThrow("connect timeout after 500 ms");
		stalled.emit("connect");
		await vi.advanceTimersByTimeAsync(500);
		await rejected;
		const secure = Object.assign(new EventEmitter(), { connecting: true });
		let settled = false;
		transport("https://host.test/", { connectTimeout: 500 }, fake(secure)).then(
			() => (settled = true),
			() => (settled = true)
		);
		secure.emit("connect");
		secure.emit("secureConnect");
		await vi.advanceTimersByTimeAsync(1000);
		expect(settled).toBe(false);
	});

	test("a real server that answers is not affected", async () => {
		const res = await transport(`${base}/json`, { connectTimeout: 5000 });
		expect(res.status).toBe(200);
	});
});

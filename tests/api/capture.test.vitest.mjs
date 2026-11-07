/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/capture.test.vitest.mjs
 *	@Date: 2026-11-06T12:00:00-08:00 (1793995200)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-06T12:00:00-08:00 (1793995200)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The `capture` option: records for JSON and stream replies, upstream errors, header redaction, the stream cap, the
 * callback and directory sinks, and failures that must not touch the reply.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { completion } from "../helpers/fake-server.mjs";
import { openaiSse } from "../helpers/streams.mjs";
import { createTranslator } from "../../src/index.mjs";
import { redact } from "../../src/lib/record.mjs";

const scratch = path.resolve("tmp/agents/lt-53/capture-test");
const hello = { model: "m", max_tokens: 16, messages: [{ role: "user", content: "hi" }] };

beforeEach(() => {
	rmSync(scratch, { recursive: true, force: true });
	mkdirSync(scratch, { recursive: true });
});

afterEach(async () => {
	vi.restoreAllMocks();
	await closeAll();
	rmSync(scratch, { recursive: true, force: true });
});

const chunk = (content, finish = null) => ({
	id: "c1",
	object: "chat.completion.chunk",
	model: "m",
	choices: [{ index: 0, delta: content === null ? {} : { content }, finish_reason: finish }]
});

/** A translator over one fake vLLM endpoint. */
const vllm = (handler, config = {}, endpoint = {}) =>
	make({
		upstreams: [{ name: "a", url: "http://a.test", backend: "vllm", apiKey: "sk-secret", settings: { topK: false }, ...endpoint }],
		transport: fakeTransport(handler),
		detect: false,
		...config
	});

const sseReply = (text) => ({ body: text, headers: { "content-type": "text/event-stream", "set-cookie": "a=b" } });
const files = () => readdirSync(scratch).filter((name) => name.endsWith(".json"));

describe("capture", () => {
	it("is off by default and writes nothing", async () => {
		const api = await vllm(() => ({ body: completion("ok") }));
		expect((await api.send(hello)).status).toBe(200);
		expect(files()).toEqual([]);
	});

	it("records a non-stream exchange as a JSON file with redacted headers", async () => {
		const dir = path.join(scratch, "out");
		const api = await vllm(
			() => ({ body: completion("ok"), headers: { "content-type": "application/json", "x-auth-token": "t0p" } }),
			{
				capture: dir
			},
			{ headers: { cookie: "session=1", "x-trace": "keep" } }
		);
		const reply = await api.send({ ...hello, system: "be brief" });
		const [name] = readdirSync(dir);
		expect(name).toMatch(/^\d+-[0-9a-f]{12}\.json$/);
		const record = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
		expect(record).toMatchObject({
			front: "anthropic",
			requested: "m",
			model: "m",
			endpoint: "a",
			stream: false,
			client: { body: { model: "m", system: "be brief" } },
			upstream: { url: "http://a.test/v1/chat/completions", body: { model: "m" } },
			response: { status: 200, body: { choices: [{ message: { content: "ok" } }] } }
		});
		expect(record.upstream.headers).toMatchObject({
			authorization: "[redacted]",
			cookie: "[redacted]",
			"x-trace": "keep",
			"content-type": "application/json"
		});
		expect(record.response.headers["x-auth-token"]).toBe("[redacted]");
		expect(JSON.stringify(record.upstream.headers)).not.toContain("sk-secret");
		expect(reply.body.content[0].text).toBe("ok");
	});

	it("records a stream exchange: raw upstream text and the client events, once the stream ends", async () => {
		const records = [];
		const text = openaiSse([chunk("Hel"), chunk("lo"), chunk(null, "stop"), "[DONE]"]);
		const api = await vllm(() => sseReply(text), { capture: (record) => records.push(record) });
		const reply = await api.send({ ...hello, stream: true });
		expect(records).toHaveLength(0);
		const events = await collect(reply.stream);
		expect(records).toHaveLength(1);
		const [record] = records;
		expect(record).toMatchObject({ stream: true, client: { body: { stream: true } } });
		expect(record.upstream.headers.authorization).toBe("[redacted]");
		expect(record.response).toMatchObject({ status: 200, raw: text, truncated: false });
		expect(record.response.headers["set-cookie"]).toBe("[redacted]");
		expect(record.response.events).toEqual(events);
		expect(record.response.events[0].event).toBe("message_start");
	});

	it("records a stream that arrives as text chunks, and one the consumer abandons early", async () => {
		const records = [];
		const text = openaiSse([chunk("Hel"), chunk("lo"), chunk(null, "stop"), "[DONE]"]);
		const transport = async () => ({
			ok: true,
			status: 200,
			headers: new Headers({ "content-type": "text/event-stream" }),
			body: [text.slice(0, 40), text.slice(40)]
		});
		const api = await make({
			upstreams: [{ name: "a", url: "http://a.test", backend: "vllm", settings: { topK: false } }],
			transport,
			detect: false,
			capture: (record) => records.push(record)
		});
		const reply = await api.send({ ...hello, stream: true });
		for await (const event of reply.stream) {
			expect(event.event).toBe("message_start");
			break;
		}
		expect(records).toHaveLength(1);
		expect(records[0].response.raw).toBe(text.slice(0, 40) + text.slice(40));
		expect(records[0].response.events).toHaveLength(1);
	});

	it("stops recording a stream past the cap and says so", async () => {
		const records = [];
		const big = "x".repeat(600_000);
		const text = openaiSse([chunk(big), chunk(big), chunk(big), chunk(null, "stop"), "[DONE]"]);
		// The upstream text arrives in several chunks, so chunks still come after the cap is reached.
		const transport = async () => ({
			ok: true,
			status: 200,
			headers: new Headers({ "content-type": "text/event-stream" }),
			body: text.split("\n\n").map((part) => `${part}\n\n`)
		});
		const api = await make({
			upstreams: [{ name: "a", url: "http://a.test", backend: "vllm", settings: { topK: false } }],
			transport,
			detect: false,
			capture: (record) => records.push(record)
		});
		const reply = await api.send({ ...hello, stream: true });
		const events = await collect(reply.stream);
		expect(events.length).toBeGreaterThan(4);
		const { response } = records[0];
		expect(response.truncated).toBe(true);
		expect(response.raw.length).toBe(1_000_000);
		expect(response.raw.startsWith("data: ")).toBe(true);
		expect(response.events.length).toBeLessThan(events.length);
	});

	it("records an upstream error reply", async () => {
		const records = [];
		const api = await vllm(() => ({ status: 429, body: { error: { message: "slow down" } } }), { capture: (r) => records.push(r) });
		const reply = await api.send(hello);
		expect(reply.status).toBe(429);
		expect(records[0].response).toMatchObject({ status: 429, body: { error: { message: "slow down" } } });
	});

	it("records an upstream body that is not JSON", async () => {
		const records = [];
		const api = await vllm(() => ({ body: "plain text", headers: { "content-type": "text/plain" } }), { capture: (r) => records.push(r) });
		expect((await api.send(hello)).status).toBe(502);
		expect(records[0].response).toMatchObject({ status: 200, body: "plain text" });
	});

	it("reports a failing directory once as a warning and still answers", async () => {
		const blocker = path.join(scratch, "file");
		writeFileSync(blocker, "not a directory");
		const api = await vllm(() => ({ body: completion("ok") }), { capture: path.join(blocker, "sub") });
		const warnings = [];
		api.events.on("warning", (event) => warnings.push(event));
		const reply = await api.send(hello);
		expect(reply.status).toBe(200);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatchObject({ type: "warning", kind: "capture" });
		expect(warnings[0].message).toMatch(/Could not capture the exchange/);
	});

	it("contains a callback that throws or rejects", async () => {
		const warnings = [];
		const thrower = await vllm(() => ({ body: completion("ok") }), {
			capture: () => {
				throw new Error("sync boom");
			}
		});
		thrower.events.on("warning", (event) => warnings.push(event.message));
		expect((await thrower.send(hello)).status).toBe(200);
		const rejecter = await vllm(() => ({ body: completion("ok") }), { capture: async () => Promise.reject(new Error("async boom")) });
		rejecter.events.on("warning", (event) => warnings.push(event.message));
		expect((await rejecter.send(hello)).status).toBe(200);
		const plain = await vllm(() => ({ body: completion("ok") }), {
			capture: () => {
				throw "not an error object";
			}
		});
		plain.events.on("warning", (event) => warnings.push(event.message));
		expect((await plain.send(hello)).status).toBe(200);
		await vi.waitFor(() => expect(warnings).toHaveLength(3));
		expect(warnings[2]).toMatch(/not an error object/);
		expect(warnings[0]).toMatch(/sync boom/);
		expect(warnings[1]).toMatch(/async boom/);
	});

	it("rejects a capture value of the wrong type", async () => {
		for (const capture of [true, 5, ""]) {
			await expect(createTranslator({ upstreams: ["http://a.test"], capture, detect: false })).rejects.toMatchObject({
				code: "INVALID_CONFIG"
			});
		}
	});
});

describe("redact", () => {
	it("replaces credential headers whatever their case and keeps the rest", () => {
		expect(
			redact({
				Authorization: "Bearer x",
				"Proxy-Authorization": "y",
				"X-Api-Key": "k",
				"api-key": "k",
				Cookie: "c",
				"X-Secret": "s",
				Accept: "a"
			})
		).toEqual({
			authorization: "[redacted]",
			"proxy-authorization": "[redacted]",
			"x-api-key": "[redacted]",
			"api-key": "[redacted]",
			cookie: "[redacted]",
			"x-secret": "[redacted]",
			accept: "a"
		});
		expect(redact(undefined)).toEqual({});
	});
});

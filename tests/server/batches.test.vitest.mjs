/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/server/batches.test.vitest.mjs
 *	@Date: 2026-11-22T12:00:00-08:00 (1795464000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T12:00:00-08:00 (1795464000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview `/v1/batches` and `/v1/messages/batches` over HTTP: the routes of both fronts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeAll, fakeTransport, make } from "../helpers/translator.mjs";
import { completion } from "../helpers/fake-server.mjs";

afterEach(closeAll);

const hung = (_url, init) =>
	new Promise((_, reject) =>
		init.signal.addEventListener("abort", () => reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })))
	);

/** A server on the given front, with an upstream behind a fake transport. */
const start = async (front, handler = () => ({ body: completion("ok") }), config = {}) => {
	const api = await make({
		upstreams: [{ name: "a", url: "http://a.test", backend: "vllm", api: "openai", models: ["m"] }],
		transport: fakeTransport(handler),
		detect: false,
		front,
		pool: { healthInterval: 0 },
		...config
	});
	const server = await api.server.start({ port: 0, front });
	return { api, url: server.url };
};
const send = (url, route, { method = "GET", body, headers = {} } = {}) =>
	fetch(`${url}${route}`, {
		method,
		headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
const params = (text) => ({ model: "m", max_tokens: 5, messages: [{ role: "user", content: text }] });

describe("Anthropic front: /v1/messages/batches", () => {
	it("creates, reads, lists, serves the results of and deletes a batch", async () => {
		const { url } = await start("anthropic");
		const created = await send(url, "/v1/messages/batches", {
			method: "POST",
			body: {
				requests: [
					{ custom_id: "a", params: params("one") },
					{ custom_id: "b", params: params("two") }
				]
			}
		});
		expect(created.status).toBe(200);
		const batch = await created.json();
		expect(batch).toMatchObject({ type: "message_batch", processing_status: "in_progress" });
		await vi.waitFor(async () =>
			expect((await (await send(url, `/v1/messages/batches/${batch.id}`)).json()).processing_status).toBe("ended")
		);
		const done = await (await send(url, `/v1/messages/batches/${batch.id}`)).json();
		expect(done.request_counts).toMatchObject({ succeeded: 2, processing: 0 });
		expect(done.results_url).toBe(`${url}/v1/messages/batches/${batch.id}/results`);
		const results = await send(url, `/v1/messages/batches/${batch.id}/results`);
		expect(results.headers.get("content-type")).toContain("application/x-jsonl");
		const rows = (await results.text())
			.trim()
			.split("\n")
			.map((row) => JSON.parse(row));
		expect(rows.map((row) => row.custom_id)).toEqual(["a", "b"]);
		expect(rows[0].result.type).toBe("succeeded");
		const list = await (await send(url, "/v1/messages/batches?limit=1")).json();
		expect(list).toMatchObject({ has_more: false, first_id: batch.id });
		const deleted = await send(url, `/v1/messages/batches/${batch.id}`, { method: "DELETE" });
		expect(await deleted.json()).toEqual({ id: batch.id, type: "message_batch_deleted" });
		const gone = await send(url, `/v1/messages/batches/${batch.id}`);
		expect(gone.status).toBe(404);
		expect(await gone.json()).toMatchObject({ type: "error", error: { type: "not_found_error" } });
	});

	it("cancels a batch that is running and refuses a bad body", async () => {
		const { url } = await start("anthropic", hung);
		const batch = await (
			await send(url, "/v1/messages/batches", { method: "POST", body: { requests: [{ custom_id: "a", params: params("x") }] } })
		).json();
		const early = await send(url, `/v1/messages/batches/${batch.id}/results`);
		expect(early.status).toBe(400);
		const canceling = await send(url, `/v1/messages/batches/${batch.id}/cancel`, { method: "POST" });
		expect((await canceling.json()).processing_status).toBe("canceling");
		await vi.waitFor(async () =>
			expect((await (await send(url, `/v1/messages/batches/${batch.id}`)).json()).processing_status).toBe("ended")
		);
		const bad = await send(url, "/v1/messages/batches", { method: "POST", body: { requests: [] } });
		expect(bad.status).toBe(400);
		expect(await bad.json()).toMatchObject({ type: "error", error: { type: "invalid_request_error" } });
	});

	it("does not serve the OpenAI routes", async () => {
		const { url } = await start("anthropic");
		expect((await send(url, "/v1/batches")).status).toBe(404);
	});

	it("is off when the batches setting is null", async () => {
		const { url } = await start("anthropic", undefined, { settings: { batches: null } });
		const reply = await send(url, "/v1/messages/batches");
		expect(reply.status).toBe(404);
		expect(await reply.json()).toMatchObject({ error: { message: expect.stringContaining("batches setting is null") } });
	});
});

describe("OpenAI front: /v1/batches", () => {
	const upload = async (url, rows, purpose = "batch") => {
		const form = new FormData();
		form.set("purpose", purpose);
		form.set("file", new Blob([rows.map((row) => JSON.stringify(row)).join("\n")], { type: "application/jsonl" }), "in.jsonl");
		return (await (await fetch(`${url}/v1/files`, { method: "POST", body: form })).json()).id;
	};
	const row = (custom_id) => ({
		custom_id,
		method: "POST",
		url: "/v1/chat/completions",
		body: { model: "m", messages: [{ role: "user", content: custom_id }] }
	});

	it("creates a batch from an uploaded file and serves the output file", async () => {
		const { url } = await start("openai");
		const input_file_id = await upload(url, [row("a"), row("b")]);
		const created = await send(url, "/v1/batches", {
			method: "POST",
			body: { input_file_id, endpoint: "/v1/chat/completions", completion_window: "24h" }
		});
		expect(created.status).toBe(200);
		const batch = await created.json();
		expect(batch).toMatchObject({ object: "batch", status: "validating", input_file_id });
		await vi.waitFor(async () => expect((await (await send(url, `/v1/batches/${batch.id}`)).json()).status).toBe("completed"));
		const done = await (await send(url, `/v1/batches/${batch.id}`)).json();
		expect(done.request_counts).toEqual({ total: 2, completed: 2, failed: 0 });
		const output = await (await send(url, `/v1/files/${done.output_file_id}/content`)).text();
		expect(
			output
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line).custom_id)
		).toEqual(["a", "b"]);
		const list = await (await send(url, "/v1/batches?limit=5")).json();
		expect(list).toMatchObject({ object: "list", has_more: false, first_id: batch.id });
		const missing = await send(url, "/v1/batches/batch_abcdefabcdef");
		expect(missing.status).toBe(404);
		expect(await missing.json()).toMatchObject({ error: { message: "No batch found with id 'batch_abcdefabcdef'." } });
		expect((await send(url, "/v1/messages/batches")).status).toBe(404);
	});

	it("cancels a running batch", async () => {
		const { url } = await start("openai", hung);
		const input_file_id = await upload(url, [row("a")]);
		const batch = await (
			await send(url, "/v1/batches", {
				method: "POST",
				body: { input_file_id, endpoint: "/v1/chat/completions", completion_window: "24h" }
			})
		).json();
		const cancelling = await (await send(url, `/v1/batches/${batch.id}/cancel`, { method: "POST" })).json();
		expect(cancelling.status).toBe("cancelling");
		await vi.waitFor(async () => expect((await (await send(url, `/v1/batches/${batch.id}`)).json()).status).toBe("cancelled"));
		const again = await send(url, `/v1/batches/${batch.id}/cancel`, { method: "POST" });
		expect(again.status).toBe(409);
	});

	it("stopping the server leaves no batch running", async () => {
		const { api, url } = await start("openai", hung);
		const input_file_id = await upload(url, [row("a")]);
		const batch = await (
			await send(url, "/v1/batches", {
				method: "POST",
				body: { input_file_id, endpoint: "/v1/chat/completions", completion_window: "24h" }
			})
		).json();
		await api.server.stop();
		expect((await api.batches.get(batch.id, { front: "openai" })).status).toBe("cancelled");
	});
});

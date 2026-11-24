/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/batches.test.vitest.mjs
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
 * @fileoverview The Batch APIs through the api leaves: both fronts' batch objects, validation, running, concurrency, cancel, expiry, retention and the stores.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { closeAll, fakeTransport, make } from "../helpers/translator.mjs";
import { completion } from "../helpers/fake-server.mjs";

afterEach(async () => {
	vi.useRealTimers();
	await closeAll();
});

const dirs = [];
afterEach(() => {
	while (dirs.length > 0) fs.rmSync(dirs.pop(), { recursive: true, force: true });
});
const scratch = () => {
	fs.mkdirSync(path.join(process.cwd(), "tmp"), { recursive: true });
	const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp", "batches-"));
	dirs.push(dir);
	return dir;
};

const embedding = {
	object: "list",
	data: [{ object: "embedding", index: 0, embedding: [0.5] }],
	model: "m",
	usage: { prompt_tokens: 3, total_tokens: 3 }
};
const answers = (init) => {
	const body = JSON.parse(init.body);
	const text = JSON.stringify(body).includes("boom") ? null : "ok";
	return text === null
		? { status: 400, body: { error: { message: "bad request", type: "invalid_request_error" } } }
		: { body: completion(text) };
};
/** An upstream that answers every chat request, and every embeddings request. */
const standard = (url, init) => (url.endsWith("/embeddings") ? { body: embedding } : answers(init));
/** An upstream that never answers until the request is aborted (and counts the calls it got). */
const hung = () => {
	const handler = (_url, init) => {
		handler.calls += 1;
		const aborted = () => Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
		if (init.signal.aborted) return Promise.reject(aborted());
		return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(aborted())));
	};
	handler.calls = 0;
	return handler;
};

/** A translator with one vLLM-protocol upstream behind a fake transport. */
const farm = (handler = standard, config = {}) =>
	make({
		upstreams: [{ name: "a", url: "http://a.test", backend: "vllm", api: "openai", models: ["m"] }],
		transport: fakeTransport(handler),
		detect: false,
		front: "openai",
		pool: { healthInterval: 0 },
		...config
	});

const message = (text = "hi", extra = {}) => ({ model: "m", max_tokens: 5, messages: [{ role: "user", content: text }], ...extra });
const entry = (custom_id, params = message(custom_id)) => ({ custom_id, params });
const ant = { front: "anthropic" };
const oai = { front: "openai" };
const ended = (api, id) =>
	vi.waitFor(async () => expect((await api.batches.get(id, ant)).processing_status).toBe("ended"), { timeout: 5000, interval: 5 });
const finished = (api, id, ...statuses) =>
	vi.waitFor(async () => expect(statuses).toContain((await api.batches.get(id, oai)).status), { timeout: 5000, interval: 5 });
const jsonl = (rows) => rows.map((row) => (typeof row === "string" ? row : JSON.stringify(row))).join("\n");
const line = (custom_id, body = { model: "m", messages: [{ role: "user", content: custom_id }] }, url = "/v1/chat/completions") => ({
	custom_id,
	method: "POST",
	url,
	body
});
const upload = async (api, text, purpose = "batch") =>
	(await api.files.create({ filename: "in.jsonl", data: Buffer.from(text), type: "application/jsonl", fields: { purpose } }, oai)).id;
const submit = async (api, rows, extra = {}) =>
	api.batches.create(
		{ input_file_id: await upload(api, jsonl(rows)), endpoint: "/v1/chat/completions", completion_window: "24h", ...extra },
		oai
	);
const lines = async (api, id) =>
	(await api.files.content(id, oai)).data
		.toString()
		.trim()
		.split("\n")
		.map((row) => JSON.parse(row));

describe("Message Batches", () => {
	it("runs the requests through the normal path and serves the results as JSON lines", async () => {
		const api = await farm();
		const made = await api.batches.create({ requests: [entry("first"), entry("bad", message("boom")), entry("third")] }, ant);
		expect(made).toMatchObject({
			type: "message_batch",
			processing_status: "in_progress",
			request_counts: { processing: 3, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
			ended_at: null,
			cancel_initiated_at: null,
			results_url: null
		});
		expect(made.id).toMatch(/^msgbatch_[0-9a-f]{24}$/);
		expect(Date.parse(made.expires_at) - Date.parse(made.created_at)).toBe(86400000);
		await ended(api, made.id);
		const done = await api.batches.get(made.id, { ...ant, base: "https://t.test" });
		expect(done.request_counts).toEqual({ processing: 0, succeeded: 2, errored: 1, canceled: 0, expired: 0 });
		expect(done.results_url).toBe(`https://t.test/v1/messages/batches/${made.id}/results`);
		expect(done.ended_at).not.toBeNull();
		expect((await api.batches.get(made.id, ant)).results_url).toBe(`/v1/messages/batches/${made.id}/results`);
		const rows = (await api.batches.results(made.id, ant))
			.trim()
			.split("\n")
			.map((row) => JSON.parse(row));
		expect(rows.map((row) => [row.custom_id, row.result.type])).toEqual([
			["first", "succeeded"],
			["bad", "errored"],
			["third", "succeeded"]
		]);
		expect(rows[0].result.message).toMatchObject({ type: "message", role: "assistant", content: [{ type: "text", text: "ok" }] });
		expect(rows[1].result.error).toMatchObject({ type: "error", error: { type: "invalid_request_error" } });
	});

	it("errors a request that asks for streaming or throws on its own, without ending the batch", async () => {
		const api = await farm();
		const made = await api.batches.create({ requests: [entry("s", message("x", { stream: true })), entry("n", { model: 7 })] }, ant);
		await ended(api, made.id);
		const rows = (await api.batches.results(made.id, ant))
			.trim()
			.split("\n")
			.map((row) => JSON.parse(row));
		expect(rows[0].result).toMatchObject({
			type: "errored",
			error: { error: { message: "stream: Streaming is not supported in batches" } }
		});
		expect(rows[1].result.type).toBe("errored");
	});

	it.each([
		["a body that is not an object", [], "requests: Field required"],
		["no requests field", {}, "requests: Field required"],
		["an empty list", { requests: [] }, "at least 1"],
		["a request that is not an object", { requests: [5] }, "requests.0: Input should be a valid dictionary"],
		["a custom_id that is not allowed", { requests: [entry("a b")] }, "requests.0.custom_id: String should match pattern"],
		["a custom_id that is not a string", { requests: [{ custom_id: 5, params: message() }] }, "requests.0.custom_id"],
		["a repeated custom_id", { requests: [entry("a"), entry("a")] }, "requests.1.custom_id: custom_id 'a' is used more than once"],
		["params that are not an object", { requests: [{ custom_id: "a", params: [] }] }, "requests.0.params: Field required"]
	])("refuses %s", async (_name, body, text) => {
		const api = await farm();
		await expect(api.batches.create(body, ant)).rejects.toMatchObject({
			status: 400,
			code: "invalid_request",
			message: expect.stringContaining(text)
		});
	});

	it("refuses more requests than maxRequests", async () => {
		const api = await farm(standard, { settings: { batches: { maxRequests: 1 } } });
		await expect(api.batches.create({ requests: [entry("a"), entry("b")] }, ant)).rejects.toMatchObject({
			message: expect.stringContaining("at most 1")
		});
	});

	it("lists newest first with before_id, after_id and limit, and keeps the fronts apart", async () => {
		const api = await farm(standard, { upstreams: [{ name: "a", url: "http://a.test", backend: "vllm", models: ["m"] }] });
		const ids = [];
		for (const name of ["a", "b", "c"]) {
			ids.push((await api.batches.create({ requests: [entry(name)] }, ant)).id);
			await new Promise((resolve) => setTimeout(resolve, 3));
		}
		const other = await submit(api, [line("x")]);
		const all = await api.batches.list({}, ant);
		expect(all.data.map((batch) => batch.id)).toEqual([...ids].reverse());
		expect(all).toMatchObject({ has_more: false, first_id: ids[2], last_id: ids[0] });
		const first = await api.batches.list({ limit: "2" }, { ...ant, base: "https://t.test" });
		expect(first).toMatchObject({ has_more: true, first_id: ids[2], last_id: ids[1] });
		const older = await api.batches.list({ limit: 2, after_id: ids[1] }, ant);
		expect(older.data.map((batch) => batch.id)).toEqual([ids[0]]);
		const newer = await api.batches.list({ before_id: ids[0], limit: 1 }, ant);
		expect(newer.data.map((batch) => batch.id)).toEqual([ids[1]]);
		expect(await api.batches.list({ before_id: ids[2], after_id: ids[2] }, ant)).toEqual({
			data: [],
			has_more: false,
			first_id: null,
			last_id: null
		});
		await expect(api.batches.list({ limit: 0 }, ant)).rejects.toMatchObject({ code: "invalid_limit" });
		await expect(api.batches.list({ limit: "x" }, ant)).rejects.toMatchObject({ code: "invalid_limit" });
		await expect(api.batches.list({ after_id: "msgbatch_nope0000" }, ant)).rejects.toMatchObject({ code: "invalid_cursor" });
		await expect(api.batches.list({ before_id: "msgbatch_nope0000" }, ant)).rejects.toMatchObject({ code: "invalid_cursor" });
		expect((await api.batches.list({}, oai)).data.map((batch) => batch.id)).toEqual([other.id]);
		await expect(api.batches.get(other.id, ant)).rejects.toMatchObject({ status: 404, code: "batch_not_found" });
		await expect(api.batches.get(ids[0], oai)).rejects.toMatchObject({ status: 404, message: `No batch found with id '${ids[0]}'.` });
	});
});

describe("Message Batches lifecycle", () => {
	it("cancels: the requests in flight are aborted, the rest are canceled, and the batch ends", async () => {
		const handler = hung();
		const api = await farm(handler, { settings: { batches: { concurrency: 1 } } });
		const made = await api.batches.create({ requests: [entry("a"), entry("b")] }, ant);
		await vi.waitFor(() => expect(handler.calls).toBe(1));
		const canceling = await api.batches.cancel(made.id, ant);
		expect(canceling).toMatchObject({ processing_status: "canceling", results_url: null });
		expect(canceling.cancel_initiated_at).not.toBeNull();
		// A second cancel answers the batch as it is.
		expect((await api.batches.cancel(made.id, ant)).cancel_initiated_at).toBe(canceling.cancel_initiated_at);
		await ended(api, made.id);
		expect((await api.batches.get(made.id, ant)).request_counts).toEqual({
			processing: 0,
			succeeded: 0,
			errored: 0,
			canceled: 2,
			expired: 0
		});
		expect(
			(await api.batches.results(made.id, ant))
				.trim()
				.split("\n")
				.map((row) => JSON.parse(row))
		).toEqual([
			{ custom_id: "a", result: { type: "canceled" } },
			{ custom_id: "b", result: { type: "canceled" } }
		]);
		await expect(api.batches.cancel(made.id, ant)).rejects.toMatchObject({ status: 400, code: "batch_ended" });
	});

	it("keeps the results of requests that finished before the cancel", async () => {
		let release;
		const gate = new Promise((resolve) => (release = resolve));
		const handler = async (url, init) => {
			if (JSON.stringify(JSON.parse(init.body)).includes("slow")) return hung()(url, init);
			await gate;
			return standard(url, init);
		};
		const api = await farm(handler, { settings: { batches: { concurrency: 2 } } });
		const made = await api.batches.create({ requests: [entry("fast"), entry("slow")] }, ant);
		release();
		await vi.waitFor(async () => expect((await api.batches.get(made.id, ant)).request_counts.succeeded).toBe(1));
		await api.batches.cancel(made.id, ant);
		await ended(api, made.id);
		expect((await api.batches.get(made.id, ant)).request_counts).toMatchObject({ succeeded: 1, canceled: 1 });
	});

	it("expires: what did not run before expires_at is expired", async () => {
		const api = await farm(hung(), { settings: { batches: { window: 1 } } });
		const made = await api.batches.create({ requests: [entry("a")] }, ant);
		await ended(api, made.id);
		expect((await api.batches.get(made.id, ant)).request_counts).toMatchObject({ expired: 1, canceled: 0 });
		expect(JSON.parse(await api.batches.results(made.id, ant))).toEqual({ custom_id: "a", result: { type: "expired" } });
	});

	it("never has more requests in flight than the concurrency setting, across batches", async () => {
		let active = 0;
		let peak = 0;
		const handler = async (url, init) => {
			active += 1;
			peak = Math.max(peak, active);
			await new Promise((resolve) => setTimeout(resolve, 15));
			active -= 1;
			return standard(url, init);
		};
		const api = await farm(handler, { settings: { batches: { concurrency: 2 } } });
		const batches = [];
		for (let index = 0; index < 2; index += 1) {
			batches.push(await api.batches.create({ requests: [0, 1, 2, 3].map((n) => entry(`r${n}`, message(`${index}-${n}`))) }, ant));
		}
		for (const batch of batches) await ended(api, batch.id);
		expect(peak).toBe(2);
		expect((await api.batches.get(batches[1].id, ant)).request_counts.succeeded).toBe(4);
	});

	it("a cancel reaches requests that are waiting for a slot", async () => {
		const handler = hung();
		const api = await farm(handler, { settings: { batches: { concurrency: 1 } } });
		const first = await api.batches.create({ requests: [entry("a")] }, ant);
		await vi.waitFor(() => expect(handler.calls).toBe(1));
		const second = await api.batches.create({ requests: [entry("b"), entry("c")] }, ant);
		await new Promise((resolve) => setTimeout(resolve, 10));
		await api.batches.cancel(second.id, ant);
		await ended(api, second.id);
		expect((await api.batches.get(second.id, ant)).request_counts.canceled).toBe(2);
		expect(handler.calls).toBe(1);
		await api.batches.cancel(first.id, ant);
		await ended(api, first.id);
	});

	it("deletes only a batch that has ended", async () => {
		const handler = hung();
		const api = await farm(handler);
		const made = await api.batches.create({ requests: [entry("a")] }, ant);
		await expect(api.batches.remove(made.id, ant)).rejects.toMatchObject({ status: 400, code: "batch_in_progress" });
		await expect(api.batches.results(made.id, ant)).rejects.toMatchObject({ status: 400, code: "batch_in_progress" });
		await api.batches.cancel(made.id, ant);
		await ended(api, made.id);
		expect(await api.batches.remove(made.id, ant)).toEqual({ id: made.id, type: "message_batch_deleted" });
		await expect(api.batches.get(made.id, ant)).rejects.toMatchObject({ status: 404 });
		await expect(api.batches.remove(made.id, ant)).rejects.toMatchObject({ status: 404 });
		await expect(api.batches.get("nonsense", ant)).rejects.toMatchObject({ status: 404 });
		await expect(api.batches.results("msgbatch_abcdefabcdef", ant)).rejects.toMatchObject({
			status: 404,
			message: "Batch `msgbatch_abcdefabcdef` not found."
		});
	});

	it("stop ends the running batches as canceled and leaves nothing running", async () => {
		const handler = hung();
		const api = await farm(handler);
		const made = await api.batches.create({ requests: [entry("a"), entry("b")] }, ant);
		await vi.waitFor(() => expect(handler.calls).toBeGreaterThan(0));
		await api.batches.cancel(made.id, ant);
		await api.batches.stop();
		expect((await api.batches.get(made.id, ant)).processing_status).toBe("ended");
		await api.batches.stop();
		const idle = await farm();
		await idle.batches.stop();
	});

	it("is off when the batches setting is null", async () => {
		const api = await farm(standard, { settings: { batches: null } });
		for (const call of [
			() => api.batches.create({ requests: [entry("a")] }, ant),
			() => api.batches.list({}, ant),
			() => api.batches.get("msgbatch_abcdefabcdef", ant),
			() => api.batches.cancel("msgbatch_abcdefabcdef", ant),
			() => api.batches.remove("msgbatch_abcdefabcdef", ant),
			() => api.batches.results("msgbatch_abcdefabcdef", ant)
		]) {
			await expect(call()).rejects.toMatchObject({ status: 404, code: "batches_disabled" });
		}
		await api.batches.stop();
	});

	it("makes room for a new batch by dropping the oldest ended one, and refuses when all are running", async () => {
		const handler = hung();
		const api = await farm(handler, { settings: { batches: { maxCount: 1 } } });
		const first = await api.batches.create({ requests: [entry("a")] }, ant);
		await expect(api.batches.create({ requests: [entry("b")] }, ant)).rejects.toMatchObject({
			status: 400,
			code: "storage_limit_exceeded"
		});
		await api.batches.cancel(first.id, ant);
		await ended(api, first.id);
		const second = await api.batches.create({ requests: [entry("b")] }, ant);
		await expect(api.batches.get(first.id, ant)).rejects.toMatchObject({ status: 404 });
		expect((await api.batches.list({}, ant)).data.map((batch) => batch.id)).toEqual([second.id]);
	});

	it("drops a finished batch after its retention", async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
		const api = await farm(standard, { settings: { batches: { ttl: 60 } } });
		const kept = await api.batches.create({ requests: [entry("a")] }, ant);
		await ended(api, kept.id);
		vi.setSystemTime(new Date("2026-11-01T00:00:59Z"));
		expect((await api.batches.get(kept.id, ant)).id).toBe(kept.id);
		vi.setSystemTime(new Date("2026-11-01T00:01:01Z"));
		await expect(api.batches.get(kept.id, ant)).rejects.toMatchObject({ status: 404 });
		const again = await api.batches.create({ requests: [entry("b")] }, ant);
		await ended(api, again.id);
		vi.setSystemTime(new Date("2026-11-01T00:03:00Z"));
		expect((await api.batches.list({}, ant)).data).toEqual([]);
	});

	it("keeps a batch for good when ttl is 0", async () => {
		const api = await farm(standard, { settings: { batches: { ttl: 0 } } });
		const made = await api.batches.create({ requests: [entry("a")] }, ant);
		await ended(api, made.id);
		expect((await api.batches.list({}, ant)).data).toHaveLength(1);
	});

	it("reports a batch that fails inside the runner as an error event", async () => {
		const dir = scratch();
		const events = [];
		let release;
		const gate = new Promise((resolve) => (release = resolve));
		const api = await farm(async (url, init) => (await gate, standard(url, init)), {
			settings: { batches: { store: "disk", dir } },
			onEvent: (event) => events.push(event)
		});
		const made = await api.batches.create({ requests: [entry("a")] }, ant);
		fs.rmSync(dir, { recursive: true, force: true });
		release();
		await vi.waitFor(() => expect(events.some((event) => event.type === "error" && event.kind === "batch")).toBe(true));
		expect((await api.batches.get(made.id, ant)).processing_status).toBe("ended");
	});
});

describe("the disk store", () => {
	it("keeps finished batches across translators and ends the ones a stopped process left running", async () => {
		const dir = scratch();
		const settings = { batches: { store: "disk", dir } };
		const first = await farm(standard, { settings });
		const done = await first.batches.create({ requests: [entry("a")] }, ant);
		await ended(first, done.id);
		const handler = hung();
		const second = await farm(handler, { settings });
		const running = await second.batches.create({ requests: [entry("b"), entry("c")] }, ant);
		await vi.waitFor(() => expect(handler.calls).toBeGreaterThan(0));
		const third = await farm(standard, { settings });
		expect((await third.batches.get(done.id, ant)).request_counts.succeeded).toBe(1);
		expect(JSON.parse((await third.batches.results(done.id, ant)).trim()).result.type).toBe("succeeded");
		const orphan = await third.batches.get(running.id, ant);
		expect(orphan).toMatchObject({ processing_status: "ended" });
		expect(orphan.request_counts).toMatchObject({ expired: 2, processing: 0 });
		expect((await third.batches.list({}, ant)).data).toHaveLength(2);
		expect(await third.batches.remove(done.id, ant)).toMatchObject({ type: "message_batch_deleted" });
		await expect(third.batches.get(done.id, ant)).rejects.toMatchObject({ status: 404 });
	});
});

describe("the batches setting", () => {
	it("is checked when the batch api is first used", async () => {
		const api = await farm(standard, { settings: { batches: { concurrency: 0 } } });
		await expect(api.batches.list({}, ant)).rejects.toMatchObject({ code: "invalid_setting" });
	});
});

describe("OpenAI batches", () => {
	it("validates the input file, runs it and writes the output and error files", async () => {
		const api = await farm();
		const made = await submit(
			api,
			[line("one"), line("two", { model: "m", messages: [{ role: "user", content: "boom" }] }), line("three")],
			{
				metadata: { who: "test" }
			}
		);
		expect(made).toMatchObject({
			object: "batch",
			status: "validating",
			endpoint: "/v1/chat/completions",
			completion_window: "24h",
			errors: null,
			output_file_id: null,
			error_file_id: null,
			in_progress_at: null,
			request_counts: { total: 0, completed: 0, failed: 0 },
			metadata: { who: "test" }
		});
		expect(made.id).toMatch(/^batch_[0-9a-f]{24}$/);
		expect(made.expires_at - made.created_at).toBe(86400);
		await finished(api, made.id, "completed");
		const done = await api.batches.get(made.id, oai);
		expect(done).toMatchObject({
			status: "completed",
			model: "m",
			request_counts: { total: 3, completed: 2, failed: 1 },
			usage: { input_tokens: 24, output_tokens: 8, total_tokens: 32, input_tokens_details: { cached_tokens: 0 } }
		});
		expect(done.completed_at).not.toBeNull();
		expect(done.in_progress_at).not.toBeNull();
		expect(done.finalizing_at).not.toBeNull();
		const output = await lines(api, done.output_file_id);
		expect(output.map((row) => row.custom_id)).toEqual(["one", "three"]);
		expect(output[0]).toMatchObject({
			id: expect.stringMatching(/^batch_req_/),
			error: null,
			response: { status_code: 200, request_id: expect.stringMatching(/^req_/), body: { object: "chat.completion" } }
		});
		const errors = await lines(api, done.error_file_id);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({ custom_id: "two", error: null, response: { status_code: 400 } });
		expect(await api.files.get(done.output_file_id, oai)).toMatchObject({ purpose: "batch_output", filename: `${made.id}_output.jsonl` });
		expect(await api.files.get(done.error_file_id, oai)).toMatchObject({ purpose: "batch_error" });
	});

	it("runs /v1/responses and /v1/embeddings batches", async () => {
		const api = await farm();
		const responses = await submit(api, [line("r", { model: "m", input: "hello" }, "/v1/responses")], { endpoint: "/v1/responses" });
		const embeddings = await submit(api, [line("e", { model: "m", input: "hello" }, "/v1/embeddings")], { endpoint: "/v1/embeddings" });
		await finished(api, responses.id, "completed");
		await finished(api, embeddings.id, "completed");
		const reply = (await lines(api, (await api.batches.get(responses.id, oai)).output_file_id))[0];
		expect(reply.response.body).toMatchObject({ object: "response", status: "completed" });
		const vector = (await lines(api, (await api.batches.get(embeddings.id, oai)).output_file_id))[0];
		expect(vector.response.body.data[0].embedding).toEqual([0.5]);
		expect((await api.batches.get(embeddings.id, oai)).usage.input_tokens).toBe(3);
	});

	it("puts a request that cannot be made in the error file, with the reason", async () => {
		const api = await farm();
		const made = await submit(
			api,
			[line("nomodel", { messages: [] }, "/v1/responses"), line("wrong", { model: "m", input: 5 }, "/v1/responses")],
			{
				endpoint: "/v1/responses"
			}
		);
		await finished(api, made.id, "completed");
		const done = await api.batches.get(made.id, oai);
		expect(done).toMatchObject({ output_file_id: null, request_counts: { total: 2, completed: 0, failed: 2 } });
		expect(done).not.toHaveProperty("model");
		const rows = await lines(api, done.error_file_id);
		expect(rows.map((row) => row.response.status_code)).toEqual([expect.any(Number), expect.any(Number)]);
	});

	it("sends a Responses request the upstream refuses to the error file", async () => {
		const api = await farm();
		const made = await submit(api, [line("r", { model: "m", input: "boom" }, "/v1/responses")], { endpoint: "/v1/responses" });
		await finished(api, made.id, "completed");
		const rows = await lines(api, (await api.batches.get(made.id, oai)).error_file_id);
		expect(rows[0].response).toMatchObject({ status_code: 400, body: { error: { message: "bad request" } } });
	});

	it("uses the configured front when a call names none", async () => {
		const api = await farm();
		const id = await upload(api, jsonl([line("a")]));
		const made = await api.batches.create({ input_file_id: id, endpoint: "/v1/chat/completions", completion_window: "24h" });
		await finished(api, made.id, "completed");
		expect((await api.batches.get(made.id)).status).toBe("completed");
		expect((await api.batches.list()).data).toHaveLength(1);
		await expect(api.batches.cancel(made.id)).rejects.toMatchObject({ status: 409 });
		await expect(api.batches.results(made.id)).rejects.toMatchObject({ status: 404 });
		expect(await api.batches.remove(made.id)).toMatchObject({ deleted: true });
	});

	it.each([
		["a line that is not JSON", ["{nope"], { code: "invalid_json_line", line: 1 }],
		["a line that is not an object", ["[1]"], { code: "invalid_json_line", line: 1 }],
		[
			"a line without a custom_id",
			[{ method: "POST", url: "/v1/chat/completions", body: {} }],
			{ code: "invalid_request", param: "custom_id" }
		],
		["a repeated custom_id", [line("a"), line("a")], { code: "duplicate_custom_id", line: 2 }],
		["a method that is not POST", [{ ...line("a"), method: "GET" }], { code: "invalid_method" }],
		["a url that is not the batch endpoint", [line("a", undefined, "/v1/embeddings")], { code: "invalid_url" }],
		["a line without a body", [{ ...line("a"), body: 5 }], { code: "invalid_request", param: "body" }],
		["a line that asks for streaming", [line("a", { model: "m", stream: true })], { code: "invalid_request", param: "body.stream" }],
		["an empty file", [""], { code: "empty_file" }]
	])("fails the batch for %s", async (_name, rows, error) => {
		const api = await farm();
		const made = await submit(api, rows);
		await finished(api, made.id, "failed");
		const failed = await api.batches.get(made.id, oai);
		expect(failed.errors).toMatchObject({ object: "list", data: [expect.objectContaining(error)] });
		expect(failed).toMatchObject({ output_file_id: null, request_counts: { total: 0 } });
		expect(failed.failed_at).not.toBeNull();
	});

	it("skips blank lines, counts line numbers with them, and lists at most 100 problems", async () => {
		const api = await farm();
		const mixed = await submit(api, [line("a"), "", "   ", "{bad"]);
		await finished(api, mixed.id, "failed");
		expect((await api.batches.get(mixed.id, oai)).errors.data).toEqual([
			{ code: "invalid_json_line", message: "This line is not parseable as valid JSON.", line: 4, param: null }
		]);
		const many = await submit(
			api,
			Array.from({ length: 105 }, () => "{bad")
		);
		await finished(api, many.id, "failed");
		expect((await api.batches.get(many.id, oai)).errors.data).toHaveLength(100);
	});

	it("fails the batch when the file holds more requests than maxRequests", async () => {
		const api = await farm(standard, { settings: { batches: { maxRequests: 1 } } });
		const made = await submit(api, [line("a"), line("b")]);
		await finished(api, made.id, "failed");
		expect((await api.batches.get(made.id, oai)).errors.data[0]).toMatchObject({ code: "too_many_tasks", line: null });
	});

	it("fails the batch when the output file cannot be stored", async () => {
		const api = await farm(standard, { settings: { files: { maxCount: 2 } } });
		const made = await submit(api, [line("a"), line("b", { model: "m", messages: [{ role: "user", content: "boom" }] })]);
		await finished(api, made.id, "failed");
		const failed = await api.batches.get(made.id, oai);
		expect(failed.errors.data[0]).toMatchObject({ code: "storage_limit_exceeded" });
	});

	it("gives the output files the lifetime output_expires_after asks for", async () => {
		const api = await farm();
		const made = await submit(api, [line("a")], { output_expires_after: { anchor: "created_at", seconds: 3600 } });
		await finished(api, made.id, "completed");
		const file = await api.files.get((await api.batches.get(made.id, oai)).output_file_id, oai);
		expect(file.expires_at - file.created_at).toBe(3600);
	});

	it.each([
		["a body that is not an object", 5, "invalid_request"],
		["no input_file_id", { endpoint: "/v1/chat/completions", completion_window: "24h" }, "missing_required_parameter"],
		["an endpoint it does not run", { input_file_id: "file-x", endpoint: "/v1/completions", completion_window: "24h" }, "invalid_value"],
		[
			"a completion window other than 24h",
			{ input_file_id: "file-x", endpoint: "/v1/embeddings", completion_window: "1h" },
			"invalid_value"
		],
		["metadata that is not an object", { metadata: 5 }, "invalid_value"],
		[
			"metadata with too many keys",
			{ metadata: Object.fromEntries(Array.from({ length: 17 }, (_, n) => [`k${n}`, "v"])) },
			"invalid_value"
		],
		["a metadata key that is too long", { metadata: { ["k".repeat(65)]: "v" } }, "invalid_value"],
		["a metadata value that is not a string", { metadata: { k: 1 } }, "invalid_value"],
		["output_expires_after with another anchor", { output_expires_after: { anchor: "x", seconds: 3600 } }, "invalid_value"],
		["output_expires_after that is too short", { output_expires_after: { anchor: "created_at", seconds: 10 } }, "invalid_value"],
		["output_expires_after that is too long", { output_expires_after: { anchor: "created_at", seconds: 99999999 } }, "invalid_value"],
		["output_expires_after that is not an object", { output_expires_after: 5 }, "invalid_value"]
	])("refuses %s", async (_name, extra, code) => {
		const api = await farm();
		const id = await upload(api, jsonl([line("a")]));
		const body =
			typeof extra === "object" && !("input_file_id" in extra) && "endpoint" in extra
				? extra
				: { input_file_id: id, endpoint: "/v1/chat/completions", completion_window: "24h", ...extra };
		await expect(api.batches.create(extra === 5 ? 5 : body, oai)).rejects.toMatchObject({ status: 400, code });
	});

	it("refuses an input file that is not there, is not a batch file, or cannot be read because Files is off", async () => {
		const api = await farm();
		const make_ = (input_file_id) => api.batches.create({ input_file_id, endpoint: "/v1/chat/completions", completion_window: "24h" }, oai);
		await expect(make_("file-unknown00000")).rejects.toMatchObject({ status: 400, message: "No such File object: file-unknown00000" });
		const wrong = await upload(api, jsonl([line("a")]), "user_data");
		await expect(make_(wrong)).rejects.toMatchObject({ status: 400, message: expect.stringContaining("purpose 'user_data'") });
		const off = await farm(standard, { settings: { files: null } });
		await expect(
			off.batches.create({ input_file_id: "file-x", endpoint: "/v1/chat/completions", completion_window: "24h" }, oai)
		).rejects.toMatchObject({
			status: 404,
			code: "files_disabled"
		});
	});

	it("cancels: validating or running batches end as cancelled with the unrun requests in the error file", async () => {
		const handler = hung();
		const api = await farm(handler, { settings: { batches: { concurrency: 1 } } });
		const made = await submit(api, [line("a"), line("b")]);
		await vi.waitFor(() => expect(handler.calls).toBe(1));
		const cancelling = await api.batches.cancel(made.id, oai);
		expect(cancelling.status).toBe("cancelling");
		expect(cancelling.cancelling_at).not.toBeNull();
		expect((await api.batches.cancel(made.id, oai)).status).toBe("cancelling");
		await finished(api, made.id, "cancelled");
		const done = await api.batches.get(made.id, oai);
		expect(done).toMatchObject({ output_file_id: null, request_counts: { total: 2, completed: 0, failed: 2 } });
		expect(done.cancelled_at).not.toBeNull();
		const rows = await lines(api, done.error_file_id);
		expect(rows.map((row) => row.error.code)).toEqual(["batch_cancelled", "batch_cancelled"]);
		expect(rows[0]).toMatchObject({ response: null, custom_id: "a" });
		await expect(api.batches.cancel(made.id, oai)).rejects.toMatchObject({
			status: 409,
			message: "Cannot cancel a batch with status 'cancelled'."
		});
	});

	it("cancels before the input is read", async () => {
		const api = await farm(hung());
		const made = await submit(api, [line("a")]);
		await api.batches.cancel(made.id, oai);
		await finished(api, made.id, "cancelled");
		expect((await api.batches.get(made.id, oai)).request_counts).toMatchObject({ total: 1, failed: 1 });
	});

	it("expires: what did not run in time goes to the error file as batch_expired", async () => {
		const api = await farm(hung(), { settings: { batches: { window: 1 } } });
		const made = await submit(api, [line("a")]);
		await finished(api, made.id, "expired");
		const done = await api.batches.get(made.id, oai);
		expect(done.expired_at).not.toBeNull();
		expect((await lines(api, done.error_file_id))[0].error.code).toBe("batch_expired");
	});

	it("lists newest first with limit and after, and does not show the other front's batches", async () => {
		const api = await farm();
		const ids = [];
		for (const name of ["a", "b", "c"]) {
			ids.push((await submit(api, [line(name)])).id);
			await new Promise((resolve) => setTimeout(resolve, 3));
		}
		const other = await api.batches.create({ requests: [entry("x")] }, ant);
		const all = await api.batches.list({}, oai);
		expect(all).toMatchObject({ object: "list", has_more: false, first_id: ids[2], last_id: ids[0] });
		const page = await api.batches.list({ limit: 2 }, oai);
		expect(page).toMatchObject({ has_more: true, last_id: ids[1] });
		expect((await api.batches.list({ after: ids[1] }, oai)).data.map((batch) => batch.id)).toEqual([ids[0]]);
		expect((await api.batches.list({ after: ids[0] }, oai)).data).toEqual([]);
		await expect(api.batches.list({ limit: 101 }, oai)).rejects.toMatchObject({ code: "invalid_limit" });
		await expect(api.batches.list({ after: "batch_nope0000" }, oai)).rejects.toMatchObject({ code: "invalid_cursor" });
		await expect(api.batches.get(other.id, oai)).rejects.toMatchObject({ status: 404 });
		await expect(api.batches.cancel(other.id, oai)).rejects.toMatchObject({ status: 404 });
		await expect(api.batches.results(ids[0], oai)).rejects.toMatchObject({ status: 404, code: "no_results_endpoint" });
		for (const id of ids) await finished(api, id, "completed");
	});

	it("deletes a finished batch through the leaf", async () => {
		const api = await farm();
		const made = await submit(api, [line("a")]);
		await finished(api, made.id, "completed");
		expect(await api.batches.remove(made.id, oai)).toEqual({ id: made.id, object: "batch", deleted: true });
	});
});

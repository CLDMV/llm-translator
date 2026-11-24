/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/responses-state.test.vitest.mjs
 *	@Date: 2026-11-23T12:00:00-08:00 (1795550400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-23T12:00:00-08:00 (1795550400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The stateful half of the Responses API: store access, items and their pagination, resolving `previous_response_id` and `conversation`,
 * and keeping a response.
 */

import { describe, expect, test } from "vitest";
import {
	append,
	begin,
	finish,
	fit,
	halt,
	itemsOf,
	joined,
	jobsOf,
	listOf,
	missing,
	plan,
	problem,
	progress,
	required,
	stateOf,
	viewOf
} from "../../src/lib/responses-state.mjs";
import { metadataOf, missing as noConversation, missingItem, publicOf } from "../../src/lib/conversations.mjs";

const context = (settings = {}) => ({ config: { settings }, state: {} });
const off = () => context({ responses: null });
const reply = (id, text, status = "completed") => ({
	id,
	object: "response",
	status,
	output: [{ type: "message", id: `msg_${id}`, role: "assistant", status: "completed", content: [{ type: "output_text", text }] }]
});
const request = (extra = {}) => ({ model: "m", input: "hi", ...extra });
// Plan a request and keep a reply to it, like a finished request does.
const answer = async (ctx, body, id, text = "ok", status = "completed") => {
	const made = await plan(request(body), ctx);
	await finish(made, reply(id, text, status), ctx);
	return made;
};

describe("errors and the store", () => {
	test("problem is a 400, or a 404 not_found_error", () => {
		expect(problem(400, "m", "c", "p")).toMatchObject({ status: 400, type: "invalid_request_error", code: "c", param: "p" });
		expect(problem(404, "m", "c")).toMatchObject({ status: 404, type: "not_found_error", param: null });
		expect(missing("resp_x")).toMatchObject({ status: 404, code: "response_not_found" });
		expect(noConversation("conv_x")).toMatchObject({ status: 404, code: "conversation_not_found" });
		expect(missingItem("msg_x")).toMatchObject({ status: 404, code: "item_not_found" });
	});

	test("the store is made once from the global setting, and null turns it off", () => {
		const ctx = context();
		const held = stateOf(ctx.config, ctx.state);
		expect(held.options).toMatchObject({ store: "memory" });
		expect(stateOf(ctx.config, ctx.state)).toBe(held);
		expect(required(ctx.config, ctx.state)).toBe(held);
		expect(stateOf(off().config, {})).toBeNull();
		expect(() => required(off().config, {})).toThrow(expect.objectContaining({ status: 404, code: "responses_disabled" }));
		expect(jobsOf(ctx.state)).toBe(jobsOf(ctx.state));
	});
});

describe("itemsOf", () => {
	test("makes ids, content parts and statuses, and does not change what it was given", () => {
		const given = [
			{ role: "user", content: "a" },
			{ type: "message", role: "assistant", content: "b", id: "msg_keep" },
			{ type: "message", role: "user", content: [{ type: "input_text", text: "c" }], status: "incomplete" },
			{ type: "function_call", call_id: "c1", name: "f", arguments: "{}", id: "" },
			{ type: "function_call_output", call_id: "c1", output: "x" },
			{ type: "reasoning", summary: [] }
		];
		const copy = structuredClone(given);
		const items = itemsOf(given);
		expect(given).toEqual(copy);
		expect(items[0]).toMatchObject({
			type: "message",
			id: expect.stringMatching(/^msg_/),
			status: "completed",
			content: [{ type: "input_text", text: "a" }]
		});
		expect(items[1]).toMatchObject({ id: "msg_keep", content: [{ type: "output_text", text: "b", annotations: [] }] });
		expect(items[2]).toMatchObject({ status: "incomplete", content: [{ type: "input_text", text: "c" }] });
		expect(items[3].id).toMatch(/^fc_/);
		expect(items[4].id).toMatch(/^fco_/);
		expect(items[5]).toMatchObject({ id: expect.stringMatching(/^rs_/) });
		expect(items[5]).not.toHaveProperty("status");
		expect(itemsOf("hello")).toEqual([
			{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }], id: expect.any(String), status: "completed" }
		]);
	});

	test("refuses what a history cannot hold", () => {
		expect(() => itemsOf([null])).toThrow(expect.objectContaining({ code: "invalid_request", param: "input[0]" }));
		expect(() => itemsOf([[]], "items")).toThrow(expect.objectContaining({ param: "items[0]" }));
		expect(() => itemsOf([{ type: "item_reference", id: "x" }])).toThrow(expect.objectContaining({ code: "unsupported_content" }));
		expect(() => itemsOf([{ foo: 1 }])).toThrow(/unsupported item type null/);
		expect(() => itemsOf([{ type: "constructor" }])).toThrow(expect.objectContaining({ code: "unsupported_content" }));
	});
});

describe("listOf", () => {
	const items = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
	const ids = (list) => list.data.map((item) => item.id);

	test("lists newest first by default, or oldest first with order asc, and says whether there is more", () => {
		expect(listOf(items)).toEqual({ object: "list", data: [...items].reverse(), first_id: "e", last_id: "a", has_more: false });
		expect(ids(listOf(items, { order: "asc", limit: "2" }))).toEqual(["a", "b"]);
		expect(listOf(items, { order: "asc", limit: 2 }).has_more).toBe(true);
		expect(listOf(items, {}, "asc").first_id).toBe("a");
		expect(listOf([])).toEqual({ object: "list", data: [], first_id: null, last_id: null, has_more: false });
	});

	test("pages with after and before in the order asked for", () => {
		expect(ids(listOf(items, { order: "asc", after: "b" }))).toEqual(["c", "d", "e"]);
		expect(ids(listOf(items, { after: "d" }))).toEqual(["c", "b", "a"]);
		expect(ids(listOf(items, { order: "asc", before: "d" }))).toEqual(["a", "b", "c"]);
		expect(ids(listOf(items, { order: "asc", after: "a", before: "e", limit: 2 }))).toEqual(["b", "c"]);
		expect(listOf(items, { order: "asc", after: "d", before: "b" }).data).toEqual([]);
	});

	test("refuses a bad order, limit or cursor", () => {
		expect(() => listOf(items, { order: "up" })).toThrow(expect.objectContaining({ code: "invalid_order" }));
		for (const limit of ["0", "101", "x", 1.5])
			expect(() => listOf(items, { limit })).toThrow(expect.objectContaining({ code: "invalid_limit" }));
		expect(() => listOf(items, { after: "zz" })).toThrow(expect.objectContaining({ status: 404, code: "item_not_found", param: "after" }));
		expect(() => listOf(items, { before: "zz" })).toThrow(expect.objectContaining({ status: 404, param: "before" }));
	});
});

describe("fit and append", () => {
	const item = (id) => ({ id });

	test("fit adds to the end, refuses repeats and overflow, or drops the oldest when trimming", () => {
		expect(fit([item("a")], [item("b")], 5, false)).toEqual([item("a"), item("b")]);
		expect(() => fit([item("a")], [item("a")], 5, false)).toThrow(expect.objectContaining({ code: "item_exists" }));
		expect(() => fit([], [item("a"), item("a")], 5, false)).toThrow(expect.objectContaining({ code: "item_exists" }));
		expect(() => fit([item("a")], [item("b")], 1, false)).toThrow(expect.objectContaining({ code: "conversation_full" }));
		expect(fit([item("a"), item("b")], [item("c")], 2, true)).toEqual([item("b"), item("c")]);
		expect(fit([item("a")], [item("a")], 5, true)).toHaveLength(2);
	});

	test("append changes a stored conversation, and answers null for one that is gone", async () => {
		const ctx = context();
		const { store } = required(ctx.config, ctx.state);
		await store.put("conversation", "conv_aaaaaaaaaaaa", { id: "conv_aaaaaaaaaaaa", items: [item("a")] });
		expect((await append(store, 5, "conv_aaaaaaaaaaaa", [item("b")], false)).items).toEqual([item("a"), item("b")]);
		expect(await append(store, 5, "conv_bbbbbbbbbbbb", [item("b")], false)).toBeNull();
	});
});

describe("plan", () => {
	test("is null without a store and for a body that is not an object", async () => {
		expect(await plan(request({ previous_response_id: "resp_x" }), off())).toBeNull();
		expect(await plan(null, context())).toBeNull();
		expect(await plan([], context())).toBeNull();
	});

	test("a plain request: stored, not in the background, no history; the stateful fields leave the body", async () => {
		const made = await plan(request({ store: true, background: false, previous_response_id: null, conversation: null }), context());
		expect(made).toMatchObject({
			id: expect.stringMatching(/^resp_/),
			body: { model: "m", input: "hi" },
			history: [],
			input: "hi",
			store: true,
			background: false,
			previous: null,
			conversation: null,
			echo: { store: true, background: false, previous_response_id: null, conversation: null }
		});
		expect(made.body).not.toHaveProperty("store");
		expect(made.body).not.toHaveProperty("conversation");
		expect((await plan(request({ store: false }), context())).store).toBe(false);
	});

	test("refuses malformed or conflicting parameters", async () => {
		const cases = [
			[{ previous_response_id: 5 }, "invalid_request", "previous_response_id"],
			[{ conversation: 5 }, "invalid_request", "conversation"],
			[{ conversation: "" }, "invalid_request", "conversation"],
			[{ conversation: {} }, "invalid_request", "conversation"],
			[{ previous_response_id: "resp_x", conversation: "conv_x" }, "mutually_exclusive_parameters", "conversation"],
			[{ store: "yes" }, "invalid_request", "store"],
			[{ background: 1 }, "invalid_request", "background"],
			[{ background: true, store: false }, "invalid_request", "background"]
		];
		for (const [extra, code, param] of cases) {
			await expect(plan(request(extra), context())).rejects.toMatchObject({ status: 400, code, param });
		}
	});

	test("previous_response_id: unknown, unfinished, or replayed as input then output, chained on", async () => {
		const ctx = context();
		await expect(plan(request({ previous_response_id: "resp_aaaaaaaaaaaa" }), ctx)).rejects.toMatchObject({
			status: 400,
			code: "previous_response_not_found",
			param: "previous_response_id"
		});
		const first = await answer(ctx, {}, "resp_aaaaaaaaaaaa", "one");
		expect(first.history).toEqual([]);
		const second = await plan(request({ previous_response_id: "resp_aaaaaaaaaaaa", input: "next" }), ctx);
		expect(second.history.map((item) => item.type)).toEqual(["message", "message"]);
		expect(second.history[0].content[0]).toEqual({ type: "input_text", text: "hi" });
		expect(second.history[1].content[0].text).toBe("one");
		expect(second.echo).toMatchObject({ previous_response_id: "resp_aaaaaaaaaaaa", conversation: null });
		await finish(second, reply("resp_bbbbbbbbbbbb", "two"), ctx);
		const third = await plan(request({ previous_response_id: "resp_bbbbbbbbbbbb" }), ctx);
		expect(third.history).toHaveLength(4);
		expect(joined(second)).toMatchObject({
			model: "m",
			input: [{ content: [{ text: "hi" }] }, { content: [{ text: "one" }] }, { type: "message", role: "user", content: "next" }]
		});
		const items = [{ type: "function_call_output", call_id: "c", output: "o" }];
		expect(joined({ ...second, input: items }).input.at(-1)).toBe(items[0]);
		// A response still being made cannot be continued.
		await begin(await plan(request({ background: true }), ctx), { ...reply("resp_cccccccccccc", ""), status: "queued" }, ctx);
		jobsOf(ctx.state).set("resp_cccccccccccc", { done: false });
		await expect(plan(request({ previous_response_id: "resp_cccccccccccc" }), ctx)).rejects.toMatchObject({
			code: "previous_response_in_progress"
		});
	});

	test("conversation: unknown, or its items as the history (by id or as an object)", async () => {
		const ctx = context();
		const { store } = required(ctx.config, ctx.state);
		await expect(plan(request({ conversation: "conv_aaaaaaaaaaaa" }), ctx)).rejects.toMatchObject({
			status: 404,
			code: "conversation_not_found",
			param: "conversation"
		});
		await store.put("conversation", "conv_aaaaaaaaaaaa", { id: "conv_aaaaaaaaaaaa", items: itemsOf("earlier") });
		for (const conversation of ["conv_aaaaaaaaaaaa", { id: "conv_aaaaaaaaaaaa" }]) {
			const made = await plan(request({ conversation }), ctx);
			expect(made.history).toHaveLength(1);
			expect(made.echo.conversation).toEqual({ id: "conv_aaaaaaaaaaaa" });
		}
	});
});

describe("keeping responses", () => {
	test("finish keeps a response with its input and history, and nothing for store: false", async () => {
		const ctx = context();
		const { store } = required(ctx.config, ctx.state);
		await answer(ctx, { store: false }, "resp_aaaaaaaaaaaa");
		expect(await store.get("response", "resp_aaaaaaaaaaaa")).toBeNull();
		await answer(ctx, {}, "resp_bbbbbbbbbbbb");
		expect(await store.get("response", "resp_bbbbbbbbbbbb")).toMatchObject({
			id: "resp_bbbbbbbbbbbb",
			background: false,
			conversation: null,
			history: [],
			input: [{ type: "message", role: "user" }],
			response: { status: "completed" }
		});
	});

	test("a conversation takes the input and output of a response that finished, trimmed to maxItems, and nothing from a failed one", async () => {
		const ctx = context({ responses: { maxItems: 3 } });
		const { store } = required(ctx.config, ctx.state);
		const id = "conv_aaaaaaaaaaaa";
		await store.put("conversation", id, { id, items: [] });
		await answer(ctx, { conversation: id }, "resp_aaaaaaaaaaaa", "one");
		expect((await store.get("conversation", id)).items.map((item) => item.role)).toEqual(["user", "assistant"]);
		expect((await store.get("response", "resp_aaaaaaaaaaaa")).history).toEqual([]);
		await answer(ctx, { conversation: id }, "resp_bbbbbbbbbbbb", "two", "incomplete");
		expect((await store.get("conversation", id)).items.map((item) => item.role)).toEqual(["assistant", "user", "assistant"]);
		await answer(ctx, { conversation: id }, "resp_cccccccccccc", "three", "failed");
		expect((await store.get("conversation", id)).items).toHaveLength(3);
		// A conversation deleted while the response ran just does not get the items.
		const made = await plan(request({ conversation: id }), ctx);
		await store.remove("conversation", id);
		await finish(made, reply("resp_dddddddddddd", "four"), ctx);
		expect(await store.get("conversation", id)).toBeNull();
		expect(await store.get("response", "resp_dddddddddddd")).not.toBeNull();
	});

	test("a background response is queued, in progress, then replaced by its end, unless cancelled or deleted meanwhile", async () => {
		const ctx = context();
		const { store } = required(ctx.config, ctx.state);
		const run = async (id, change) => {
			const made = await plan(request({ background: true }), ctx);
			await begin(made, { ...reply(id, ""), status: "queued" }, ctx);
			expect((await store.get("response", id)).response.status).toBe("queued");
			await progress(id, { ...reply(id, ""), status: "in_progress" }, ctx);
			expect((await store.get("response", id)).response.status).toBe("in_progress");
			await change?.(id);
			await progress(id, { ...reply(id, ""), status: "in_progress" }, ctx);
			await finish(made, reply(id, "done"), ctx);
			return store.get("response", id);
		};
		expect((await run("resp_aaaaaaaaaaaa")).response.output[0].content[0].text).toBe("done");
		const cancelled = await run("resp_bbbbbbbbbbbb", (id) =>
			store.update("response", id, (current) => ({ ...current, response: { ...current.response, status: "cancelled" } }))
		);
		expect(cancelled.response.status).toBe("cancelled");
		expect(await run("resp_cccccccccccc", (id) => store.remove("response", id))).toBeNull();
	});

	test("viewOf reports a response with no job left as failed", async () => {
		const ctx = context();
		const done = { response: reply("resp_aaaaaaaaaaaa", "x") };
		expect(viewOf(done, ctx.state)).toBe(done.response);
		const live = { response: { ...reply("resp_bbbbbbbbbbbb", ""), status: "in_progress" } };
		expect(viewOf(live, ctx.state)).toMatchObject({ status: "failed", error: { code: "server_error" } });
		jobsOf(ctx.state).set("resp_bbbbbbbbbbbb", { done: true });
		expect(viewOf(live, ctx.state).status).toBe("failed");
		jobsOf(ctx.state).set("resp_bbbbbbbbbbbb", { done: false });
		expect(viewOf(live, ctx.state)).toBe(live.response);
	});
});

describe("halt", () => {
	test("cancels a live response and stops its job, and leaves one that is not running as it is", async () => {
		const ctx = context();
		const { store } = required(ctx.config, ctx.state);
		await expect(halt(store, ctx.state, "resp_aaaaaaaaaaaa")).rejects.toMatchObject({ status: 404, code: "response_not_found" });
		await answer(ctx, {}, "resp_aaaaaaaaaaaa");
		await expect(halt(store, ctx.state, "resp_aaaaaaaaaaaa")).rejects.toMatchObject({ status: 400, code: "not_background" });
		const made = await plan(request({ background: true }), ctx);
		await begin(made, { ...reply("resp_bbbbbbbbbbbb", ""), status: "queued" }, ctx);
		// No job: the translator restarted, so it already counts as failed.
		expect((await halt(store, ctx.state, "resp_bbbbbbbbbbbb")).status).toBe("failed");
		const job = { id: "resp_bbbbbbbbbbbb", done: false, cancelled: false, controller: new AbortController(), waiters: new Set() };
		jobsOf(ctx.state).set(job.id, job);
		expect((await halt(store, ctx.state, "resp_bbbbbbbbbbbb")).status).toBe("cancelled");
		expect(job).toMatchObject({ cancelled: true, done: true });
		expect(job.controller.signal.aborted).toBe(true);
		expect((await store.get("response", "resp_bbbbbbbbbbbb")).response.status).toBe("cancelled");
		expect((await halt(store, ctx.state, "resp_bbbbbbbbbbbb")).status).toBe("cancelled");
	});

	test("a response deleted or finished while it is being cancelled stands as it is", async () => {
		const ctx = context();
		const live = { background: true, response: { id: "resp_x", status: "in_progress" } };
		jobsOf(ctx.state).set("resp_x", { id: "resp_x", done: false, controller: new AbortController(), waiters: new Set() });
		const store = { get: async () => live, update: async () => null };
		expect(await halt(store, ctx.state, "resp_x")).toEqual({ id: "resp_x", status: "cancelled" });
		const finished = { ...live, response: { id: "resp_x", status: "completed" } };
		let seen;
		const racing = {
			get: async () => live,
			update: async (_kind, _id, change) => {
				seen = change(finished);
				return finished;
			}
		};
		jobsOf(ctx.state).set("resp_x", { id: "resp_x", done: false, controller: new AbortController(), waiters: new Set() });
		expect((await halt(racing, ctx.state, "resp_x")).status).toBe("completed");
		expect(seen).toBeUndefined();
	});
});

describe("conversation objects", () => {
	test("metadata is checked: 16 string values, keys up to 64 characters, values up to 512", () => {
		expect(metadataOf(undefined)).toEqual({});
		expect(metadataOf(null)).toEqual({});
		expect(metadataOf({ a: "b" })).toEqual({ a: "b" });
		const bad = [
			"x",
			[],
			Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`k${index}`, "v"])),
			{ ["k".repeat(65)]: "v" },
			{ a: 1 },
			{ a: "v".repeat(513) }
		];
		for (const value of bad)
			expect(() => metadataOf(value)).toThrow(expect.objectContaining({ code: "invalid_metadata", param: "metadata" }));
		expect(publicOf({ id: "conv_x", created_at: 5, metadata: { a: "b" }, items: [] })).toEqual({
			id: "conv_x",
			object: "conversation",
			created_at: 5,
			metadata: { a: "b" }
		});
	});
});

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/responses-state.test.vitest.mjs
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
 * @fileoverview The stateful Responses leaves (`responses.*` and `conversations.*`) called as a library, without a server.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, make } from "../helpers/translator.mjs";

afterEach(closeAll);

const compat = { url: "http://a.test", backend: "compatible" };
const user = (text, extra = {}) => ({ type: "message", role: "user", content: text, ...extra });

describe("the conversations leaves", () => {
	it("create, read, update, delete and fill a conversation", async () => {
		const api = await make({ upstreams: [compat], detect: false });
		const made = await api.conversations.create();
		expect(made).toMatchObject({ object: "conversation", metadata: {} });
		expect(await api.conversations.create(null)).toMatchObject({ metadata: {} });
		expect(await api.conversations.create({ items: null, metadata: { a: "b" } })).toMatchObject({ metadata: { a: "b" } });
		expect(await api.conversations.get(made.id)).toEqual(made);
		expect(await api.conversations.update(made.id, { metadata: { k: "v" } })).toEqual({ ...made, metadata: { k: "v" } });
		const added = await api.conversations.items.create(made.id, { items: [user("a"), user("b", { id: "msg_b" })] });
		expect(added.data.map((item) => item.type)).toEqual(["message", "message"]);
		expect((await api.conversations.items.list(made.id)).data.map((item) => item.id)).toEqual(["msg_b", added.data[0].id]);
		expect(await api.conversations.items.get(made.id, "msg_b")).toMatchObject({
			role: "user",
			content: [{ type: "input_text", text: "b" }]
		});
		expect(await api.conversations.items.remove(made.id, "msg_b")).toMatchObject({ id: made.id, metadata: { k: "v" } });
		expect(await api.conversations.remove(made.id)).toEqual({ id: made.id, object: "conversation.deleted", deleted: true });
	});

	it("refuse what is wrong and say what is missing", async () => {
		const api = await make({ upstreams: [compat], detect: false, settings: { responses: { maxItems: 2 } } });
		const made = await api.conversations.create({ items: [user("a")] });
		const bad = { status: 400, type: "invalid_request_error" };
		await expect(api.conversations.create({ items: "x" })).rejects.toMatchObject({ ...bad, param: "items" });
		await expect(api.conversations.create({ items: Array.from({ length: 21 }, () => user("x")) })).rejects.toMatchObject(bad);
		await expect(api.conversations.create({ items: [user("a"), user("b"), user("c")] })).rejects.toMatchObject({
			code: "conversation_full"
		});
		await expect(api.conversations.create({ metadata: [] })).rejects.toMatchObject({ code: "invalid_metadata" });
		await expect(api.conversations.update(made.id)).rejects.toMatchObject({ ...bad, param: "metadata" });
		await expect(api.conversations.update(made.id, { metadata: null })).rejects.toMatchObject(bad);
		await expect(api.conversations.update("conv_nope00000000", { metadata: {} })).rejects.toMatchObject({ status: 404 });
		await expect(api.conversations.items.create(made.id)).rejects.toMatchObject(bad);
		await expect(api.conversations.items.create(made.id, { items: [] })).rejects.toMatchObject(bad);
		await expect(api.conversations.items.create(made.id, { items: [user("b"), user("c")] })).rejects.toMatchObject({
			code: "conversation_full"
		});
		await expect(api.conversations.items.create(made.id, { items: [{ type: "web_search_call" }] })).rejects.toMatchObject({
			code: "unsupported_content"
		});
		await expect(api.conversations.items.create("conv_nope00000000", { items: [user("x")] })).rejects.toMatchObject({ status: 404 });
		await expect(api.conversations.items.get(made.id, "msg_nope")).rejects.toMatchObject({ status: 404, code: "item_not_found" });
		await expect(api.conversations.items.remove(made.id, "msg_nope")).rejects.toMatchObject({ status: 404, code: "item_not_found" });
		await expect(api.conversations.items.list(made.id, { after: "msg_nope" })).rejects.toMatchObject({ status: 404 });
	});
});

describe("the responses leaves", () => {
	it("say a response is unknown, and that stored responses are off when the setting is null", async () => {
		const api = await make({ upstreams: [compat], detect: false });
		for (const call of [
			() => api.responses.get("resp_nope00000000"),
			() => api.responses.remove("resp_nope00000000"),
			() => api.responses.cancel("resp_nope00000000"),
			() => api.responses.input.list("resp_nope00000000")
		]) {
			await expect(call()).rejects.toMatchObject({ status: 404, code: "response_not_found" });
		}
		const off = await make({ upstreams: [compat], detect: false, settings: { responses: null } });
		for (const call of [
			() => off.responses.get("resp_x"),
			() => off.responses.remove("resp_x"),
			() => off.responses.cancel("resp_x"),
			() => off.responses.input.list("resp_x"),
			() => off.conversations.create(),
			() => off.conversations.get("conv_x"),
			() => off.conversations.update("conv_x", { metadata: {} }),
			() => off.conversations.remove("conv_x"),
			() => off.conversations.items.create("conv_x", { items: [] }),
			() => off.conversations.items.list("conv_x"),
			() => off.conversations.items.get("conv_x", "msg_x"),
			() => off.conversations.items.remove("conv_x", "msg_x")
		]) {
			await expect(call()).rejects.toMatchObject({ status: 404, code: "responses_disabled" });
		}
	});
});

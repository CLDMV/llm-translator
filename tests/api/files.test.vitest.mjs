/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/files.test.vitest.mjs
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

import { afterEach, describe, expect, it } from "vitest";
import { closeAll, make } from "../helpers/translator.mjs";
import { makePdf } from "../helpers/pdf.mjs";

afterEach(closeAll);

const PDF = Buffer.from(makePdf(["Quarterly figures"]));
const claude = { url: "https://api.anthropic.com", apiKey: "k", backend: "anthropic" };
const compat = { url: "http://a.test", backend: "compatible" };
const upload = (api, extra = {}, options = {}) =>
	api.files.create({ filename: "a.pdf", data: PDF, type: "application/pdf", fields: {}, ...extra }, options);

describe("the files leaves", () => {
	it("store, read and delete without a server, in either front's shape", async () => {
		const api = await make({ upstreams: [compat], detect: false });
		const made = await upload(api);
		expect(made).toMatchObject({ type: "file", size_bytes: PDF.length });
		expect(await api.files.get(made.id)).toEqual(made);
		expect((await api.files.list()).data).toHaveLength(1);
		expect(await api.files.remove(made.id)).toEqual({ id: made.id, type: "file_deleted" });
		await expect(api.files.get(made.id)).rejects.toMatchObject({ status: 404, code: "file_not_found" });
		await expect(api.files.content(made.id, { front: "openai" })).rejects.toMatchObject({ status: 404 });
		await expect(api.files.remove(made.id, { front: "openai" })).rejects.toMatchObject({ status: 404 });
		const other = await upload(api, { fields: { purpose: "vision" } }, { front: "openai" });
		expect(other).toMatchObject({ object: "file", purpose: "vision" });
		expect((await api.files.content(other.id, { front: "openai" })).data.equals(PDF)).toBe(true);
		await expect(api.files.content(other.id)).rejects.toMatchObject({ status: 400, code: "not_downloadable" });
		expect(await api.files.remove(other.id, { front: "openai" })).toEqual({ id: other.id, object: "file", deleted: true });
		expect((await api.files.list({}, { front: "openai" })).data).toEqual([]);
	});

	it("work with the Anthropic beta shape when asked", async () => {
		const api = await make({ upstreams: [compat], detect: false });
		const made = await upload(api, {}, { beta: true });
		expect(made).not.toHaveProperty("expires_at");
		expect(await api.files.get(made.id, { beta: true })).not.toHaveProperty("expires_at");
		expect(await api.files.list({}, { beta: true })).toMatchObject({ has_more: false, first_id: made.id });
	});

	it("are off when the files setting is null", async () => {
		const api = await make({ upstreams: [compat], detect: false, settings: { files: null } });
		for (const call of [
			() => upload(api),
			() => api.files.list(),
			() => api.files.get("file_aaaaaaaaaaaa"),
			() => api.files.content("file_aaaaaaaaaaaa"),
			() => api.files.remove("file_aaaaaaaaaaaa")
		]) {
			await expect(call()).rejects.toMatchObject({ status: 404, code: "files_disabled" });
		}
		// A reference then is just an id nobody holds: forwarded on a native route.
		const native = await make({ upstreams: [claude], detect: false, settings: { files: null } });
		const body = {
			model: "claude-sonnet-5-5",
			max_tokens: 5,
			messages: [{ role: "user", content: [{ type: "document", source: { type: "file", file_id: "file_x" } }] }]
		};
		expect((await native.request(body)).body.messages[0].content[0].source).toEqual({ type: "file", file_id: "file_x" });
	});

	it("refuse a bad upload", async () => {
		const api = await make({ upstreams: [compat], detect: false });
		await expect(upload(api, { filename: "a/b" })).rejects.toMatchObject({ code: "invalid_filename" });
		await expect(upload(api, { fields: undefined, type: undefined })).resolves.toMatchObject({ mime_type: "application/pdf" });
		await expect(upload(api, { fields: { purpose: "nope" } }, { front: "openai" })).rejects.toMatchObject({ code: "invalid_purpose" });
	});
});

describe("references against the routes a request can take", () => {
	const doc = (file_id) => ({
		model: "claude-sonnet-5-5",
		max_tokens: 5,
		messages: [{ role: "user", content: [{ type: "document", source: { type: "file", file_id } }] }]
	});

	it("a native Anthropic route gets base64 for a file this translator holds, and forwards an id it does not hold", async () => {
		const api = await make({ upstreams: [claude], detect: false });
		const made = await upload(api);
		const prepared = await api.request(doc(made.id));
		expect(prepared.body.messages[0].content[0].source).toEqual({
			type: "base64",
			media_type: "application/pdf",
			data: PDF.toString("base64")
		});
		const theirs = await api.request(doc("file_011CNha8iCJcU1wXNR6q4V8w"));
		expect(theirs.body.messages[0].content[0].source).toEqual({ type: "file", file_id: "file_011CNha8iCJcU1wXNR6q4V8w" });
	});

	it("a converting route reads a held file and refuses an unknown one with not_found", async () => {
		const api = await make({ upstreams: [compat], detect: false, settings: { images: false } });
		const made = await upload(api);
		const prepared = await api.request({ ...doc(made.id), model: "m" });
		expect(JSON.stringify(prepared.body)).toContain("Quarterly figures");
		await expect(api.request({ ...doc("file_unknown0000"), model: "m" })).rejects.toMatchObject({ status: 404, code: "file_not_found" });
	});

	it("the OpenAI front reaches an Anthropic upstream with the file as a document, and an unknown id fails", async () => {
		const api = await make({ upstreams: [claude], detect: false, front: "openai" });
		const made = await upload(api, { fields: { purpose: "user_data" } }, { front: "openai" });
		const chat = (file_id) => ({
			model: "claude-sonnet-5-5",
			max_tokens: 5,
			messages: [{ role: "user", content: [{ type: "file", file: { file_id } }] }]
		});
		const prepared = await api.request(chat(made.id));
		expect(prepared.body.messages[0].content[0]).toMatchObject({
			type: "document",
			source: { type: "base64", media_type: "application/pdf" }
		});
		await expect(api.request(chat("file-unknown00000"))).rejects.toMatchObject({
			status: 404,
			message: "No such File object: file-unknown00000"
		});
	});

	it("a Responses upstream is sent the file as content, and takes ids it does not hold from an OpenAI client", async () => {
		const api = await make({
			upstreams: [{ url: "https://api.openai.com", apiKey: "k", backend: "openai", api: "openai.responses" }],
			detect: false,
			front: "openai"
		});
		const made = await upload(api, { fields: { purpose: "user_data" } }, { front: "openai" });
		const chat = (file_id) => ({ model: "gpt-x", messages: [{ role: "user", content: [{ type: "file", file: { file_id } }] }] });
		const held = await api.request(chat(made.id));
		expect(JSON.stringify(held.body)).toContain("data:application/pdf;base64,");
		const theirs = await api.request(chat("file-theirs0000000"));
		expect(JSON.stringify(theirs.body)).toContain("file-theirs0000000");
	});
});

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/server/files.test.vitest.mjs
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
import fs from "node:fs";
import path from "node:path";
import { closeAll, make } from "../helpers/translator.mjs";
import { completion, fakeVllm, json } from "../helpers/fake-server.mjs";
import { makePdf } from "../helpers/pdf.mjs";

afterEach(closeAll);

const PDF = Buffer.from(makePdf(["Quarterly figures"]));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64");
const BETA = { "anthropic-beta": "files-api-2025-04-14" };

/** An upload as a browser or SDK sends it. */
const upload = (url, { filename = "a.pdf", type = "application/pdf", bytes = PDF, fields = {}, headers = {} } = {}) => {
	const form = new FormData();
	for (const [name, value] of Object.entries(fields)) form.set(name, value);
	form.set("file", new Blob([bytes], { type }), filename);
	return fetch(`${url}/v1/files`, { method: "POST", headers, body: form });
};
const get = (url, route, headers = {}) => fetch(`${url}${route}`, { headers });
const post = (url, route, body, headers = {}) =>
	fetch(`${url}${route}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

/** A server on the given front, with the vLLM stand-in that records what it was sent. */
const start = async (front, config = {}) => {
	const sent = [];
	const upstream = await fakeVllm({
		chat: (_req, body, res) => {
			sent.push(body);
			json(res, 200, completion("seen"));
		}
	});
	const api = await make({ upstreams: [upstream.url], front, ...config });
	const server = await api.server.start({ port: 0, front });
	// Startup asked the upstream whether it accepts images; only what a test sends counts.
	sent.length = 0;
	return { api, server, upstream, sent, url: server.url };
};

describe("Anthropic front: /v1/files", () => {
	it("uploads, lists, retrieves and deletes with Anthropic's shapes", async () => {
		const { url, upstream } = await start("anthropic");
		try {
			const made = await upload(url);
			expect(made.status).toBe(200);
			const file = await made.json();
			expect(file).toMatchObject({
				id: expect.stringMatching(/^file_[0-9a-f]{24}$/),
				type: "file",
				filename: "a.pdf",
				mime_type: "application/pdf",
				size_bytes: PDF.length,
				downloadable: false,
				expires_at: null
			});
			expect(new Date(file.created_at).toISOString()).toBe(file.created_at);
			const image = await (await upload(url, { filename: "p.png", type: "image/png", bytes: PNG })).json();

			const list = await (await get(url, "/v1/files")).json();
			expect(list.data.map((entry) => entry.id).sort()).toEqual([image.id, file.id].sort());
			expect(list.next_page).toBeNull();
			const paged = await (await get(url, "/v1/files?limit=1")).json();
			expect(paged.data).toHaveLength(1);
			expect(paged.next_page).toBe(paged.data[0].id);
			const next = await (await get(url, `/v1/files?limit=1&page=${paged.next_page}`)).json();
			expect(next.data).toHaveLength(1);
			expect(next.data[0].id).not.toBe(paged.data[0].id);
			const lookup = await (await get(url, `/v1/files?ids[]=${file.id}&ids[]=file_unknown00000`)).json();
			expect(lookup.data.map((entry) => entry.id)).toEqual([file.id]);
			const single = await (await get(url, `/v1/files?ids=${file.id}`)).json();
			expect(single.data).toHaveLength(1);
			const legacy = await (await get(url, "/v1/files?limit=1", BETA)).json();
			expect(legacy).toMatchObject({ has_more: true, first_id: expect.any(String), last_id: expect.any(String) });
			expect(legacy.data[0]).not.toHaveProperty("expires_at");
			expect((await get(url, "/v1/files?after_id=x")).status).toBe(400);

			expect(await (await get(url, `/v1/files/${file.id}`)).json()).toEqual(file);
			expect(await (await get(url, `/v1/files/${file.id}`, BETA)).json()).not.toHaveProperty("expires_at");

			const content = await get(url, `/v1/files/${file.id}/content`);
			expect(content.status).toBe(400);
			expect(await content.json()).toMatchObject({
				type: "error",
				error: { type: "invalid_request_error", message: expect.stringContaining("not downloadable") }
			});

			const gone = await fetch(`${url}/v1/files/${file.id}`, { method: "DELETE" });
			expect(await gone.json()).toEqual({ id: file.id, type: "file_deleted" });
			const missing = await get(url, `/v1/files/${file.id}`);
			expect(missing.status).toBe(404);
			expect(await missing.json()).toMatchObject({
				type: "error",
				error: { type: "not_found_error", message: `File \`${file.id}\` not found.` }
			});
			expect((await fetch(`${url}/v1/files/${file.id}`, { method: "DELETE" })).status).toBe(404);
			expect((await get(url, `/v1/files/${file.id}/content`)).status).toBe(404);
		} finally {
			await upstream.close();
		}
	});

	it("lets a message reference an uploaded PDF and image, which the existing pipelines read", async () => {
		const { url, upstream, sent } = await start("anthropic");
		try {
			const pdf = await (await upload(url)).json();
			const image = await (await upload(url, { filename: "p.png", type: "image/png", bytes: PNG })).json();
			const reply = await post(url, "/v1/messages", {
				model: "qwen3-coder",
				max_tokens: 50,
				messages: [
					{
						role: "user",
						content: [
							{ type: "text", text: "compare" },
							{ type: "document", source: { type: "file", file_id: pdf.id }, title: "Figures" },
							{ type: "image", source: { type: "file", file_id: image.id } }
						]
					}
				]
			});
			expect(reply.status).toBe(200);
			expect((await reply.json()).content[0].text).toBe("seen");
			const text = JSON.stringify(sent.at(-1));
			expect(text).toContain("Quarterly figures");
			expect(text).toContain(`data:image/png;base64,${PNG.toString("base64")}`);
		} finally {
			await upstream.close();
		}
	});

	it("answers a reference to an unknown file with not_found_error", async () => {
		const { url, upstream, sent } = await start("anthropic");
		try {
			const reply = await post(url, "/v1/messages", {
				model: "qwen3-coder",
				max_tokens: 50,
				messages: [{ role: "user", content: [{ type: "image", source: { type: "file", file_id: "file_unknown00000" } }] }]
			});
			expect(reply.status).toBe(404);
			expect(await reply.json()).toMatchObject({ error: { type: "not_found_error", message: "File `file_unknown00000` not found." } });
			expect(sent).toHaveLength(0);
		} finally {
			await upstream.close();
		}
	});

	it("refuses a request without a file part, a malformed upload and a bad expiry or name", async () => {
		const { url, upstream } = await start("anthropic");
		try {
			expect((await post(url, "/v1/files", {})).status).toBe(400);
			const form = new FormData();
			form.set("note", "no file here");
			const none = await fetch(`${url}/v1/files`, { method: "POST", body: form });
			expect(none.status).toBe(400);
			expect((await none.json()).error.message).toContain("file");
			const broken = await fetch(`${url}/v1/files`, {
				method: "POST",
				headers: { "content-type": "multipart/form-data; boundary=abc" },
				body: "--abc\r\nbroken"
			});
			expect(broken.status).toBe(400);
			expect((await broken.json()).error.message).toContain("multipart");
			expect((await upload(url, { fields: { expires_in_seconds: "5" } })).status).toBe(400);
			expect((await upload(url, { filename: "a/b.pdf" })).status).toBe(400);
			const timed = await (await upload(url, { fields: { expires_in_seconds: "3600" } })).json();
			expect(timed.expires_at).toEqual(expect.any(String));
		} finally {
			await upstream.close();
		}
	});

	it("enforces the store limits, with the files setting", async () => {
		const { url, upstream } = await start("anthropic", { settings: { files: { maxFileSize: 100, maxCount: 2 } } });
		try {
			const big = await upload(url, { bytes: Buffer.alloc(101) });
			expect(big.status).toBe(413);
			expect((await big.json()).error.type).toBe("request_too_large");
			// Far above the limit: the body limit of the route answers first.
			expect((await upload(url, { bytes: Buffer.alloc(2 * 1024 * 1024) })).status).toBe(413);
			expect((await upload(url, { bytes: Buffer.alloc(10) })).status).toBe(200);
			expect((await upload(url, { bytes: Buffer.alloc(10) })).status).toBe(200);
			const third = await upload(url, { bytes: Buffer.alloc(10) });
			expect(third.status).toBe(400);
			expect((await third.json()).error.message).toContain("2 files");
		} finally {
			await upstream.close();
		}
	});

	it("is off when files is null", async () => {
		const { url, upstream } = await start("anthropic", { settings: { files: null } });
		try {
			for (const reply of [
				await upload(url),
				await get(url, "/v1/files"),
				await get(url, "/v1/files/file_aaaaaaaaaaaa"),
				await get(url, "/v1/files/file_aaaaaaaaaaaa/content")
			]) {
				expect(reply.status).toBe(404);
				expect((await reply.json()).error.message).toContain("Files API is off");
			}
			expect((await fetch(`${url}/v1/files/file_aaaaaaaaaaaa`, { method: "DELETE" })).status).toBe(404);
		} finally {
			await upstream.close();
		}
	});

	it("is behind the server's API key like every other route", async () => {
		const upstreamServer = await fakeVllm();
		try {
			const api = await make({ upstreams: [upstreamServer.url] });
			const server = await api.server.start({ port: 0, apiKey: "secret" });
			expect((await upload(server.url)).status).toBe(401);
			expect((await get(server.url, "/v1/files")).status).toBe(401);
			expect((await upload(server.url, { headers: { "x-api-key": "secret" } })).status).toBe(200);
		} finally {
			await upstreamServer.close();
		}
	});
});

describe("OpenAI front: /v1/files", () => {
	it("uploads with a purpose, lists, retrieves, reads back and deletes with OpenAI's shapes", async () => {
		const { url, upstream } = await start("openai");
		try {
			const made = await upload(url, { fields: { purpose: "user_data" } });
			expect(made.status).toBe(200);
			const file = await made.json();
			expect(file).toMatchObject({
				id: expect.stringMatching(/^file-[0-9a-f]{24}$/),
				object: "file",
				bytes: PDF.length,
				filename: "a.pdf",
				purpose: "user_data",
				status: "processed"
			});
			expect(file.created_at).toEqual(expect.any(Number));
			await upload(url, { filename: "p.png", type: "image/png", bytes: PNG, fields: { purpose: "vision" } });

			const list = await (await get(url, "/v1/files")).json();
			expect(list).toMatchObject({ object: "list", has_more: false });
			expect(list.data).toHaveLength(2);
			expect((await (await get(url, "/v1/files?purpose=vision")).json()).data).toHaveLength(1);
			expect((await (await get(url, "/v1/files?limit=1&order=asc")).json()).has_more).toBe(true);
			expect((await get(url, "/v1/files?order=sideways")).status).toBe(400);

			expect(await (await get(url, `/v1/files/${file.id}`)).json()).toEqual(file);
			const content = await get(url, `/v1/files/${file.id}/content`);
			expect(content.status).toBe(200);
			expect(content.headers.get("content-type")).toBe("application/pdf");
			expect(Buffer.from(await content.arrayBuffer()).equals(PDF)).toBe(true);

			expect(await (await fetch(`${url}/v1/files/${file.id}`, { method: "DELETE" })).json()).toEqual({
				id: file.id,
				object: "file",
				deleted: true
			});
			const missing = await get(url, `/v1/files/${file.id}`);
			expect(missing.status).toBe(404);
			expect(await missing.json()).toMatchObject({ error: { message: `No such File object: ${file.id}`, type: "invalid_request_error" } });
		} finally {
			await upstream.close();
		}
	});

	it("needs a valid purpose, and reads expires_after", async () => {
		const { url, upstream } = await start("openai");
		try {
			const none = await upload(url);
			expect(none.status).toBe(400);
			expect((await none.json()).error.message).toContain("purpose");
			expect((await upload(url, { fields: { purpose: "tea" } })).status).toBe(400);
			const timed = await (
				await upload(url, { fields: { purpose: "user_data", "expires_after[anchor]": "created_at", "expires_after[seconds]": "3600" } })
			).json();
			expect(timed.expires_at - timed.created_at).toBe(3600);
		} finally {
			await upstream.close();
		}
	});

	it("lets a chat request reference an uploaded file by id, and forwards an id it does not hold on a route that goes through as it is", async () => {
		const { url, upstream, sent } = await start("openai");
		try {
			const file = await (await upload(url, { fields: { purpose: "user_data" } })).json();
			const ask = (part) =>
				post(url, "/v1/chat/completions", {
					model: "qwen3-coder",
					messages: [{ role: "user", content: [{ type: "text", text: "read" }, part] }]
				});
			expect((await ask({ type: "file", file: { file_id: file.id } })).status).toBe(200);
			expect(sent.at(-1).messages[0].content[1]).toEqual({
				type: "file",
				file: { file_data: `data:application/pdf;base64,${PDF.toString("base64")}`, filename: "a.pdf" }
			});
			expect((await ask({ type: "file", file: { file_id: "file-theirs0000000" } })).status).toBe(200);
			expect(sent.at(-1).messages[0].content[1]).toEqual({ type: "file", file: { file_id: "file-theirs0000000" } });
		} finally {
			await upstream.close();
		}
	});
});

describe("files kept on disk", () => {
	it("survive the store and are removed with the file", async () => {
		fs.mkdirSync(path.join(process.cwd(), "tmp"), { recursive: true });
		const dir = fs.mkdtempSync(path.join(process.cwd(), "tmp", "files-api-"));
		const { url, upstream } = await start("anthropic", { settings: { files: { store: "disk", dir } } });
		try {
			const file = await (await upload(url)).json();
			expect(fs.readdirSync(dir).sort()).toEqual([`${file.id}.bin`, `${file.id}.json`]);
			expect(Buffer.from(fs.readFileSync(path.join(dir, `${file.id}.bin`))).equals(PDF)).toBe(true);
			await fetch(`${url}/v1/files/${file.id}`, { method: "DELETE" });
			expect(fs.readdirSync(dir)).toEqual([]);
		} finally {
			await upstream.close();
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

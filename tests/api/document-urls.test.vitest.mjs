/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/document-urls.test.vitest.mjs
 *	@Date: 2026-11-19T12:00:00-08:00 (1795118400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-19T12:00:00-08:00 (1795118400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Fetching `url` documents through the root api: off by default, the allow-list and limits, a PDF and a text round trip through the
 * existing document path, the `documentConverter` override, and the events. Documents come from a local server on 127.0.0.1.
 */
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeAll, fakeTransport, make } from "../helpers/translator.mjs";
import { completion } from "../helpers/fake-server.mjs";
import { makePdf } from "../helpers/pdf.mjs";

let server;
let base;
let hits;

beforeEach(async () => {
	hits = [];
	server = http.createServer((req, res) => {
		hits.push(req.url);
		if (req.url.startsWith("/report.pdf")) {
			res.writeHead(200, { "content-type": "application/pdf" });
			return res.end(Buffer.from(makePdf(["Quarterly", "Pagetwo"], "Report")));
		}
		if (req.url === "/notes.txt") {
			res.writeHead(200, { "content-type": "text/plain" });
			return res.end("plain notes body");
		}
		if (req.url === "/page.html") {
			res.writeHead(200, { "content-type": "text/html" });
			return res.end("<html></html>");
		}
		if (req.url === "/redirect") {
			res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
			return res.end();
		}
		res.writeHead(404, { "content-type": "text/plain" });
		return res.end("missing");
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
	await closeAll();
	server.closeAllConnections();
	await new Promise((resolve) => server.close(resolve));
});

const open = { allow: ["127.0.0.1"], allowPrivate: true };
const upstream = (backend = "vllm") => ({ name: "u", url: "http://u.test", backend });
const ask = (...content) => ({
	model: "m",
	max_tokens: 16,
	messages: [{ role: "user", content: [...content, { type: "text", text: "summarize" }] }]
});
const doc = (path, extra = {}) => ({ type: "document", title: "Doc", source: { type: "url", url: `${base}${path}` }, ...extra });
const texts = (sent) =>
	sent.body.messages
		.flatMap((message) => (Array.isArray(message.content) ? message.content : [message.content]))
		.map((part) => (typeof part === "string" ? part : (part.text ?? "")));
const watch = (api) => {
	const seen = [];
	api.events.on("document", (event) => seen.push(event));
	return seen;
};

describe("fetching URL documents", () => {
	it("is off by default: the document becomes a note and nothing is fetched", async () => {
		const api = await make({ upstreams: [upstream()], detect: false });
		const sent = await api.request(ask(doc("/report.pdf")));
		expect(texts(sent).join("\n")).toContain("documents referenced by URL cannot be fetched by the translator");
		expect(hits).toEqual([]);
	});

	it("turns a PDF into page text through the existing PDF path", async () => {
		const api = await make({ upstreams: [upstream()], detect: false, settings: { documentUrls: open } });
		const sent = await api.request(ask(doc("/report.pdf?sig=SECRET")));
		const text = texts(sent).join("\n");
		expect(text).toContain('Document "Doc" (2 pages)');
		expect(text).toContain("Quarterly");
		expect(text).toContain("Pagetwo");
		expect(hits).toEqual(["/report.pdf?sig=SECRET"]);
	});

	it("keeps plain text as text", async () => {
		const api = await make({ upstreams: [upstream()], detect: false, settings: { documentUrls: open } });
		const sent = await api.request(ask(doc("/notes.txt")));
		expect(texts(sent).join("\n")).toContain('<document title="Doc">\nplain notes body\n</document>');
	});

	it("works from the upstream's own settings too, and for send()", async () => {
		const transport = fakeTransport(() => ({ body: completion("ok") }));
		const api = await make({ upstreams: [{ ...upstream(), settings: { documentUrls: open } }], transport, detect: false });
		const reply = await api.send(ask(doc("/report.pdf")));
		expect(reply.status).toBe(200);
		expect(JSON.stringify(JSON.parse(transport.calls[0].init.body))).toContain("Quarterly");
	});

	it("an allow-list miss becomes a note with the reason, a warning event, and no request", async () => {
		const api = await make({
			upstreams: [upstream()],
			detect: false,
			settings: { documentUrls: { allow: ["files.example.com"], allowPrivate: true } }
		});
		const seen = watch(api);
		const sent = await api.request(ask(doc("/report.pdf?token=SECRET")));
		const text = texts(sent).join("\n");
		expect(text).toContain(
			`[The document "Doc" could not be read by this model. the document at ${base}/report.pdf could not be fetched: the host is not on the allow list.]`
		);
		expect(text).not.toContain("SECRET");
		expect(hits).toEqual([]);
		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({
			type: "document",
			kind: "fetch",
			level: "warn",
			reason: "allow",
			endpoint: "u",
			model: "m",
			url: `${base}/report.pdf`
		});
		expect(JSON.stringify(seen)).not.toContain("SECRET");
	});

	it("refuses the loopback server without allowPrivate, and says nothing about the address to the client", async () => {
		const api = await make({ upstreams: [upstream()], detect: false, settings: { documentUrls: { allow: ["127.0.0.1"] } } });
		const seen = watch(api);
		const sent = await api.request(ask(doc("/report.pdf")));
		const text = texts(sent).join("\n");
		expect(text).toContain("the host resolves to an address that is not allowed");
		expect(text).not.toContain("loopback");
		expect(hits).toEqual([]);
		expect(seen[0].reason).toBe("address");
		expect(seen[0].message).toContain("(loopback)");
	});

	it.each([
		["a bad status", "/gone", "the server answered HTTP 404"],
		["a bad content type", "/page.html", "the content type is not supported"]
	])("%s becomes a note and the request goes on", async (_name, path, reason) => {
		const api = await make({
			upstreams: [upstream()],
			detect: false,
			settings: { documentUrls: { ...open, allow: ["127.0.0.1", "169.254.169.254"] } }
		});
		const sent = await api.request(ask(doc(path), { type: "text", text: "second block survives" }));
		const text = texts(sent).join("\n");
		expect(text).toContain(reason);
		expect(text).toContain("second block survives");
	});

	it("enforces maxBytes against the real server", async () => {
		const api = await make({ upstreams: [upstream()], detect: false, settings: { documentUrls: { ...open, maxBytes: 20 } } });
		const sent = await api.request(ask(doc("/report.pdf")));
		expect(texts(sent).join("\n")).toContain("the document is larger than 20 bytes");
	});

	it("documentConverter still runs first and nothing is fetched", async () => {
		const seen = [];
		const documentConverter = async (block) => (seen.push(block.source), [{ type: "text", text: "converted by the hook" }]);
		const api = await make({ upstreams: [upstream()], detect: false, settings: { documentUrls: open, documentConverter } });
		const sent = await api.request(ask(doc("/report.pdf")));
		expect(texts(sent).join("\n")).toContain("converted by the hook");
		expect(seen).toEqual([{ type: "url", url: `${base}/report.pdf` }]);
		expect(hits).toEqual([]);
	});

	it("does not fetch when documents are notes or errors, or when the request is forwarded as it is", async () => {
		const note = await make({ upstreams: [upstream()], detect: false, settings: { documentUrls: open, documents: "note" } });
		expect(texts(await note.request(ask(doc("/report.pdf")))).join("\n")).toContain("document conversion is disabled");
		const error = await make({ upstreams: [upstream()], detect: false, settings: { documentUrls: open, documents: "error" } });
		await expect(error.request(ask(doc("/report.pdf")))).rejects.toMatchObject({ code: "unsupported_document" });
		const native = await make({ upstreams: [upstream("anthropic")], detect: false, settings: { documentUrls: open } });
		const forwarded = await native.request(ask(doc("/report.pdf")));
		expect(forwarded.body.messages[0].content[0].source).toEqual({ type: "url", url: `${base}/report.pdf` });
		expect(hits).toEqual([]);
	});

	it("leaves URL images alone: they are forwarded to the upstream as URLs", async () => {
		const api = await make({ upstreams: [upstream()], detect: false, settings: { documentUrls: open } });
		const sent = await api.request(ask({ type: "image", source: { type: "url", url: `${base}/picture.png` } }));
		expect(JSON.stringify(sent.body.messages)).toContain(`"image_url":{"url":"${base}/picture.png"}`);
		expect(hits).toEqual([]);
	});

	it("rejects an invalid setting when the translator is used", async () => {
		await expect(
			make({ upstreams: [upstream()], detect: false, settings: { documentUrls: { allow: [] } } }).then((api) =>
				api.request(ask(doc("/report.pdf")))
			)
		).rejects.toThrow(/documentUrls/);
	});

	it("emits a debug event for a fetched document", async () => {
		const api = await make({ upstreams: [upstream()], detect: false, settings: { documentUrls: open } });
		const seen = watch(api);
		await api.request(ask(doc("/notes.txt")));
		expect(seen).toHaveLength(1);
		expect(seen[0]).toMatchObject({ kind: "fetched", level: "debug", bytes: 16, mediaType: "text/plain", url: `${base}/notes.txt` });
	});
});

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/document-urls.test.vitest.mjs
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
 * @fileoverview The `documentUrls` setting and the step that replaces `url` document sources with fetched bytes.
 */
import { describe, expect, it } from "vitest";
import { DEFAULTS, display, normalize, resolve, wanted } from "../../src/lib/document-urls.mjs";
import { FetchError } from "../../src/lib/fetch-url.mjs";
import { resolve as settings } from "../../src/lib/settings.mjs";

const options = normalize({ allow: ["files.example.com"] });
const doc = (url, extra = {}) => ({ type: "document", source: { type: "url", url }, ...extra });
const user = (...content) => ({ model: "m", max_tokens: 8, messages: [{ role: "user", content }] });

describe("normalize", () => {
	it("is off for null, undefined and false", () => {
		expect(normalize(null)).toBeNull();
		expect(normalize(undefined)).toBeNull();
		expect(normalize(false)).toBeNull();
	});

	it("fills in the defaults and lower-cases the allow-list", () => {
		expect(normalize({ allow: [" Files.Example.com ", "*.cdn.example.com"] })).toEqual({
			...DEFAULTS,
			allow: ["files.example.com", "*.cdn.example.com"]
		});
		expect(DEFAULTS).toEqual({ maxBytes: 33554432, timeout: 30000, maxRedirects: 3, maxDocuments: 10, allowPrivate: false });
		expect(normalize({ allow: ["a.test"], maxBytes: 5, timeout: 9, maxRedirects: 0, maxDocuments: 0, allowPrivate: true })).toEqual({
			allow: ["a.test"],
			maxBytes: 5,
			timeout: 9,
			maxRedirects: 0,
			maxDocuments: 0,
			allowPrivate: true
		});
		expect(normalize({ allow: ["*"] }).allow).toEqual(["*"]);
	});

	it.each([
		[true],
		["files.example.com"],
		[["files.example.com"]],
		[{}],
		[{ allow: [] }],
		[{ allow: "files.example.com" }],
		[{ allow: [""] }],
		[{ allow: ["  "] }],
		[{ allow: [5] }],
		[{ allow: ["a.test"], maxBytes: 0 }],
		[{ allow: ["a.test"], maxBytes: 1.5 }],
		[{ allow: ["a.test"], timeout: "5s" }],
		[{ allow: ["a.test"], maxRedirects: -1 }],
		[{ allow: ["a.test"], maxDocuments: "all" }],
		[{ allow: ["a.test"], allowPrivate: "yes" }],
		[{ allow: ["a.test"], allowAll: true }],
		[{ allow: ["a.test"], a: 1, b: 2 }]
	])("rejects %j", (value) => {
		expect(() => normalize(value)).toThrow(/Invalid setting documentUrls/);
		try {
			normalize(value);
		} catch (error) {
			expect(error).toMatchObject({ code: "invalid_setting", status: 500, details: { key: "documentUrls" } });
		}
	});

	it("names the missing allow-list: there is no allow-all default", () => {
		expect(() => normalize({ maxBytes: 100 })).toThrow(/allow must be a non-empty list of host names/);
		expect(() => normalize({ allow: ["a.test"], oops: 1 })).toThrow(/unknown key oops/);
		expect(() => normalize({ allow: ["a.test"], a: 1, b: 2 })).toThrow(/unknown keys a, b/);
	});

	it("is applied by the settings resolver, which defaults to off", () => {
		expect(settings().documentUrls).toBeNull();
		expect(settings({ documentUrls: { allow: ["A.test"] } }).documentUrls).toEqual({ ...DEFAULTS, allow: ["a.test"] });
		expect(settings({ documentUrls: { allow: ["a.test"] } }, { documentUrls: null }).documentUrls).toBeNull();
		expect(() => settings({ documentUrls: { allow: [] } })).toThrow(/documentUrls/);
	});
});

describe("display and wanted", () => {
	it("drops the query, fragment and credentials of a URL", () => {
		expect(display("https://files.example.com/a/b.pdf?sig=SECRET&x=1#frag")).toBe("https://files.example.com/a/b.pdf");
		expect(display("https://user:pw@files.example.com:8443/a.pdf")).toBe("https://files.example.com:8443/a.pdf");
		expect(display("nope")).toBe("(invalid URL)");
		expect(display(undefined)).toBe("(invalid URL)");
	});

	it("needs the setting on, documents extracted and no converter", () => {
		const on = { documentUrls: options, documents: "extract", documentConverter: null };
		expect(wanted(on)).toBe(true);
		expect(wanted({ ...on, documentUrls: null })).toBe(false);
		expect(wanted({ ...on, documents: "note" })).toBe(false);
		expect(wanted({ ...on, documents: "error" })).toBe(false);
		expect(wanted({ ...on, documentConverter: async () => [] })).toBe(false);
	});
});

describe("resolve", () => {
	const got = (text, mediaType = "text/plain") => ({ bytes: Buffer.from(text), mediaType, url: "x" });
	const run = (body, fetch, extra = {}) => {
		const events = [];
		return resolve(body, { options, report: (event) => events.push(event), fetch, ...extra }).then((out) => ({ out, events }));
	};

	it("replaces a url source with the fetched bytes as a base64 source, in a copy", async () => {
		const body = user({ type: "text", text: "see" }, doc("https://files.example.com/a.txt?sig=1", { title: "A" }));
		const frozen = structuredClone(body);
		const calls = [];
		const { out, events } = await run(body, async (url, opts, deps) => (calls.push([url, opts, deps]), got("hello")), {
			deps: { marker: 1 }
		});
		expect(out.messages[0].content[1]).toEqual({
			type: "document",
			title: "A",
			source: { type: "base64", media_type: "text/plain", data: Buffer.from("hello").toString("base64") }
		});
		expect(out.messages[0].content[0]).toBe(body.messages[0].content[0]);
		expect(body).toEqual(frozen);
		expect(calls[0][0]).toBe("https://files.example.com/a.txt?sig=1");
		expect(calls[0][1]).toMatchObject({ allow: ["files.example.com"], maxBytes: 33554432 });
		expect(calls[0][2]).toEqual({ marker: 1 });
		expect(events).toEqual([
			{
				kind: "fetched",
				level: "debug",
				message: "Fetched document https://files.example.com/a.txt (5 bytes, text/plain)",
				url: "https://files.example.com/a.txt",
				bytes: 5,
				mediaType: "text/plain"
			}
		]);
		expect(JSON.stringify(events)).not.toContain("sig=1");
	});

	it("returns the same body when there is nothing to fetch", async () => {
		const plain = user(
			{ type: "text", text: "x" },
			{ type: "document", source: { type: "base64", media_type: "text/plain", data: "eA==" } }
		);
		let calls = 0;
		const { out } = await run(plain, async () => (calls++, got("")));
		expect(out).toBe(plain);
		expect(calls).toBe(0);
		const noMessages = { model: "m" };
		expect((await run(noMessages, async () => got(""))).out).toBe(noMessages);
		expect((await run(null, async () => got(""))).out).toBeNull();
		const holes = { model: "m", messages: [{ role: "user", content: [null, 5, { type: "tool_result", content: [null] }] }] };
		expect((await run(holes, async () => got(""))).out).toBe(holes);
		const text = { model: "m", messages: [{ role: "user", content: "just text" }, null] };
		expect((await run(text, async () => got(""))).out).toBe(text);
	});

	it("reaches documents inside tool_result content, and fetches a URL once per call", async () => {
		const body = {
			model: "m",
			messages: [
				{ role: "user", content: [doc("https://files.example.com/a.txt")] },
				{
					role: "user",
					content: [
						{ type: "tool_result", tool_use_id: "t", content: [doc("https://files.example.com/a.txt"), { type: "text", text: "x" }] }
					]
				},
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "u", content: "plain result" }] }
			]
		};
		let calls = 0;
		const { out } = await run(body, async () => (calls++, got("same")));
		expect(calls).toBe(1);
		expect(out.messages[0].content[0].source.type).toBe("base64");
		expect(out.messages[1].content[0].content[0].source.type).toBe("base64");
		expect(out.messages[1].content[0].content[1]).toEqual({ type: "text", text: "x" });
		expect(out.messages[2]).toBe(body.messages[2]);
	});

	it("turns a failure into a fetch_failed source with the client-safe reason, and reports the detail", async () => {
		const { out, events } = await run(user(doc("https://files.example.com/a.pdf?token=ABC")), async () => {
			throw new FetchError(
				"address",
				"the host resolves to an address that is not allowed",
				"files.example.com resolves to 10.0.0.1 (private)"
			);
		});
		expect(out.messages[0].content[0].source).toEqual({
			type: "fetch_failed",
			url: "https://files.example.com/a.pdf",
			reason: "the host resolves to an address that is not allowed"
		});
		expect(events).toEqual([
			{
				kind: "fetch",
				level: "warn",
				message: "Document https://files.example.com/a.pdf was not fetched: files.example.com resolves to 10.0.0.1 (private)",
				url: "https://files.example.com/a.pdf",
				reason: "address"
			}
		]);
		expect(JSON.stringify(out)).not.toContain("10.0.0.1");
		expect(JSON.stringify(out)).not.toContain("ABC");
	});

	it("treats an error that is not a FetchError as a connection failure without leaking it", async () => {
		const { out, events } = await run(user(doc("https://files.example.com/a.pdf")), async () => {
			throw new TypeError("secret internal detail");
		});
		expect(out.messages[0].content[0].source.reason).toBe("the connection failed");
		expect(events[0].message).toContain("secret internal detail");
		const odd = await run(user(doc("https://files.example.com/a.pdf")), async () => Promise.reject("text"));
		expect(odd.events[0].message).toContain("text");
		const bare = await run(user({ type: "document", source: { type: "url" } }), async () => Promise.reject(null));
		expect(bare.out.messages[0].content[0].source).toMatchObject({ type: "fetch_failed", url: "(invalid URL)" });
	});

	it("fetches no more than maxDocuments different URLs per call", async () => {
		const limited = normalize({ allow: ["files.example.com"], maxDocuments: 2 });
		const body = user(
			doc("https://files.example.com/1"),
			doc("https://files.example.com/2"),
			doc("https://files.example.com/3"),
			doc("https://files.example.com/1")
		);
		const urls = [];
		const events = [];
		const out = await resolve(body, {
			options: limited,
			report: (event) => events.push(event),
			fetch: async (url) => (urls.push(url), got("x"))
		});
		expect(urls).toEqual(["https://files.example.com/1", "https://files.example.com/2"]);
		const sources = out.messages[0].content.map((block) => block.source);
		expect(sources.map((source) => source.type)).toEqual(["base64", "base64", "fetch_failed", "base64"]);
		expect(sources[2].reason).toBe("no more than 2 documents are fetched per request");
		expect(events.filter((event) => event.reason === "limit")).toHaveLength(1);
		const none = normalize({ allow: ["files.example.com"], maxDocuments: 0 });
		const refused = await resolve(user(doc("https://files.example.com/1")), {
			options: none,
			report: () => {},
			fetch: async () => got("x")
		});
		expect(refused.messages[0].content[0].source.type).toBe("fetch_failed");
	});

	it("passes the caller's signal and fetches with the real fetcher by default", async () => {
		const controller = new AbortController();
		let seen;
		await run(user(doc("https://files.example.com/a.txt")), async (_url, opts) => ((seen = opts.signal), got("x")), {
			signal: controller.signal
		});
		expect(seen).toBe(controller.signal);
		const events = [];
		const out = await resolve(user(doc("ftp://files.example.com/a.txt")), { options, report: (event) => events.push(event) });
		expect(out.messages[0].content[0].source).toMatchObject({ type: "fetch_failed", reason: "only http and https URLs are fetched" });
		expect(events[0].reason).toBe("scheme");
	});
});

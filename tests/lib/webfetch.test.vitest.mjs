/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/webfetch.test.vitest.mjs
 *	@Date: 2026-11-25T01:00:00-08:00 (1795596800)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-25T01:00:00-08:00 (1795596800)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The built-in web fetch executor: option validation, the URL-in-conversation rule, the tool's domain fields, HTML, text and PDF
 * results, truncation, citations and the Anthropic error codes. The network is faked.
 */
import { afterEach, describe, expect, it } from "vitest";
import { TranslatorError } from "../../src/lib/errors.mjs";
import { conversationUrls, permit, webFetch } from "../../src/lib/webfetch.mjs";
import * as pdf from "../../src/lib/pdf.mjs";
import { fakeWeb } from "../helpers/fake-web.mjs";
import { makePdf } from "../helpers/pdf.mjs";

afterEach(async () => {
	await pdf.load();
});

const URL_A = "https://docs.example.com/guide";
const tool = { type: "web_fetch_20250910", name: "web_fetch" };
const context = (text = `read ${URL_A} please`) => ({ messages: [{ role: "user", content: text }], results: [] });
const page = (body, type = "text/html; charset=utf-8") => ({ body, headers: { "content-type": type } });

/** Run the executor for `url` against a fake web and return what it resolved with, or the error it threw. */
async function fetchWith(options, answer, { input = { url: URL_A }, ctx = context(), def = tool } = {}) {
	const web = fakeWeb(typeof answer === "function" ? answer : () => answer);
	const executor = webFetch({ allow: ["*.example.com"], deps: web.deps, ...options });
	try {
		return { out: await executor.run(input, { tool: def, id: "srvtoolu_1", context: ctx }), web };
	} catch (error) {
		return { error, web };
	}
}

describe("webFetch options", () => {
	it("needs an allow list, like documentUrls", () => {
		for (const bad of [undefined, null, [], "x", {}, { allow: [] }, { allow: [" "] }, { allow: [1] }]) {
			expect(() => webFetch(bad)).toThrow(TranslatorError);
		}
		expect(() => webFetch({})).toThrow(/needs allow/);
	});

	it("rejects unknown keys and limits of the wrong kind", () => {
		expect(() => webFetch({ allow: ["a.test"], maxDocuments: 3 })).toThrow(/unknown key maxDocuments/);
		expect(() => webFetch({ allow: ["a.test"], x: 1, y: 2 })).toThrow(/unknown keys x, y/);
		for (const key of ["maxBytes", "timeout", "maxPages"]) {
			expect(() => webFetch({ allow: ["a.test"], [key]: 0 })).toThrow(new RegExp(`${key} must be a positive integer`));
		}
		expect(() => webFetch({ allow: ["a.test"], maxRedirects: -1 })).toThrow(/maxRedirects/);
		expect(() => webFetch({ allow: ["a.test"], allowPrivate: "yes" })).toThrow(/allowPrivate/);
		expect(() => webFetch({ allow: ["a.test"], maxRedirects: 0, allowPrivate: true })).not.toThrow();
		try {
			webFetch({});
		} catch (error) {
			expect(error).toMatchObject({ code: "INVALID_CONFIG" });
		}
	});

	it("is an executor for every web_fetch_* version with a url schema", () => {
		const executor = webFetch({ allow: ["a.test"] });
		expect(executor.type.test("web_fetch_20250910")).toBe(true);
		expect(executor.type.test("web_search_20250305")).toBe(false);
		expect(executor.schema(tool)).toMatchObject({ type: "object", required: ["url"], properties: { url: { type: "string" } } });
		expect(executor.description).toMatch(/appeared in the conversation/);
	});
});

describe("read", () => {
	const { read } = webFetch({ allow: ["a.test"] });

	it("gives the model the title, the URL and the text of a result", () => {
		const content = (title) => ({
			type: "web_fetch_result",
			url: URL_A,
			content: { type: "document", source: { type: "text", media_type: "text/plain", data: "body" }, ...(title ? { title } : {}) }
		});
		expect(read(content("Guide"))).toBe(`Guide\n${URL_A}\n\nbody`);
		expect(read(content())).toBe(`${URL_A}\n\nbody`);
	});

	it("falls back to JSON for a result that is not text, such as another server's base64 PDF", () => {
		const pdf = { type: "web_fetch_result", url: URL_A, content: { source: { type: "base64", data: "JVBERi0=" } } };
		expect(read(pdf)).toBe(JSON.stringify(pdf));
		expect(read({ content: { source: { type: "text", data: 5 } } })).toContain('"data":5');
		expect(read(null)).toBe("null");
	});
});

describe("the URL has to appear in the conversation", () => {
	it("finds URLs in user text, client tool results, documents and server tool results, not in assistant text", () => {
		const urls = conversationUrls({
			messages: [
				{ role: "user", content: "broken https://[bad see (https://a.test/x), and https://b.test/y." },
				{
					role: "user",
					content: [
						{ type: "text", text: "also https://c.test" },
						{ type: "tool_result", tool_use_id: "t", content: [{ type: "text", text: "from https://d.test/z" }] },
						{ type: "document", source: { type: "url", url: "https://e.test/d.pdf" } }
					]
				},
				{
					role: "assistant",
					content: [
						{ type: "text", text: "I will use https://assistant-only.test" },
						{ type: "web_search_tool_result", tool_use_id: "s", content: [{ type: "web_search_result", url: "https://f.test/r" }] },
						{ type: "text", text: "again https://assistant-only-two.test" },
						null
					]
				},
				{ role: "assistant", content: "plain https://assistant-text.test" },
				null
			],
			results: [{ type: "web_fetch_result", url: "https://g.test/", content: null, size: 5 }]
		});
		expect([...urls].sort()).toEqual(
			[
				"https://a.test/x",
				"https://a.test/x),",
				"https://b.test/y",
				"https://b.test/y.",
				"https://c.test/",
				"https://d.test/z",
				"https://e.test/d.pdf",
				"https://f.test/r",
				"https://g.test/"
			].sort()
		);
		expect(conversationUrls({}).size).toBe(0);
	});

	it("refuses a URL that never appeared, and one that only the assistant wrote", async () => {
		const answered = () => {
			throw new Error("must not be fetched");
		};
		const first = await fetchWith({}, answered, { ctx: context("nothing here") });
		expect(first.error).toMatchObject({ code: "url_not_allowed" });
		expect(first.web.calls).toHaveLength(0);
		const second = await fetchWith({}, answered, {
			ctx: { messages: [{ role: "assistant", content: [{ type: "text", text: URL_A }] }] }
		});
		expect(second.error).toMatchObject({ code: "url_not_allowed" });
	});

	it("accepts a URL a user wrote with a different spelling of the same address", async () => {
		const { out } = await fetchWith({}, page("<p>hi</p>"), {
			input: { url: "HTTPS://Docs.Example.com:443/guide" },
			ctx: context("https://docs.example.com/guide")
		});
		expect(out.content.content.source.data).toBe("hi");
	});

	it("accepts a URL a result from this same request named", async () => {
		const ctx = { messages: [{ role: "user", content: "search it" }], results: [[{ type: "web_search_result", url: URL_A }]] };
		const { out } = await fetchWith({}, page("<p>hi</p>"), { ctx });
		expect(out.content.type).toBe("web_fetch_result");
	});

	it("refuses an input with no usable url as invalid_tool_input", async () => {
		for (const input of [null, {}, { url: 5 }, { url: "not a url" }]) {
			const { error } = await fetchWith({}, page(""), { input });
			expect(error).toMatchObject({ code: "invalid_tool_input" });
		}
	});
});

describe("the allow list and the tool's domain fields", () => {
	it("refuses a host that is not on the allow list, before any request", async () => {
		const { error, web } = await fetchWith({ allow: ["other.test"] }, page(""));
		expect(error).toMatchObject({ code: "url_not_allowed" });
		expect(web.calls).toHaveLength(0);
	});

	it("refuses a host that resolves to a private address", async () => {
		const web = fakeWeb(() => page(""), ["10.0.0.5"]);
		const executor = webFetch({ allow: ["*.example.com"], deps: web.deps });
		await expect(executor.run({ url: URL_A }, { tool, context: context() })).rejects.toMatchObject({ code: "url_not_allowed" });
		expect(web.calls).toHaveLength(0);
	});

	it("narrows to the tool's allowed_domains, with subdomains and a path prefix", async () => {
		const allowed = { ...tool, allowed_domains: ["docs.example.com/guide/", "https://other.example.com"] };
		expect((await fetchWith({}, page("<p>x</p>"), { def: allowed })).out).toBeDefined();
		const prefix = { ...tool, allowed_domains: ["docs.example.com/gui"] };
		expect((await fetchWith({}, page(""), { def: prefix })).error).toMatchObject({ code: "url_not_allowed" });
		const below = { ...tool, allowed_domains: ["example.com/guide"] };
		expect(
			(await fetchWith({}, page("<p>x</p>"), { def: below, input: { url: `${URL_A}/intro` }, ctx: context(`${URL_A}/intro`) })).out
		).toBeDefined();
		const outside = { ...tool, allowed_domains: ["docs.example.com/api"] };
		expect((await fetchWith({}, page(""), { def: outside })).error).toMatchObject({ code: "url_not_allowed" });
		const elsewhere = { ...tool, allowed_domains: ["example.org"] };
		expect((await fetchWith({}, page(""), { def: elsewhere })).error).toMatchObject({ code: "url_not_allowed" });
	});

	it("refuses the tool's blocked_domains, and ignores entries that are not strings", async () => {
		const blocked = { ...tool, blocked_domains: [7, " ", "example.com"] };
		const { error, web } = await fetchWith({}, page(""), { def: blocked });
		expect(error).toMatchObject({ code: "url_not_allowed" });
		expect(web.calls).toHaveLength(0);
		const ok = { ...tool, blocked_domains: ["example.org"], allowed_domains: "nope" };
		expect((await fetchWith({}, page("<p>x</p>"), { def: ok })).out).toBeDefined();
	});

	it("checks the domain fields on every redirect hop", async () => {
		const answer = (url) =>
			url.pathname === "/guide" ? { status: 302, headers: { location: "https://docs.example.com/private/x" } } : page("<p>secret</p>");
		const guarded = { ...tool, blocked_domains: ["docs.example.com/private"] };
		const { error, web } = await fetchWith({}, answer, { def: guarded });
		expect(error).toMatchObject({ code: "url_not_allowed" });
		expect(web.calls).toHaveLength(1);
		const open = await fetchWith({}, answer);
		expect(open.out.content.url).toBe("https://docs.example.com/private/x");
		expect(open.out.content.content.source.data).toBe("secret");
	});

	it("matches the host without a trailing dot or case, and not a look-alike suffix", () => {
		const check = permit({ allowed_domains: ["example.com"] });
		expect(check(new URL("https://WWW.Example.com./a"))).toBe(true);
		expect(check(new URL("https://notexample.com/a"))).toBe(false);
	});
});

describe("results", () => {
	it("returns HTML as text with its title, the final URL and a retrieval time", async () => {
		const html = "<html><head><title>Guide</title></head><body><h1>Guide</h1><p>Step &amp; go</p><script>x()</script></body></html>";
		const { out, web } = await fetchWith({}, page(html));
		expect(web.calls[0].headers.accept).toBe("application/pdf, text/plain, text/html, application/xhtml+xml");
		expect(out.type).toBeUndefined();
		const result = out.content;
		expect(result).toMatchObject({ type: "web_fetch_result", url: URL_A });
		expect(Number.isNaN(Date.parse(result.retrieved_at))).toBe(false);
		expect(result.content).toEqual({
			type: "document",
			source: { type: "text", media_type: "text/plain", data: "Guide\nStep & go" },
			title: "Guide"
		});
	});

	it("returns plain text and XHTML, and no title when the page has none", async () => {
		const text = await fetchWith({}, page("hello\nthere", "text/plain"));
		expect(text.out.content.content).toEqual({
			type: "document",
			source: { type: "text", media_type: "text/plain", data: "hello\nthere" }
		});
		const xhtml = await fetchWith({}, page("<p>x</p>", "application/xhtml+xml"));
		expect(xhtml.out.content.content.source.data).toBe("x");
	});

	it("reads a PDF through the PDF pipeline, page by page, with the PDF's title", async () => {
		const bytes = Buffer.from(makePdf(["First page", "Second page"], "Annual Report"));
		const { out } = await fetchWith({}, page(bytes, "application/pdf"));
		expect(out.content.content.title).toBe("Annual Report");
		expect(out.content.content.source).toMatchObject({ type: "text", media_type: "text/plain" });
		expect(out.content.content.source.data).toMatch(/^--- Page 1 ---\nFirst page\s*\n\n--- Page 2 ---\nSecond page/);
	});

	it("refuses a PDF that cannot be read, one over the page limit and one when the PDF library is missing", async () => {
		const broken = await fetchWith({}, page(Buffer.from("%PDF-1.4 but not really"), "application/pdf"));
		expect(broken.error).toMatchObject({ code: "unsupported_content_type" });
		const long = await fetchWith({ maxPages: 1 }, page(Buffer.from(makePdf(["a", "b"])), "application/pdf"));
		expect(long.error).toMatchObject({ code: "unsupported_content_type", message: expect.stringContaining("maximum of 1 PDF pages") });
		await pdf.load(async () => {
			throw new Error("gone");
		});
		const missing = await fetchWith({}, page(Buffer.from(makePdf(["a"])), "application/pdf"));
		expect(missing.error).toMatchObject({ code: "unavailable" });
	});

	it("truncates the text to max_content_tokens", async () => {
		const text = "x".repeat(100);
		const limited = { ...tool, max_content_tokens: 5 };
		const { out } = await fetchWith({}, page(text, "text/plain"), { def: limited });
		expect(out.content.content.source.data).toBe("x".repeat(20));
		const whole = await fetchWith({}, page(text, "text/plain"), { def: { ...tool, max_content_tokens: 25 } });
		expect(whole.out.content.content.source.data).toBe(text);
		for (const value of [0, -3, 1.5, "9"]) {
			const unlimited = await fetchWith({}, page(text, "text/plain"), { def: { ...tool, max_content_tokens: value } });
			expect(unlimited.out.content.content.source.data).toBe(text);
		}
	});

	it("marks the document for citations only when the tool enables them", async () => {
		const on = await fetchWith({}, page("a", "text/plain"), { def: { ...tool, citations: { enabled: true } } });
		expect(on.out.content.content.citations).toEqual({ enabled: true });
		const off = await fetchWith({}, page("a", "text/plain"), { def: { ...tool, citations: { enabled: false } } });
		expect(off.out.content.content.citations).toBeUndefined();
		expect((await fetchWith({}, page("a", "text/plain"))).out.content.content.citations).toBeUndefined();
	});
});

describe("errors use Anthropic's web_fetch error codes", () => {
	it.each([
		["a server error", { status: 503 }, "url_not_accessible"],
		["a missing page", { status: 404 }, "url_not_accessible"],
		["rate limiting", { status: 429 }, "too_many_requests"],
		["an image", { headers: { "content-type": "image/png" }, body: "x" }, "unsupported_content_type"],
		["a compressed body", { headers: { "content-type": "text/html", "content-encoding": "gzip" }, body: "x" }, "url_not_accessible"],
		["a redirect from https to http", { status: 301, headers: { location: "http://docs.example.com/guide" } }, "url_not_allowed"]
	])("%s", async (_name, answer, code) => {
		const { error } = await fetchWith({}, answer);
		expect(error).toMatchObject({ code });
		expect(error.message).not.toBe("");
	});

	it("refuses a body over maxBytes, by header and while it streams", async () => {
		const header = await fetchWith({ maxBytes: 10 }, { headers: { "content-type": "text/plain", "content-length": "500" }, body: "x" });
		expect(header.error).toMatchObject({ code: "url_not_accessible", message: expect.stringContaining("content-length 500") });
		const stream = await fetchWith({ maxBytes: 10 }, page("y".repeat(50), "text/plain"));
		expect(stream.error).toMatchObject({ code: "url_not_accessible", message: expect.stringContaining("body passed 10 bytes") });
	});

	it("reports a host that does not resolve and a timeout as not accessible", async () => {
		const executor = webFetch({
			allow: ["*.example.com"],
			timeout: 20,
			deps: {
				modules: { http: {}, https: {} },
				lookup: () => new Promise(() => {})
			}
		});
		await expect(executor.run({ url: URL_A }, { tool, context: context() })).rejects.toMatchObject({ code: "url_not_accessible" });
		const gone = webFetch({
			allow: ["*.example.com"],
			deps: {
				modules: { http: {}, https: {} },
				lookup: async () => {
					throw Object.assign(new Error("nope"), { code: "ENOTFOUND" });
				}
			}
		});
		await expect(gone.run({ url: URL_A }, { tool, context: context() })).rejects.toMatchObject({ code: "url_not_accessible" });
	});
});

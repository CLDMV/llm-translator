/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/fetch-url.test.vitest.mjs
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
 * @fileoverview The URL fetcher: allow-list, address classes, pinned connections, redirects, limits, timeout and content checks. Public addresses are
 * simulated with injected lookups and fake protocol modules; the real transport only ever talks to a server on 127.0.0.1.
 */
import { EventEmitter } from "node:events";
import http from "node:http";
import net from "node:net";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { FetchError, allowed, classify, fetchUrl, lookup } from "../../src/lib/fetch-url.mjs";

const PUBLIC = "93.184.216.34";
const base = { allow: ["files.example.com"], maxBytes: 1024, timeout: 2000, maxRedirects: 3 };
const resolveTo =
	(...addresses) =>
	async () =>
		addresses.map((address) => ({ address, family: net.isIP(address) }));
const pdf = Buffer.from("%PDF-1.4\nhello");

/** Fake `node:http` and `node:https`: `handler(url, address, n)` answers each request; `calls` records where each one was connected. */
function fake(handler) {
	const calls = [];
	const client = {
		request(url, options, callback) {
			const request = new EventEmitter();
			request.destroy = (reason) => {
				request.emit("error", reason);
				request.emit("close");
			};
			request.end = () => {
				const host = url.hostname.replace(/^\[|\]$/g, "");
				new Promise((resolve) => {
					if (net.isIP(host)) resolve(host);
					else options.lookup(host, { all: true }, (_error, list) => resolve(list[0].address));
				}).then((address) => {
					calls.push({ url: url.href, address, headers: options.headers, agent: options.agent });
					const reply = handler(url, address, calls.length);
					const res = Readable.from([reply.body ?? Buffer.alloc(0)]);
					res.statusCode = reply.status ?? 200;
					res.headers = reply.headers ?? { "content-type": "application/pdf" };
					callback(res);
					request.emit("close");
				});
			};
			return request;
		}
	};
	return { modules: { http: client, https: client }, calls };
}

const failure = (promise) =>
	promise.then(
		() => {
			throw new Error("expected a FetchError");
		},
		(error) => {
			expect(error).toBeInstanceOf(FetchError);
			return error;
		}
	);

describe("classify", () => {
	const blocked = [
		["0.0.0.0", "unspecified"],
		["0.1.2.3", "unspecified"],
		["10.0.0.1", "private"],
		["10.255.255.255", "private"],
		["172.16.0.1", "private"],
		["172.31.255.255", "private"],
		["192.168.1.1", "private"],
		["100.64.0.1", "cgnat"],
		["100.127.255.255", "cgnat"],
		["127.0.0.1", "loopback"],
		["127.255.255.254", "loopback"],
		["169.254.169.254", "link-local"],
		["169.254.0.1", "link-local"],
		["192.0.0.1", "reserved"],
		["192.0.2.1", "reserved"],
		["192.88.99.1", "reserved"],
		["198.18.0.1", "reserved"],
		["198.19.255.255", "reserved"],
		["198.51.100.1", "reserved"],
		["203.0.113.1", "reserved"],
		["224.0.0.1", "multicast"],
		["239.255.255.255", "multicast"],
		["240.0.0.1", "reserved"],
		["255.255.255.255", "reserved"],
		["::", "unspecified"],
		["::1", "loopback"],
		["fe80::1", "link-local"],
		["fe80::1%eth0", "link-local"],
		["febf::1", "link-local"],
		["fec0::1", "link-local"],
		["fc00::1", "unique-local"],
		["fd12:3456:789a::1", "unique-local"],
		["ff02::1", "multicast"],
		["ff00::", "multicast"],
		["::ffff:127.0.0.1", "loopback"],
		["::ffff:7f00:1", "loopback"],
		["::ffff:10.0.0.1", "private"],
		["::ffff:a9fe:a9fe", "link-local"],
		["::ffff:169.254.169.254", "link-local"],
		["::ffff:100.64.0.1", "cgnat"],
		["::ffff:8.8.8.8", "mapped"],
		["::7f00:1", "reserved"],
		["64:ff9b::7f00:1", "reserved"],
		["64:ff9b:1::1", "reserved"],
		["100::1", "reserved"],
		["2001::1", "reserved"],
		["2001:db8::1", "reserved"],
		["2002:7f00:1::1", "reserved"],
		["not an address", "invalid"],
		["", "invalid"],
		["999.1.1.1", "invalid"]
	];

	it.each(blocked)("%s is %s", (address, kind) => {
		expect(classify(address)).toBe(kind);
	});

	it.each([
		"8.8.8.8",
		"1.1.1.1",
		PUBLIC,
		"172.15.255.255",
		"172.32.0.1",
		"100.63.255.255",
		"100.128.0.1",
		"169.253.0.1",
		"192.0.1.1",
		"198.17.255.255",
		"198.20.0.1",
		"223.255.255.255",
		"2606:4700:4700::1111",
		"2a00:1450:4001::1",
		"2001:4860:4860::8888"
	])("%s is public", (address) => {
		expect(classify(address)).toBeNull();
	});
});

describe("allowed", () => {
	it("matches an exact host, a wildcard subdomain at any depth, and * for any host", () => {
		expect(allowed("files.example.com", ["files.example.com"])).toBe(true);
		expect(allowed("files.example.com", ["FILES.example.com"])).toBe(true);
		expect(allowed("other.example.com", ["files.example.com"])).toBe(false);
		expect(allowed("a.example.com", ["*.example.com"])).toBe(true);
		expect(allowed("a.b.example.com", ["*.example.com"])).toBe(true);
		expect(allowed("example.com", ["*.example.com"])).toBe(false);
		expect(allowed("evilexample.com", ["*.example.com"])).toBe(false);
		expect(allowed("example.com.evil.net", ["*.example.com"])).toBe(false);
		expect(allowed("anything.test", ["*"])).toBe(true);
		expect(allowed("x.test", ["a.test", "x.test"])).toBe(true);
		expect(allowed("x.test", [])).toBe(false);
	});
});

describe("the allow-list and the URL", () => {
	it("refuses a host that is not listed before resolving it", async () => {
		let asked = 0;
		const { modules, calls } = fake(() => ({ body: pdf }));
		const error = await failure(
			fetchUrl("https://evil.example.net/a.pdf", base, {
				modules,
				lookup: async () => {
					asked++;
					return [{ address: PUBLIC, family: 4 }];
				}
			})
		);
		expect(error).toMatchObject({ kind: "allow", message: "the host is not on the allow list" });
		expect(asked).toBe(0);
		expect(calls).toHaveLength(0);
	});

	it("accepts the content types the caller names instead of the default ones", async () => {
		const gif = Buffer.from("GIF89a");
		const { modules } = fake(() => ({ body: gif, headers: { "content-type": "image/gif" } }));
		const types = new Map([["image/gif", "image/gif"]]);
		const got = await fetchUrl("https://files.example.com/a.gif", { ...base, types }, { modules, lookup: resolveTo(PUBLIC) });
		expect(got).toMatchObject({ mediaType: "image/gif" });
		expect(got.bytes.equals(gif)).toBe(true);
		const refused = await failure(fetchUrl("https://files.example.com/a.gif", base, { modules, lookup: resolveTo(PUBLIC) }));
		expect(refused).toMatchObject({ kind: "type" });
	});

	it("compares the host without case or a trailing dot", async () => {
		const { modules } = fake(() => ({ body: pdf }));
		const got = await fetchUrl("https://FILES.Example.com./a.pdf", base, { modules, lookup: resolveTo(PUBLIC) });
		expect(got).toMatchObject({ mediaType: "application/pdf", url: "https://files.example.com./a.pdf" });
		expect(got.bytes.equals(pdf)).toBe(true);
	});

	it.each([
		["ftp://files.example.com/a.pdf", /only http and https/],
		["file:///etc/passwd", /only http and https/],
		["javascript:alert(1)", /only http and https/],
		["https://user:secret@files.example.com/a.pdf", /credentials/],
		["https://user@files.example.com/a.pdf", /credentials/],
		["not a url", /not valid/],
		["", /not valid/]
	])("refuses %s", async (url, message) => {
		const { modules, calls } = fake(() => ({ body: pdf }));
		const error = await failure(fetchUrl(url, { ...base, allow: ["*"] }, { modules, lookup: resolveTo(PUBLIC) }));
		expect(error.kind).toBe("scheme");
		expect(error.message).toMatch(message);
		expect(calls).toHaveLength(0);
	});

	it("never puts the credentials of a URL in the message", async () => {
		const error = await failure(fetchUrl("https://user:secret@files.example.com/a.pdf", base, { lookup: resolveTo(PUBLIC) }));
		expect(`${error.message} ${error.detail}`).not.toContain("secret");
	});
});

describe("addresses", () => {
	const hostAddresses = [
		...new Set([
			"0.0.0.0",
			"10.0.0.5",
			"172.16.9.9",
			"192.168.0.10",
			"100.64.1.1",
			"127.0.0.1",
			"169.254.169.254",
			"224.0.0.251",
			"240.0.0.1",
			"::1",
			"::",
			"fe80::1",
			"fd00::1",
			"ff02::1",
			"::ffff:127.0.0.1",
			"::ffff:10.0.0.1",
			"::ffff:169.254.169.254",
			"::ffff:8.8.8.8",
			"64:ff9b::a00:1",
			"2002:a00:1::1"
		])
	];

	it.each(hostAddresses)("refuses a public name that resolves to %s, and never connects", async (address) => {
		const { modules, calls } = fake(() => ({ body: pdf }));
		const error = await failure(fetchUrl("https://files.example.com/a.pdf", base, { modules, lookup: resolveTo(address) }));
		expect(error).toMatchObject({ kind: "address", message: "the host resolves to an address that is not allowed" });
		expect(error.detail).toContain(address);
		expect(error.message).not.toContain(address);
		expect(calls).toHaveLength(0);
	});

	it("refuses a name when any one of its addresses is not allowed", async () => {
		const { modules, calls } = fake(() => ({ body: pdf }));
		const error = await failure(fetchUrl("https://files.example.com/a.pdf", base, { modules, lookup: resolveTo(PUBLIC, "10.0.0.1") }));
		expect(error.kind).toBe("address");
		expect(calls).toHaveLength(0);
	});

	it.each([
		["http://127.0.0.1/a.pdf"],
		["http://[::1]/a.pdf"],
		["http://2130706433/a.pdf"],
		["http://0x7f.1/a.pdf"],
		["http://[::ffff:127.0.0.1]/a.pdf"],
		["http://169.254.169.254/latest/meta-data"],
		["http://10.1.2.3:8080/a.pdf"]
	])("refuses the address literal %s without looking it up", async (url) => {
		let asked = 0;
		const { modules, calls } = fake(() => ({ body: pdf }));
		const error = await failure(
			fetchUrl(url, { ...base, allow: ["*"] }, { modules, lookup: async () => (asked++, [{ address: PUBLIC, family: 4 }]) })
		);
		expect(error.kind).toBe("address");
		expect(asked).toBe(0);
		expect(calls).toHaveLength(0);
	});

	it("allowPrivate lets private and loopback addresses through, and still applies the allow-list", async () => {
		const { modules, calls } = fake(() => ({ body: pdf }));
		const options = { ...base, allow: ["files.example.com", "10.0.0.7"], allowPrivate: true };
		await fetchUrl("https://files.example.com/a.pdf", options, { modules, lookup: resolveTo("10.0.0.1") });
		await fetchUrl("http://10.0.0.7/a.pdf", options, { modules });
		expect(calls.map((call) => call.address)).toEqual(["10.0.0.1", "10.0.0.7"]);
		expect((await failure(fetchUrl("https://other.example.com/a.pdf", options, { modules, lookup: resolveTo("10.0.0.1") }))).kind).toBe(
			"allow"
		);
	});

	it("an explicit * allows any host but still checks every address", async () => {
		const { modules } = fake(() => ({ body: pdf }));
		const options = { ...base, allow: ["*"] };
		expect((await fetchUrl("https://any.example.org/a.pdf", options, { modules, lookup: resolveTo(PUBLIC) })).mediaType).toBe(
			"application/pdf"
		);
		expect((await failure(fetchUrl("https://any.example.org/a.pdf", options, { modules, lookup: resolveTo("192.168.1.1") }))).kind).toBe(
			"address"
		);
	});

	it("reports a name that does not resolve, and an answer with no usable address", async () => {
		const { modules } = fake(() => ({ body: pdf }));
		const missing = await failure(
			fetchUrl("https://files.example.com/a.pdf", base, {
				modules,
				lookup: async () => {
					throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
				}
			})
		);
		expect(missing).toMatchObject({ kind: "dns", message: "the host name could not be resolved" });
		expect(missing.detail).toContain("ENOTFOUND");
		const bare = await failure(
			fetchUrl("https://files.example.com/a.pdf", base, {
				modules,
				lookup: async () => {
					throw new Error("boom");
				}
			})
		);
		expect(bare.detail).toContain("boom");
		expect((await failure(fetchUrl("https://files.example.com/a.pdf", base, { modules, lookup: async () => [] }))).kind).toBe("dns");
		expect((await failure(fetchUrl("https://files.example.com/a.pdf", base, { modules, lookup: async () => null }))).kind).toBe("dns");
		expect((await failure(fetchUrl("https://files.example.com/a.pdf", base, { modules, lookup: resolveTo("nonsense") }))).kind).toBe(
			"address"
		);
	});

	it("connects to the address it checked, once, however the name resolves later (DNS rebinding)", async () => {
		let asked = 0;
		const lookupOnce = async () => (++asked === 1 ? [{ address: PUBLIC, family: 4 }] : [{ address: "127.0.0.1", family: 4 }]);
		const { modules, calls } = fake(() => ({ body: pdf }));
		await fetchUrl("https://files.example.com/a.pdf", base, { modules, lookup: lookupOnce });
		expect(asked).toBe(1);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ address: PUBLIC, agent: false });
		expect(calls[0].url).toBe("https://files.example.com/a.pdf");
		expect(calls[0].headers["accept-encoding"]).toBe("identity");
	});

	it("answers both lookup shapes with the pinned address", async () => {
		const seen = [];
		const client = {
			request(url, options, callback) {
				const request = new EventEmitter();
				request.destroy = () => {};
				request.end = () => {
					options.lookup("files.example.com", {}, (_e, address, family) => seen.push([address, family]));
					options.lookup("files.example.com", { all: true }, (_e, list) => seen.push(list));
					const res = Readable.from([pdf]);
					res.statusCode = 200;
					res.headers = { "content-type": "application/pdf" };
					callback(res);
				};
				return request;
			}
		};
		await fetchUrl("http://files.example.com/a.pdf", base, {
			modules: { http: client, https: client },
			lookup: resolveTo("2606:4700:4700::1111")
		});
		expect(seen).toEqual([["2606:4700:4700::1111", 6], [{ address: "2606:4700:4700::1111", family: 6 }]]);
	});

	it("looks a name up with the system resolver, all addresses", async () => {
		expect(await lookup("127.0.0.1")).toEqual([{ address: "127.0.0.1", family: 4 }]);
	});
});

describe("redirects", () => {
	const redirect = (location, status = 302) => ({ status, headers: { location }, body: Buffer.alloc(0) });
	const names = {
		"files.example.com": PUBLIC,
		"cdn.example.com": "93.184.216.35",
		"metadata.example.com": "169.254.169.254",
		"internal.example.com": "10.0.0.9"
	};
	const resolver = async (host) => [{ address: names[host], family: 4 }];
	const options = { ...base, allow: Object.keys(names) };

	it("follows a redirect, resolving a relative Location, and re-checks each hop", async () => {
		const { modules, calls } = fake((url) =>
			url.pathname === "/a.pdf"
				? redirect("/b.pdf", 301)
				: url.pathname === "/b.pdf"
					? redirect("https://cdn.example.com/c.pdf", 307)
					: { body: pdf }
		);
		const got = await fetchUrl("https://files.example.com/a.pdf", options, { modules, lookup: resolver });
		expect(got.url).toBe("https://cdn.example.com/c.pdf");
		expect(calls.map((call) => [call.url, call.address])).toEqual([
			["https://files.example.com/a.pdf", PUBLIC],
			["https://files.example.com/b.pdf", PUBLIC],
			["https://cdn.example.com/c.pdf", "93.184.216.35"]
		]);
	});

	it("refuses a redirect to a host that is not on the allow-list", async () => {
		const { modules, calls } = fake(() => redirect("https://evil.example.net/steal"));
		const error = await failure(fetchUrl("https://files.example.com/a.pdf", options, { modules, lookup: resolver }));
		expect(error.kind).toBe("allow");
		expect(calls).toHaveLength(1);
	});

	it.each([
		["a listed name that resolves to the metadata address", "https://metadata.example.com/latest"],
		["a listed name that resolves to a private address", "https://internal.example.com/x"]
	])("refuses a redirect to %s", async (_name, location) => {
		const { modules, calls } = fake(() => redirect(location));
		const error = await failure(fetchUrl("https://files.example.com/a.pdf", options, { modules, lookup: resolver }));
		expect(error.kind).toBe("address");
		expect(calls).toHaveLength(1);
	});

	it("refuses a redirect to an address literal even when the literal is allowed by *", async () => {
		const { modules, calls } = fake(() => redirect("http://169.254.169.254/latest/meta-data"));
		const error = await failure(fetchUrl("http://files.example.com/a.pdf", { ...options, allow: ["*"] }, { modules, lookup: resolver }));
		expect(error.kind).toBe("address");
		expect(calls).toHaveLength(1);
	});

	it("refuses a redirect to another scheme", async () => {
		const { modules } = fake(() => redirect("file:///etc/passwd"));
		expect((await failure(fetchUrl("https://files.example.com/a.pdf", options, { modules, lookup: resolver }))).kind).toBe("scheme");
	});

	it("stops after maxRedirects hops", async () => {
		let n = 0;
		const { modules, calls } = fake(() => redirect(`/hop-${++n}`));
		const error = await failure(
			fetchUrl("https://files.example.com/a.pdf", { ...options, maxRedirects: 2 }, { modules, lookup: resolver })
		);
		expect(error).toMatchObject({ kind: "redirects", message: "too many redirects" });
		expect(calls).toHaveLength(3);
	});

	it("allows exactly maxRedirects hops, and none when it is 0", async () => {
		const { modules } = fake((url) => (url.pathname === "/end" ? { body: pdf } : redirect(url.pathname === "/a.pdf" ? "/m" : "/end")));
		expect((await fetchUrl("https://files.example.com/a.pdf", { ...options, maxRedirects: 2 }, { modules, lookup: resolver })).url).toBe(
			"https://files.example.com/end"
		);
		expect(
			(await failure(fetchUrl("https://files.example.com/a.pdf", { ...options, maxRedirects: 1 }, { modules, lookup: resolver }))).kind
		).toBe("redirects");
		expect(
			(await failure(fetchUrl("https://files.example.com/a.pdf", { ...options, maxRedirects: 0 }, { modules, lookup: resolver }))).kind
		).toBe("redirects");
	});

	it("refuses a redirect from https to http, and follows one from http to https", async () => {
		const down = fake(() => redirect("http://files.example.com/a.pdf"));
		const error = await failure(fetchUrl("https://files.example.com/a.pdf", options, { modules: down.modules, lookup: resolver }));
		expect(error).toMatchObject({ kind: "downgrade", message: "a redirect from https to http was refused" });
		expect(down.calls).toHaveLength(1);
		const up = fake((url) => (url.protocol === "http:" ? redirect("https://files.example.com/a.pdf") : { body: pdf }));
		expect((await fetchUrl("http://files.example.com/a.pdf", options, { modules: up.modules, lookup: resolver })).url).toBe(
			"https://files.example.com/a.pdf"
		);
	});

	it("reports a redirect without a usable Location as its status", async () => {
		const none = fake(() => ({ status: 302, headers: {}, body: Buffer.alloc(0) }));
		expect(await failure(fetchUrl("https://files.example.com/a.pdf", options, { modules: none.modules, lookup: resolver }))).toMatchObject({
			kind: "status",
			message: "the server answered HTTP 302"
		});
		const bad = fake(() => redirect("http://"));
		expect(
			(await failure(fetchUrl("https://files.example.com/a.pdf", options, { modules: bad.modules, lookup: resolver }))).message
		).toContain("invalid location");
	});
});

describe("against a local server", () => {
	let server;
	let url;
	let hits;
	const start = async (handler) => {
		hits = [];
		server = http.createServer((req, res) => {
			hits.push({ url: req.url, headers: req.headers, res });
			handler(req, res);
		});
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
		url = `http://127.0.0.1:${server.address().port}`;
	};
	afterEach(async () => {
		if (server) {
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
			server = undefined;
		}
	});
	const local = { allow: ["127.0.0.1"], maxBytes: 1024, timeout: 2000, maxRedirects: 3, allowPrivate: true };
	const reply =
		(status, type, body, extra = {}) =>
		(_req, res) => {
			res.writeHead(status, { "content-type": type, ...extra });
			res.end(body);
		};

	it("refuses the loopback server unless allowPrivate is set", async () => {
		await start(reply(200, "application/pdf", pdf));
		const error = await failure(fetchUrl(`${url}/a.pdf`, { ...local, allowPrivate: false }));
		expect(error.kind).toBe("address");
		expect(hits).toHaveLength(0);
		const second = await failure(fetchUrl(`${url}/a.pdf`, { ...local, allowPrivate: undefined }));
		expect(second.kind).toBe("address");
	});

	it("fetches a PDF and plain text, whatever the case or parameters of the content type", async () => {
		await start((req, res) =>
			req.url === "/a.pdf"
				? reply(200, "Application/PDF; charset=binary", pdf)(req, res)
				: reply(200, "text/plain; charset=utf-8", "héllo")(req, res)
		);
		const doc = await fetchUrl(`${url}/a.pdf`, local);
		expect(doc.mediaType).toBe("application/pdf");
		expect(doc.bytes.equals(pdf)).toBe(true);
		const text = await fetchUrl(`${url}/notes.txt`, local);
		expect(text.mediaType).toBe("text/plain");
		expect(text.bytes.toString("utf8")).toBe("héllo");
		expect(hits[0].headers).toMatchObject({ accept: "application/pdf, text/plain", "accept-encoding": "identity" });
		expect(hits[0].headers.authorization).toBeUndefined();
		expect(hits[0].headers.cookie).toBeUndefined();
	});

	it("does not trust the extension: the content type decides", async () => {
		await start(reply(200, "text/html", "<html></html>"));
		const error = await failure(fetchUrl(`${url}/report.pdf`, local));
		expect(error).toMatchObject({ kind: "type", message: expect.stringContaining("not supported") });
		expect(error.detail).toContain("text/html");
	});

	it.each([
		["no content type", {}],
		["an image", { "content-type": "image/png" }],
		["json", { "content-type": "application/json" }],
		["octet-stream", { "content-type": "application/octet-stream" }]
	])("refuses %s", async (_name, headers) => {
		await start((_req, res) => {
			res.writeHead(200, headers);
			res.end("data");
		});
		expect((await failure(fetchUrl(`${url}/a.pdf`, local))).kind).toBe("type");
	});

	it("checks that a PDF looks like one, but only in its first kilobyte", async () => {
		await start((req, res) =>
			reply(200, "application/pdf", req.url === "/junk" ? Buffer.concat([Buffer.alloc(900, 32), pdf]) : "<html>not a pdf</html>")(req, res)
		);
		expect((await failure(fetchUrl(`${url}/fake`, local))).message).toBe("the content is not a PDF");
		expect((await fetchUrl(`${url}/junk`, { ...local, maxBytes: 4096 })).mediaType).toBe("application/pdf");
	});

	it("refuses a compressed response", async () => {
		await start(reply(200, "application/pdf", pdf, { "content-encoding": "gzip" }));
		expect((await failure(fetchUrl(`${url}/a.pdf`, local))).kind).toBe("encoding");
	});

	it("refuses a bad status, naming it", async () => {
		await start((req, res) => reply(req.url === "/missing" ? 404 : 500, "text/plain", "no")(req, res));
		expect(await failure(fetchUrl(`${url}/missing`, local))).toMatchObject({ kind: "status", message: "the server answered HTTP 404" });
		expect((await failure(fetchUrl(`${url}/boom`, local))).message).toBe("the server answered HTTP 500");
	});

	it("refuses an oversized Content-Length before reading the body", async () => {
		await start((_req, res) => {
			res.writeHead(200, { "content-type": "application/pdf", "content-length": "5000" });
			res.write("%PDF-");
		});
		const error = await failure(fetchUrl(`${url}/big.pdf`, { ...local, maxBytes: 1000 }));
		expect(error).toMatchObject({ kind: "size", message: "the document is larger than 1000 bytes" });
		expect(error.detail).toBe("content-length 5000");
	});

	it("stops a streamed body with no Content-Length as soon as it passes the limit", async () => {
		let written = 0;
		await start((_req, res) => {
			res.writeHead(200, { "content-type": "text/plain" });
			const timer = setInterval(() => {
				if (res.destroyed || written >= 200) return clearInterval(timer);
				written++;
				return res.write(Buffer.alloc(4096, 97));
			}, 5);
			res.on("close", () => clearInterval(timer));
		});
		const error = await failure(fetchUrl(`${url}/stream.txt`, { ...local, maxBytes: 10_000 }));
		expect(error).toMatchObject({ kind: "size" });
		expect(error.detail).toBe("body passed 10000 bytes");
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(written).toBeLessThan(50);
	});

	it("accepts a body of exactly maxBytes", async () => {
		await start(reply(200, "text/plain", Buffer.alloc(1000, 98)));
		expect((await fetchUrl(`${url}/a.txt`, { ...local, maxBytes: 1000 })).bytes).toHaveLength(1000);
		expect((await failure(fetchUrl(`${url}/a.txt`, { ...local, maxBytes: 999 }))).kind).toBe("size");
	});

	it("times out a server that never answers", async () => {
		await start(() => {});
		const started = Date.now();
		const error = await failure(fetchUrl(`${url}/a.pdf`, { ...local, timeout: 150 }));
		expect(error).toMatchObject({ kind: "timeout", message: "the download did not finish within 150 ms" });
		expect(Date.now() - started).toBeLessThan(1500);
	});

	it("times out a body that stalls, and a name lookup that never answers", async () => {
		await start((_req, res) => {
			res.writeHead(200, { "content-type": "text/plain" });
			res.write("start");
		});
		expect((await failure(fetchUrl(`${url}/slow.txt`, { ...local, timeout: 150 }))).kind).toBe("timeout");
		const never = () => new Promise(() => {});
		expect((await failure(fetchUrl("http://files.example.com/a.pdf", { ...base, timeout: 100 }, { lookup: never }))).kind).toBe("timeout");
	});

	it("counts the whole fetch, redirects included, against one timeout", async () => {
		await start((req, res) => {
			if (req.url === "/start") {
				res.writeHead(302, { location: "/stall" });
				return res.end();
			}
			return undefined;
		});
		expect((await failure(fetchUrl(`${url}/start`, { ...local, timeout: 150 }))).kind).toBe("timeout");
	});

	it("stops when the caller's signal aborts", async () => {
		await start(() => {});
		const controller = new AbortController();
		setTimeout(() => controller.abort(new Error("client left")), 50);
		const error = await failure(fetchUrl(`${url}/a.pdf`, { ...local, signal: controller.signal }));
		expect(error).toMatchObject({ kind: "network", message: "the download was cancelled", detail: "client left" });
		const done = new AbortController();
		await start(reply(200, "text/plain", "ok"));
		expect((await fetchUrl(`${url}/a.txt`, { ...local, signal: done.signal })).bytes.toString()).toBe("ok");
		done.abort();
	});

	it("reports a refused connection as a network failure without the system error in the message", async () => {
		await start(reply(200, "text/plain", "ok"));
		const dead = url;
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
		server = undefined;
		const error = await failure(fetchUrl(`${dead}/a.txt`, local));
		expect(error).toMatchObject({ kind: "network", message: "the connection failed" });
		expect(error.detail).toContain("ECONNREFUSED");
	});

	it("keeps the host name for the Host header and connects to the address the lookup gave", async () => {
		await start(reply(200, "text/plain", "pinned"));
		const port = url.split(":").at(-1);
		let asked = 0;
		const options = { ...local, allow: ["files.example.test"] };
		const got = await fetchUrl(`http://files.example.test:${port}/a.txt`, options, {
			lookup: async (host) => (asked++, host === "files.example.test" ? [{ address: "127.0.0.1", family: 4 }] : [])
		});
		expect(got.bytes.toString()).toBe("pinned");
		expect(asked).toBe(1);
		expect(hits[0].headers.host).toBe(`files.example.test:${port}`);
	});

	it("reports whatever the request itself throws, and a caller that aborts with a bare value", async () => {
		const throwing = (value) => ({
			request() {
				throw value;
			}
		});
		const run = (value) =>
			fetchUrl("http://files.example.com/a.pdf", base, {
				modules: { http: throwing(value), https: throwing(value) },
				lookup: resolveTo(PUBLIC)
			});
		expect(await failure(run(new Error("kaboom")))).toMatchObject({ kind: "network", message: "the connection failed", detail: "kaboom" });
		expect((await failure(run("plain text"))).detail).toBe("plain text");
		await start(() => {});
		const controller = new AbortController();
		setTimeout(() => controller.abort("bare"), 30);
		expect((await failure(fetchUrl(`${url}/a.pdf`, { ...local, signal: controller.signal }))).detail).toBe("bare");
	});

	it("uses the real http and https modules and the system resolver by default", async () => {
		await start(reply(200, "text/plain", "default"));
		expect((await fetchUrl(`${url}/a.txt`, local)).bytes.toString()).toBe("default");
		const port = url.split(":").at(-1);
		const error = await failure(fetchUrl(`https://127.0.0.1:${port}/a.txt`, local));
		expect(error.kind).toBe("network");
	});
});

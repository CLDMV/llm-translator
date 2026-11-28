/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/mcp.test.vitest.mjs
 *	@Date: 2026-11-28T12:00:00-08:00 (1795896000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-28T12:00:00-08:00 (1795896000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The MCP client (`lib/mcp.mjs`): the settings, the host allowlist and address checks, and the JSON-RPC calls against an in-process mock server.
 */
import { afterEach, describe, expect, it } from "vitest";
import { allowed, connect, isInternal, normalize } from "../../src/lib/mcp.mjs";
import { mockMcp } from "../helpers/mock-mcp.mjs";

const open = [];
afterEach(async () => {
	while (open.length > 0) await open.pop().close();
});
const serve = async (options) => {
	const server = await mockMcp(options);
	open.push(server);
	return server;
};
const setting = (extra = {}) => normalize({ hosts: ["127.0.0.1"], ...extra });

describe("serverTools.mcp", () => {
	it("is off when absent and takes a list of hosts", () => {
		expect(normalize(undefined)).toBeUndefined();
		expect(normalize(null)).toBeUndefined();
		const on = normalize({ hosts: [" MCP.Example.com ", "[::1]", "*.corp.test"] });
		expect(on.hosts).toEqual(["mcp.example.com", "::1", "*.corp.test"]);
		expect(on).toMatchObject({ timeout: 30000, maxResponse: 4 * 1024 * 1024 });
		expect(typeof on.fetch).toBe("function");
		expect(typeof on.lookup).toBe("function");
	});

	it("refuses what is not usable", () => {
		for (const bad of [
			5,
			[],
			{},
			{ hosts: [] },
			{ hosts: [""] },
			{ hosts: [5] },
			{ hosts: ["a/b"] },
			{ hosts: ["u@h"] },
			{ hosts: ["a b"] }
		]) {
			expect(() => normalize(bad)).toThrowError(expect.objectContaining({ code: "INVALID_CONFIG" }));
		}
		for (const extra of [{ timeout: 0 }, { timeout: 1.5 }, { maxResponse: -1 }, { fetch: 5 }, { lookup: "x" }]) {
			expect(() => normalize({ hosts: ["a.test"], ...extra })).toThrowError(expect.objectContaining({ code: "INVALID_CONFIG" }));
		}
	});
});

describe("the host allowlist", () => {
	const on = normalize({ hosts: ["mcp.example.com", "*.corp.test", "127.0.0.1", "::1"] });

	it("takes an exact host or a subdomain of a wildcard entry", () => {
		expect(allowed("https://mcp.example.com/x", on)).toMatchObject({ host: "mcp.example.com", exact: true });
		expect(allowed("https://a.b.corp.test/", on)).toMatchObject({ host: "a.b.corp.test", exact: false });
		expect(allowed("http://127.0.0.1:8080/mcp", on)).toMatchObject({ exact: true });
		expect(allowed("http://[::1]:8080/mcp", on)).toMatchObject({ host: "::1", exact: true });
	});

	it("refuses everything else", () => {
		for (const url of [
			"https://other.example.com/",
			"https://corp.test/",
			"https://evilcorp.test/",
			"ftp://mcp.example.com/",
			"https://user:pw@mcp.example.com/",
			"https://:pw@mcp.example.com/",
			"not a url"
		]) {
			expect(() => allowed(url, on)).toThrowError(expect.objectContaining({ code: "unsupported_tool" }));
		}
	});
});

describe("internal addresses", () => {
	it("knows the private, loopback, link-local and reserved ranges", () => {
		for (const address of [
			"0.0.0.0",
			"10.1.2.3",
			"127.0.0.1",
			"100.64.0.1",
			"169.254.169.254",
			"172.16.0.1",
			"172.31.255.255",
			"192.0.0.1",
			"192.168.1.1",
			"198.18.0.1",
			"224.0.0.1",
			"255.255.255.255",
			"::",
			"::1",
			"fc00::1",
			"fd12::1",
			"fe80::1",
			"ff02::1",
			"::ffff:10.0.0.1",
			"::ffff:7f00:1",
			"64:ff9b::1",
			"2001::1",
			"2001:db8::1"
		]) {
			expect(isInternal(address), address).toBe(true);
		}
		for (const address of ["8.8.8.8", "172.32.0.1", "100.63.0.1", "192.0.2.1", "198.20.0.1", "2606:4700::1111", "::ffff:8.8.8.8"]) {
			expect(isInternal(address), address).toBe(false);
		}
	});
});

describe("the client", () => {
	it("initializes, lists across pages and calls a tool, with the session, the protocol version and the credentials on every call", async () => {
		const server = await serve({ pageSize: 1, session: "sess-1" });
		const client = connect({ url: server.url, headers: { "x-team": "a" }, authorization: "tok-123" }, setting());
		await client.initialize();
		const tools = await client.list();
		expect(tools.map((tool) => tool.name)).toEqual(["search", "delete"]);
		expect(await client.call("search", { q: "x" })).toEqual({ text: 'called search {"q":"x"}', error: false });
		await client.close();
		const calls = server.requests.map((request) => request.body?.method ?? request.method);
		expect(calls).toEqual(["initialize", "notifications/initialized", "tools/list", "tools/list", "tools/call", "DELETE"]);
		expect(server.requests[0].body.params).toMatchObject({ protocolVersion: "2025-06-18", clientInfo: { name: "llm-translator" } });
		for (const request of server.requests) {
			expect(request.headers.authorization).toBe("Bearer tok-123");
			expect(request.headers["x-team"]).toBe("a");
		}
		expect(server.requests[0].headers["mcp-session-id"]).toBeUndefined();
		for (const request of server.requests.slice(1)) {
			expect(request.headers["mcp-session-id"]).toBe("sess-1");
			expect(request.headers["mcp-protocol-version"]).toBe("2025-06-18");
		}
	});

	it("reads Server-Sent Events replies, takes a full authorization value as it is, and never overrides a header the client set", async () => {
		const server = await serve({ sse: true });
		const first = connect({ url: server.url, authorization: "Basic abc" }, setting());
		await first.initialize();
		expect((await first.list()).length).toBe(2);
		await first.close();
		expect(server.requests[0].headers.authorization).toBe("Basic abc");
		const second = connect({ url: server.url, headers: { Authorization: "mine" }, authorization: "tok" }, setting());
		await second.initialize();
		expect(server.requests.at(-1).headers.authorization).toBe("mine");
		const third = connect({ url: server.url, headers: { authorization: "lower" }, authorization: "tok" }, setting());
		await third.initialize();
		expect(server.requests.at(-1).headers.authorization).toBe("lower");
		const none = connect({ url: server.url }, setting());
		await none.initialize();
		expect(server.requests.at(-1).headers.authorization).toBeUndefined();
		await none.close();
	});

	it("reports an error result, structured content and non-text parts as text", async () => {
		const results = {
			bad: { content: [{ type: "text", text: "boom" }], isError: true },
			structured: { structuredContent: { a: 1 } },
			image: { content: [{ type: "image", data: "xx" }, { type: "text" }] },
			empty: {}
		};
		const server = await serve({ call: (name) => results[name] });
		const client = connect({ url: server.url }, setting());
		await client.initialize();
		expect(await client.call("bad", {})).toEqual({ text: "boom", error: true });
		expect(await client.call("structured", {})).toEqual({ text: '{"a":1}', error: false });
		expect(await client.call("image", {})).toEqual({ text: '{"type":"image","data":"xx"}\n', error: false });
		expect(await client.call("empty", {})).toEqual({ text: "", error: false });
	});

	it("fails on an HTTP error, a JSON-RPC error, a missing reply, a reply that is too long, a redirect and a call it cannot make", async () => {
		const failing = await serve({ listStatus: 500 });
		const one = connect({ url: failing.url }, setting());
		await one.initialize();
		await expect(one.list()).rejects.toThrow(/HTTP 500/);
		const errored = await serve({ rpcError: "denied" });
		const two = connect({ url: errored.url }, setting());
		await two.initialize();
		await expect(two.call("x", {})).rejects.toThrow(/tools\/call: denied/);
		const silent = await serve({ silent: true });
		const three = connect({ url: silent.url }, setting());
		await three.initialize();
		await expect(three.call("x", {})).rejects.toThrow(/no reply/);
		const big = await serve({ big: "0123456789" });
		const four = connect({ url: big.url }, setting({ maxResponse: 1000 }));
		await four.initialize();
		await expect(four.call("x", {})).rejects.toThrow(/longer than 1000/);
		const moved = await serve({ redirect: 302 });
		await expect(connect({ url: moved.url }, setting()).initialize()).rejects.toThrow();
		const refused = connect(
			{ url: moved.url },
			normalize({
				hosts: ["127.0.0.1"],
				fetch: async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
			})
		);
		await expect(refused.initialize()).rejects.toThrow(/no reply|Unexpected|answer/);
		expect(() => connect({ url: "https://elsewhere.test/" }, setting())).toThrowError(
			expect.objectContaining({ code: "unsupported_tool" })
		);
	});

	it("ends a stream of pages and a call with no content list, and skips close without a session", async () => {
		const server = await serve({ call: () => ({ content: "x" }) });
		const client = connect({ url: server.url }, setting());
		await client.initialize();
		expect((await client.call("x", {})).text).toBe("");
		await client.close();
		expect(server.requests.some((request) => request.method === "DELETE")).toBe(false);
	});

	it("takes an empty reply body and a reply with no tools field", async () => {
		const answers = [
			new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), { headers: { "content-type": "application/json" } }),
			new Response(null, { status: 202 }),
			new Response(JSON.stringify([{ jsonrpc: "2.0", id: 2, result: {} }]), { headers: { "content-type": "application/json" } }),
			new Response(null, { status: 200, headers: { "content-type": "application/json" } })
		];
		const client = connect({ url: "http://127.0.0.1:9/" }, normalize({ hosts: ["127.0.0.1"], fetch: async () => answers.shift() }));
		await client.initialize();
		expect(await client.list()).toEqual([]);
		await expect(client.call("x", {})).rejects.toThrow();
	});

	it("ignores a session end that fails", async () => {
		let n = 0;
		const fetchStub = async () => {
			n++;
			if (n === 1)
				return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), {
					headers: { "content-type": "application/json", "mcp-session-id": "s" }
				});
			if (n === 2) return new Response(null, { status: 202 });
			throw new Error("gone");
		};
		const client = connect({ url: "http://127.0.0.1:9/" }, normalize({ hosts: ["127.0.0.1"], fetch: fetchStub }));
		await client.initialize();
		await expect(client.close()).resolves.toBeUndefined();
	});
});

describe("odd replies", () => {
	const jsonReply = (body, headers = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { headers });
	const stub = (...answers) => {
		const list = [...answers];
		return normalize({ hosts: ["127.0.0.1"], fetch: async () => list.shift() });
	};

	it("reads a reply with no content type as JSON, and an error with no message", async () => {
		const client = connect(
			{ url: "http://127.0.0.1:9/" },
			stub(
				new Response(new TextEncoder().encode(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }))),
				new Response(null, { status: 202 }),
				jsonReply({ jsonrpc: "2.0", id: 2, error: {} }, { "content-type": "application/json" })
			)
		);
		await client.initialize();
		await expect(client.list()).rejects.toThrow(/tools\/list: the server answered with an error/);
	});

	it("passes the caller's abort signal on, and ends a session whose handshake did not finish", async () => {
		const seen = [];
		const controller = new AbortController();
		const answers = [
			jsonReply({ jsonrpc: "2.0", id: 1, error: { message: "not now" } }, { "content-type": "application/json", "mcp-session-id": "s" }),
			new Response(null, { status: 204 })
		];
		const client = connect(
			{ url: "http://127.0.0.1:9/" },
			normalize({
				hosts: ["127.0.0.1"],
				fetch: async (url, init) => {
					seen.push(init);
					return answers.shift();
				}
			}),
			controller.signal
		);
		await expect(client.initialize()).rejects.toThrow(/not now/);
		await client.close();
		expect(seen.map((init) => init.method)).toEqual(["POST", "DELETE"]);
		expect(seen[1].headers["mcp-protocol-version"]).toBeUndefined();
		expect(seen[0].signal.aborted).toBe(false);
		controller.abort();
		expect(seen[0].signal.aborted).toBe(true);
	});
});

describe("where a host resolves", () => {
	const lookup = (answers) => async (host) => {
		if (answers[host] === undefined) throw new Error("ENOTFOUND");
		return answers[host].map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
	};
	const ok = async () =>
		new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), { headers: { "content-type": "application/json" } });
	const reach = (host, hosts, answers) =>
		connect({ url: `https://${host}/mcp` }, normalize({ hosts, fetch: ok, lookup: lookup(answers) })).initialize();

	it("calls a host that resolves to public addresses only", async () => {
		await expect(reach("a.corp.test", ["*.corp.test"], { "a.corp.test": ["93.184.216.34"] })).resolves.toBeUndefined();
	});

	it("refuses a wildcard match that resolves to an internal address, with any of several addresses", async () => {
		await expect(reach("a.corp.test", ["*.corp.test"], { "a.corp.test": ["10.0.0.5"] })).rejects.toThrow(/private or loopback/);
		await expect(reach("a.corp.test", ["*.corp.test"], { "a.corp.test": ["93.184.216.34", "127.0.0.1"] })).rejects.toThrow(
			/private or loopback/
		);
	});

	it("lets a host that is named exactly use an internal address", async () => {
		await expect(reach("mcp.corp.test", ["mcp.corp.test"], { "mcp.corp.test": ["10.0.0.5"] })).resolves.toBeUndefined();
	});

	it("refuses a host that does not resolve", async () => {
		await expect(reach("gone.corp.test", ["*.corp.test"], {})).rejects.toThrow(/does not resolve/);
	});
});

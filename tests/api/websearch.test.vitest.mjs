/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/websearch.test.vitest.mjs
 *	@Date: 2026-11-25T00:32:54-08:00 (1795595574)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-25T00:38:15-08:00 (1795595895)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The `web_search_*` server tool: the executor, the SearXNG adapter and the tool through the server tool runner.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { openaiSse } from "../helpers/streams.mjs";
import { TranslatorError } from "../../src/lib/errors.mjs";
import { searxng, seal, unseal, webSearch } from "../../src/lib/websearch.mjs";
import { searxng as exported, webSearch as exportedWebSearch } from "../../src/index.mjs";
import { history, normalize } from "../../src/lib/servertools.mjs";

afterEach(async () => {
	vi.unstubAllGlobals();
	await closeAll();
});

const chat = { url: "http://vllm.test", backend: "vllm", api: "chat", models: ["qwen3-coder"] };
const tool = { type: "web_search_20250305", name: "web_search", max_uses: 5 };
const ask = { model: "qwen3-coder", max_tokens: 64, messages: [{ role: "user", content: "find it" }], tools: [tool] };

/** A provider that records its calls and answers with `hits` (or whatever `answer` returns). */
function provider(hits = [], answer) {
	const calls = [];
	return {
		calls,
		name: "fake",
		search: async (query, options) => {
			calls.push({ query, options });
			return answer ? answer(query, options) : hits;
		}
	};
}

const hit = (n, extra = {}) => ({ url: `https://site${n}.test/page`, title: `Site ${n}`, snippet: `snippet ${n}`, ...extra });

describe("webSearch executor", () => {
	it("is offered with a query schema and a description", () => {
		const executor = webSearch({ provider: provider() });
		expect(executor.type.test("web_search_20260209")).toBe(true);
		expect(executor.schema(tool)).toEqual({
			type: "object",
			properties: { query: { type: "string", description: "The search query." } },
			required: ["query"]
		});
		expect(executor.description).toMatch(/Search the web/);
	});

	it("rejects an unusable configuration", () => {
		expect(() => webSearch()).toThrow(TranslatorError);
		expect(() => webSearch({})).toThrow(/provider must have a search function/);
		expect(() => webSearch({ provider: {} })).toThrow(/provider/);
		expect(() => webSearch({ provider: provider(), count: 0 })).toThrow(/count/);
		expect(() => webSearch({ provider: provider(), maxQueryLength: 1.5 })).toThrow(/maxQueryLength/);
		expect(webSearch({ provider: provider(), type: "web_search_20250305" }).type).toBe("web_search_20250305");
	});

	it("maps provider hits to web_search_result blocks with a readable encrypted_content", async () => {
		const fake = provider([hit(1, { page_age: "April 30, 2025" }), hit(2, { title: undefined, snippet: undefined })]);
		const executor = webSearch({ provider: fake });
		const out = await executor.run({ query: "slothlet" }, { tool, signal: undefined });
		expect(out.content).toEqual([
			{
				type: "web_search_result",
				url: "https://site1.test/page",
				title: "Site 1",
				encrypted_content: seal("snippet 1"),
				page_age: "April 30, 2025"
			},
			{
				type: "web_search_result",
				url: "https://site2.test/page",
				title: "https://site2.test/page",
				encrypted_content: seal(undefined),
				page_age: null
			}
		]);
		expect(unseal(out.content[0].encrypted_content)).toBe("snippet 1");
		expect(unseal(out.content[1].encrypted_content)).toBe("");
		expect(fake.calls[0]).toEqual({
			query: "slothlet",
			options: { count: 5, allowedDomains: undefined, blockedDomains: undefined, userLocation: undefined, signal: undefined }
		});
	});

	it("passes user_location, the signal and the domain lists to the provider and caps the results at count", async () => {
		const fake = provider([hit(1), hit(2), hit(3), { url: "", title: "empty" }, { title: "no url" }, null]);
		const executor = webSearch({ provider: fake, count: 2 });
		const signal = new AbortController().signal;
		const location = { type: "approximate", city: "Austin", country: "US" };
		const out = await executor.run(
			{ query: "q" },
			{ tool: { ...tool, user_location: location, blocked_domains: ["other.test"], allowed_domains: [] }, signal }
		);
		expect(out.content.map((block) => block.url)).toEqual(["https://site1.test/page", "https://site2.test/page"]);
		expect(fake.calls[0].options).toEqual({
			count: 2,
			allowedDomains: undefined,
			blockedDomains: ["other.test"],
			userLocation: location,
			signal
		});
	});

	it("keeps only allowed domains, subdomains included, and honours a path in the entry", async () => {
		const fake = provider([
			{ url: "https://docs.example.com/a", title: "a" },
			{ url: "https://example.com/blog/x", title: "b" },
			{ url: "https://example.com/shop/x", title: "c" },
			{ url: "https://notexample.com/", title: "d" },
			{ url: "not a url", title: "e" }
		]);
		const executor = webSearch({ provider: fake });
		const all = await executor.run({ query: "q" }, { tool: { ...tool, allowed_domains: ["Example.com"] } });
		expect(all.content.map((block) => block.title)).toEqual(["a", "b", "c"]);
		const path = await executor.run({ query: "q" }, { tool: { ...tool, allowed_domains: ["https://example.com/blog"] } });
		expect(path.content.map((block) => block.title)).toEqual(["b"]);
		expect(fake.calls[0].options.allowedDomains).toEqual(["Example.com"]);
	});

	it("drops blocked domains and keeps results whose URL cannot be parsed", async () => {
		const fake = provider([
			{ url: "https://bad.test/a", title: "a" },
			{ url: "https://www.bad.test/b", title: "b" },
			{ url: "https://good.test/c", title: "c" },
			{ url: "/relative", title: "d" }
		]);
		const executor = webSearch({ provider: fake });
		const out = await executor.run({ query: "q" }, { tool: { ...tool, blocked_domains: ["bad.test"] } });
		expect(out.content.map((block) => block.title)).toEqual(["c", "d"]);
	});

	it("rejects bad input with Anthropic's codes", async () => {
		const fake = provider([hit(1)]);
		const executor = webSearch({ provider: fake, maxQueryLength: 10 });
		const code = async (input, extra = {}) => {
			try {
				await executor.run(input, { tool: { ...tool, ...extra } });
			} catch (error) {
				return error.code;
			}
			return "none";
		};
		expect(await code({})).toBe("invalid_tool_input");
		expect(await code(undefined)).toBe("invalid_tool_input");
		expect(await code({ query: "  " })).toBe("invalid_tool_input");
		expect(await code({ query: 5 })).toBe("invalid_tool_input");
		expect(await code({ query: "a very long query" })).toBe("query_too_long");
		expect(await code({ query: "q" }, { allowed_domains: ["a.test"], blocked_domains: ["b.test"] })).toBe("invalid_tool_input");
		expect(fake.calls).toHaveLength(0);
	});

	it("turns provider failures into error codes, keeping only the codes Anthropic defines", async () => {
		const code = async (answer) => {
			const executor = webSearch({ provider: provider([], answer) });
			try {
				await executor.run({ query: "q" }, { tool });
			} catch (error) {
				return [error.code, error.message];
			}
			return ["none"];
		};
		expect(await code(() => Promise.reject(Object.assign(new Error("slow down"), { code: "too_many_requests" })))).toEqual([
			"too_many_requests",
			"slow down"
		]);
		expect(await code(() => Promise.reject(Object.assign(new Error("boom"), { code: "ECONNRESET" })))).toEqual(["unavailable", "boom"]);
		expect(await code(() => Promise.reject("text failure"))).toEqual(["unavailable", "text failure"]);
		expect(await code(() => Promise.reject(undefined))).toEqual(["unavailable", "undefined"]);
		expect(await code(() => "not a list")).toEqual(["unavailable", "the search provider returned no result list"]);
	});

	it("reads results back as text, with the snippet restored from encrypted_content", () => {
		const executor = webSearch({ provider: provider() });
		const content = [
			{ type: "web_search_result", url: "https://a.test", title: "A", encrypted_content: seal("about a"), page_age: "May 1, 2025" },
			{ type: "web_search_result", url: "https://b.test", title: "B", encrypted_content: "###", page_age: null }
		];
		expect(executor.read(content)).toBe("1. A (May 1, 2025)\nhttps://a.test\nabout a\n\n2. B\nhttps://b.test");
		expect(executor.read([])).toBe("No results.");
		expect(executor.read("odd")).toBe("No results.");
	});

	it("unseals only what seal wrote", () => {
		expect(unseal(seal("x"))).toBe("x");
		expect(unseal("%%%")).toBe("");
		expect(unseal(Buffer.from('{"snippet":5}').toString("base64"))).toBe("");
		expect(unseal(undefined)).toBe("");
	});
});

describe("searxng adapter", () => {
	/** A fetch that answers with a SearXNG body and records requests. */
	function searx(body, init = {}) {
		const calls = [];
		const fetch = async (url, options) => {
			calls.push({ url, options });
			if (init.error) throw init.error;
			return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: init.status ?? 200 });
		};
		return { fetch, calls };
	}

	it("requests /search?format=json&q= with the configured headers and maps results", async () => {
		const { fetch, calls } = searx({
			results: [
				{ url: "https://a.test", title: "A", content: "about a", publishedDate: "2025-04-30T12:00:00" },
				{ url: "https://b.test", title: "B", content: "about b", publishedDate: "garbage" },
				{ url: "https://c.test", title: "C", content: "about c", publishedDate: 5 },
				{ url: "https://d.test", title: "D" }
			]
		});
		const adapter = searxng({ url: "https://searx.test///", headers: { "x-key": "k" }, fetch });
		expect(adapter.name).toBe("searxng");
		const out = await adapter.search("hello world & more", { count: 5 });
		expect(calls[0].url).toBe("https://searx.test/search?q=hello+world+%26+more&format=json");
		expect(calls[0].options.headers).toEqual({ accept: "application/json", "x-key": "k" });
		expect(out).toEqual([
			{ url: "https://a.test", title: "A", snippet: "about a", page_age: "April 30, 2025" },
			{ url: "https://b.test", title: "B", snippet: "about b", page_age: null },
			{ url: "https://c.test", title: "C", snippet: "about c", page_age: null },
			{ url: "https://d.test", title: "D", snippet: undefined, page_age: null }
		]);
	});

	it("adds language, categories, engines and safesearch when configured, and the language can depend on user_location", async () => {
		const { fetch, calls } = searx({ results: [] });
		await searxng({
			url: "https://s.test",
			language: "en-US",
			categories: "general,news",
			engines: "duckduckgo",
			safesearch: 0,
			fetch
		}).search("q");
		expect(calls[0].url).toBe(
			"https://s.test/search?q=q&format=json&language=en-US&categories=general%2Cnews&engines=duckduckgo&safesearch=0"
		);
		const dynamic = searxng({ url: "https://s.test", language: (location) => (location?.country === "DE" ? "de-DE" : undefined), fetch });
		await dynamic.search("q", { userLocation: { country: "DE" } });
		await dynamic.search("q", { userLocation: { country: "US" } });
		expect(calls[1].url).toContain("language=de-DE");
		expect(calls[2].url).not.toContain("language");
	});

	it("aborts on the caller's signal and on its own time limit", async () => {
		let seen;
		const fetch = async (url, { signal }) => {
			seen = signal;
			return new Response('{"results":[]}');
		};
		const controller = new AbortController();
		await searxng({ url: "https://s.test", fetch }).search("q", { signal: controller.signal });
		expect(seen.aborted).toBe(false);
		controller.abort();
		expect(seen.aborted).toBe(true);
		await searxng({ url: "https://s.test", fetch }).search("q");
		expect(seen.aborted).toBe(false);
	});

	it("uses globalThis.fetch by default", async () => {
		const stub = vi.fn(async () => new Response('{"results":[]}'));
		vi.stubGlobal("fetch", stub);
		expect(await searxng({ url: "https://s.test" }).search("q")).toEqual([]);
		expect(stub).toHaveBeenCalledOnce();
	});

	it("maps HTTP and body failures to error codes", async () => {
		const failure = async (body, init) => {
			try {
				await searxng({ url: "https://s.test", fetch: searx(body, init).fetch }).search("q");
			} catch (error) {
				return [error.code, error.message];
			}
			return ["none"];
		};
		expect((await failure({}, { status: 429 }))[0]).toBe("too_many_requests");
		expect(await failure({}, { status: 403 })).toEqual(["unavailable", "SearXNG answered HTTP 403"]);
		expect((await failure("<html>", {}))[1]).toMatch(/did not answer with JSON/);
		expect((await failure({ nothing: true }, {}))[1]).toMatch(/no results list/);
		expect(await failure({}, { error: new Error("ECONNREFUSED") })).toEqual(["unavailable", "SearXNG request failed: ECONNREFUSED"]);
		expect((await failure({}, { error: "plain" }))[1]).toBe("SearXNG request failed: plain");
	});

	it("rejects an unusable configuration", () => {
		expect(() => searxng()).toThrow(TranslatorError);
		expect(() => searxng({})).toThrow(/url is required/);
		expect(() => searxng({ url: "https://s.test", timeout: 0 })).toThrow(/timeout/);
	});

	it("is exported from the package entry", () => {
		expect(exported).toBe(searxng);
		expect(exportedWebSearch).toBe(webSearch);
	});
});

describe("the executor in the server tool runner", () => {
	const usage = (prompt, completion) => ({ prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion });
	const calling = (calls) => ({
		id: "chatcmpl-1",
		object: "chat.completion",
		created: 1,
		model: "qwen3-coder",
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					content: null,
					tool_calls: calls.map(([id, name, args]) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } }))
				},
				finish_reason: "tool_calls"
			}
		],
		usage: usage(10, 5)
	});
	const saying = (content) => ({
		id: "chatcmpl-2",
		object: "chat.completion",
		created: 1,
		model: "qwen3-coder",
		choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
		usage: usage(20, 7)
	});
	const base = { id: "chatcmpl-s", object: "chat.completion.chunk", created: 1, model: "qwen3-coder" };
	const streamed = (delta, finish, tokens) => [
		{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
		...delta.map((part) => ({ ...base, choices: [{ index: 0, delta: part, finish_reason: null }] })),
		{ ...base, choices: [{ index: 0, delta: {}, finish_reason: finish }] },
		{ ...base, choices: [], usage: tokens },
		"[DONE]"
	];
	const sse = (list) => ({ status: 200, body: openaiSse(list), headers: { "content-type": "text/event-stream" } });
	const script = (replies) => {
		let turn = 0;
		const transport = fakeTransport(() => replies[turn++]);
		transport.bodies = () => transport.calls.map((call) => JSON.parse(call.init.body));
		return transport;
	};
	const json = (body) => ({ status: 200, body });

	/** A SearXNG fetch over `results`, and the translator config that uses it. */
	function setup(results = [{ url: "https://a.test/x", title: "A", content: "about a" }], init = {}) {
		const calls = [];
		const fetch = async (url) => {
			calls.push(url);
			if (init.status) return new Response("{}", { status: init.status });
			return new Response(JSON.stringify({ results }));
		};
		return { calls, serverTools: [webSearch({ provider: searxng({ url: "https://searx.test", fetch }) })] };
	}

	it("returns a web_search_tool_result, counts the request and shows the model the readable result", async () => {
		const { calls, serverTools } = setup();
		const transport = script([json(calling([["c1", "web_search", { query: "a" }]])), json(saying("done"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools });
		const reply = await api.send({ ...ask, tools: [{ ...tool, allowed_domains: ["a.test"] }] });
		expect(calls).toEqual(["https://searx.test/search?q=a&format=json"]);
		expect(reply.body.content.map((block) => block.type)).toEqual(["server_tool_use", "web_search_tool_result", "text"]);
		expect(reply.body.content[1].content).toEqual([
			{ type: "web_search_result", url: "https://a.test/x", title: "A", encrypted_content: seal("about a"), page_age: null }
		]);
		expect(reply.body.usage.server_tool_use).toEqual({ web_search_requests: 1 });
		expect(transport.bodies()[1].messages.at(-1).content).toBe("1. A\nhttps://a.test/x\nabout a");
	});

	it("streams the call and the result blocks", async () => {
		const { serverTools } = setup();
		const transport = script([
			sse(
				streamed(
					[{ tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "web_search", arguments: '{"query":"a"}' } }] }],
					"tool_calls",
					usage(10, 5)
				)
			),
			sse(streamed([{ content: "done" }], "stop", usage(20, 7)))
		]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools });
		const reply = await api.send({ ...ask, stream: true });
		const events = await collect(reply.stream);
		const types = events.filter((event) => event.event === "content_block_start").map((event) => event.data.content_block.type);
		expect(types).toEqual(["server_tool_use", "web_search_tool_result", "text"]);
		expect(events.find((event) => event.event === "message_delta").data.usage.server_tool_use).toEqual({ web_search_requests: 1 });
	});

	it("answers provider failures with the web_search_tool_result_error code", async () => {
		const { serverTools } = setup([], { status: 429 });
		const transport = script([json(calling([["c1", "web_search", { query: "a" }]])), json(saying("sorry"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools });
		const reply = await api.send(ask);
		expect(reply.body.content[1].content).toEqual({ type: "web_search_tool_result_error", error_code: "too_many_requests" });
		expect(transport.bodies()[1].messages.at(-1).content).toBe(
			'[error] {"type":"web_search_tool_result_error","error_code":"too_many_requests"}'
		);
	});

	it("answers max_uses_exceeded without asking the provider again", async () => {
		const { calls, serverTools } = setup();
		const transport = script([
			json(calling([["c1", "web_search", { query: "a" }]])),
			json(calling([["c2", "web_search", { query: "b" }]])),
			json(calling([["c3", "web_search", { query: "c" }]])),
			json(saying("fin"))
		]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools });
		const reply = await api.send({ ...ask, tools: [{ ...tool, max_uses: 2 }] });
		const results = reply.body.content.filter((block) => block.type === "web_search_tool_result");
		expect(results[2].content).toEqual({ type: "web_search_tool_result_error", error_code: "max_uses_exceeded" });
		expect(calls).toHaveLength(2);
		expect(reply.body.usage.server_tool_use).toEqual({ web_search_requests: 2 });
	});

	it("answers query_too_long and invalid_tool_input without asking the provider", async () => {
		const { calls, serverTools } = setup();
		const transport = script([
			json(calling([["c1", "web_search", { query: "x".repeat(500) }]])),
			json(calling([["c2", "web_search", {}]])),
			json(saying("fin"))
		]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools });
		const reply = await api.send(ask);
		const results = reply.body.content.filter((block) => block.type === "web_search_tool_result");
		expect(results.map((block) => block.content.error_code)).toEqual(["query_too_long", "invalid_tool_input"]);
		expect(calls).toHaveLength(0);
	});

	it("restores the result text when the client replays the history", async () => {
		const { serverTools } = setup();
		const transport = script([json(saying("ok"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools });
		const messages = [
			{ role: "user", content: "find it" },
			{
				role: "assistant",
				content: [
					{ type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "a" } },
					{
						type: "web_search_tool_result",
						tool_use_id: "srvtoolu_1",
						content: [
							{
								type: "web_search_result",
								url: "https://a.test/x",
								title: "A",
								encrypted_content: seal("about a"),
								page_age: "May 1, 2025"
							}
						]
					},
					{ type: "text", text: "Found it." }
				]
			},
			{ role: "user", content: "more" }
		];
		await api.send({ ...ask, messages });
		const sent = transport.bodies()[0].messages;
		expect(sent.find((message) => message.role === "tool").content).toBe("1. A (May 1, 2025)\nhttps://a.test/x\nabout a");
	});

	it("history renders with the plan's executors, and without one falls back to JSON", () => {
		const executor = webSearch({ provider: provider() });
		const plan = { tools: new Map([["web_search", { tool, executor }]]) };
		const messages = [
			{
				role: "assistant",
				content: [
					{ type: "server_tool_use", id: "s1", name: "web_search", input: {} },
					{
						type: "web_search_tool_result",
						tool_use_id: "s1",
						content: { type: "web_search_tool_result_error", error_code: "unavailable" }
					},
					{ type: "web_search_tool_result", tool_use_id: "unknown", content: [] }
				]
			}
		];
		const withPlan = history(messages, plan);
		expect(withPlan[1].content[0]).toMatchObject({
			content: '{"type":"web_search_tool_result_error","error_code":"unavailable"}',
			is_error: true
		});
		expect(withPlan[1].content[1].content).toBe("[]");
		expect(history(messages)[1].content[1].content).toBe("[]");
	});

	it("validates an executor's read", () => {
		expect(() => normalize([{ type: "x", schema: () => ({}), run: async () => ({}), read: "no" }])).toThrow(/read must be a function/);
		expect(normalize([{ type: "x", schema: () => ({}), run: async () => ({}), read: () => "" }]).executors).toHaveLength(1);
	});
});

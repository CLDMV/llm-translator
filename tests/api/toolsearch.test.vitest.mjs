/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/toolsearch.test.vitest.mjs
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
 * @fileoverview The `tool_search_tool_*` server tools: the executor's regex and BM25 search, and the runner withholding deferred tools until a
 * search (or a `tool_reference` in the history) names them.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { openaiSse } from "../helpers/streams.mjs";
import { TranslatorError } from "../../src/lib/errors.mjs";
import { toolSearch } from "../../src/lib/toolsearchtool.mjs";
import { toolSearch as exported } from "../../src/index.mjs";
import { normalize } from "../../src/lib/servertools.mjs";

afterEach(async () => {
	await closeAll();
});

const chat = { url: "http://vllm.test", backend: "vllm", api: "chat", models: ["qwen3-coder"] };
const regexTool = { type: "tool_search_tool_regex_20251119", name: "tool_search_tool_regex" };
const bm25Tool = { type: "tool_search_tool_bm25_20251119", name: "tool_search_tool_bm25" };
const custom = (name, description, properties = {}, extra = {}) => ({
	name,
	description,
	input_schema: { type: "object", properties },
	defer_loading: true,
	...extra
});
const weather = custom("get_weather", "Get the weather at a location", { location: { type: "string", description: "City to look up" } });
const files = custom("search_files", "Search through files in the workspace", { query: { type: "string" } });
const mail = custom("send_email", "Send an email message", { to: { type: "string", description: "Recipient address" } });
const clock = { name: "get_time", description: "The current time", input_schema: { type: "object", properties: {} } };
const catalog = [regexTool, weather, files, mail, clock];

const run = (executor, tool, input, tools = catalog) => executor.run(input, { tool, context: { tools } });
const names = (out) => out.content.tool_references.map((reference) => reference.tool_name);
const failing = async (promise) =>
	promise.then(
		() => null,
		(error) => error
	);

describe("toolSearch executor", () => {
	it("serves both variants with a pattern or a query schema", () => {
		const executor = toolSearch();
		expect(executor.type.test("tool_search_tool_regex_20251119")).toBe(true);
		expect(executor.type.test("tool_search_tool_bm25_20251119")).toBe(true);
		expect(executor.type.test("web_search_20250305")).toBe(false);
		expect(executor.deferred).toBe(true);
		expect(executor.result).toBe("tool_search_tool_result");
		expect(executor.schema(regexTool)).toMatchObject({
			required: ["pattern"],
			properties: { pattern: { type: "string" }, limit: { type: "integer" } }
		});
		expect(executor.schema(bm25Tool)).toMatchObject({
			required: ["query"],
			properties: { query: { type: "string" }, limit: { type: "integer" } }
		});
		expect(executor.description(regexTool)).toMatch(/regular expression/);
		expect(executor.description(bm25Tool)).toMatch(/natural language/);
	});

	it("rejects an unusable configuration", () => {
		expect(() => toolSearch({ count: 0 })).toThrow(TranslatorError);
		expect(() => toolSearch({ count: 1.5 })).toThrow(/count/);
		expect(toolSearch({ type: "tool_search_tool_regex_20251119" }).type).toBe("tool_search_tool_regex_20251119");
		expect(exported).toBe(toolSearch);
	});

	it("matches a regex case-insensitively over names, descriptions, argument names and argument descriptions", async () => {
		const executor = toolSearch();
		expect((await run(executor, regexTool, { pattern: "WEATHER" })).content).toEqual({
			type: "tool_search_tool_search_result",
			tool_references: [{ type: "tool_reference", tool_name: "get_weather" }]
		});
		expect(names(await run(executor, regexTool, { pattern: "^search_.*s$" }))).toEqual(["search_files"]);
		expect(names(await run(executor, regexTool, { pattern: "workspace" }))).toEqual(["search_files"]);
		expect(names(await run(executor, regexTool, { pattern: "^to$" }))).toEqual(["send_email"]);
		expect(names(await run(executor, regexTool, { pattern: "recipient" }))).toEqual(["send_email"]);
		expect(names(await run(executor, regexTool, { pattern: "city" }))).toEqual(["get_weather"]);
	});

	it("covers only deferred custom tools and answers a miss with an empty result", async () => {
		const executor = toolSearch();
		expect(names(await run(executor, regexTool, { pattern: "get_" }))).toEqual(["get_weather"]);
		expect(names(await run(executor, regexTool, { pattern: "nothing like this" }))).toEqual([]);
		const typed = [
			{ ...regexTool, defer_loading: true },
			{ type: "custom", ...mail },
			{ ...weather, name: undefined }
		];
		expect(names(await run(executor, regexTool, { pattern: ".*" }, typed))).toEqual(["send_email"]);
	});

	it("searches tools that have no description, schema or argument description", async () => {
		const sparse = [{ name: "bare_tool", defer_loading: true }, custom("odd_tool", undefined, { plain: null, other: {} })];
		expect(names(await run(toolSearch(), regexTool, { pattern: "plain" }, sparse))).toEqual(["odd_tool"]);
		expect(names(await run(toolSearch(), bm25Tool, { query: "bare" }, sparse))).toEqual(["bare_tool"]);
	});

	it("honours limit and the default count", async () => {
		const many = Array.from({ length: 8 }, (_, n) => custom(`tool_${n}`, "a deferred tool"));
		expect(names(await run(toolSearch(), regexTool, { pattern: "tool" }, many))).toHaveLength(5);
		expect(names(await run(toolSearch({ count: 2 }), regexTool, { pattern: "tool" }, many))).toHaveLength(2);
		expect(names(await run(toolSearch(), regexTool, { pattern: "tool", limit: 7 }, many))).toHaveLength(7);
		expect(names(await run(toolSearch(), bm25Tool, { query: "deferred tool", limit: 1 }, many))).toEqual(["tool_0"]);
	});

	it("rejects a bad regex, a long pattern, a missing input and a bad limit with invalid_tool_input", async () => {
		const executor = toolSearch();
		for (const input of [
			{ pattern: "(" },
			{ pattern: "a".repeat(201) },
			{},
			{ pattern: "" },
			{ pattern: 3 },
			null,
			{ pattern: "x", limit: 0 },
			{ pattern: "x", limit: 10001 },
			{ pattern: "x", limit: 1.5 },
			{ pattern: "x", limit: "3" }
		]) {
			expect(await failing(run(executor, regexTool, input))).toMatchObject({ code: "invalid_tool_input" });
		}
		expect((await failing(run(executor, regexTool, { pattern: "(" }))).message).toMatch(/Invalid regular expression pattern/);
		expect(names(await run(executor, regexTool, { pattern: "a".repeat(200) }))).toEqual([]);
		for (const input of [{ query: "a".repeat(501) }, {}, { pattern: "x" }]) {
			expect(await failing(run(executor, bm25Tool, input))).toMatchObject({ code: "invalid_tool_input" });
		}
	});

	it("ranks with BM25 over names, descriptions and arguments, best first", async () => {
		const executor = toolSearch();
		expect(names(await run(executor, bm25Tool, { query: "what is the weather in a city" }))).toEqual(["get_weather"]);
		expect(names(await run(executor, bm25Tool, { query: "send a message to an address" }))).toEqual(["send_email"]);
		expect(names(await run(executor, bm25Tool, { query: "searchFiles workspace" }))).toEqual(["search_files"]);
		const tools = [custom("alpha", "report builder"), custom("beta", "report report report"), custom("gamma", "unrelated")];
		expect(names(await run(executor, bm25Tool, { query: "report" }, tools))).toEqual(["beta", "alpha"]);
		expect(names(await run(executor, bm25Tool, { query: "zebra" }, tools))).toEqual([]);
		expect(names(await run(executor, bm25Tool, { query: "!!!" }, tools))).toEqual([]);
		expect(names(await run(executor, bm25Tool, { query: "report" }, []))).toEqual([]);
	});

	it("reads a result back as text", () => {
		const executor = toolSearch();
		expect(executor.read({ tool_references: [{ tool_name: "a" }, { tool_name: "b" }] })).toBe("Loaded tools, now available to call: a, b");
		expect(executor.read({ tool_references: [] })).toBe("No matching tools found.");
		expect(executor.read({})).toBe("No matching tools found.");
	});

	it("validates the deferred flag of an executor", () => {
		const base = { type: "x", schema: () => ({}), run: async () => ({}) };
		expect(() => normalize([{ ...base, deferred: "yes" }])).toThrow(/deferred must be a boolean/);
		expect(normalize([{ ...base, deferred: true }]).executors).toHaveLength(1);
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
	const offered = (body) => (body.tools ?? []).map((tool) => tool.function.name);
	const ask = { model: "qwen3-coder", max_tokens: 64, messages: [{ role: "user", content: "what is the weather?" }], tools: catalog };
	const serverTools = [toolSearch()];

	it("withholds deferred tools, runs the regex search and offers the found tools in the next round", async () => {
		const transport = script([json(calling([["c1", "tool_search_tool_regex", { pattern: "weather" }]])), json(saying("found it"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools });
		const reply = await api.send(ask);
		const bodies = transport.bodies();
		expect(offered(bodies[0])).toEqual(["tool_search_tool_regex", "get_time"]);
		expect(offered(bodies[1])).toEqual(["tool_search_tool_regex", "get_weather", "get_time"]);
		expect(JSON.stringify(bodies[1])).not.toMatch(/defer_loading/);
		expect(bodies[1].messages.at(-1).content).toBe("Loaded tools, now available to call: get_weather");
		expect(reply.body.content.map((block) => block.type)).toEqual(["server_tool_use", "tool_search_tool_result", "text"]);
		expect(reply.body.content[0]).toMatchObject({ name: "tool_search_tool_regex", input: { pattern: "weather" } });
		expect(reply.body.content[1].content).toEqual({
			type: "tool_search_tool_search_result",
			tool_references: [{ type: "tool_reference", tool_name: "get_weather" }]
		});
		expect(reply.body.usage.server_tool_use).toBeUndefined();
	});

	it("runs the BM25 search with a query", async () => {
		const transport = script([json(calling([["c1", "tool_search_tool_bm25", { query: "send a message" }]])), json(saying("ok"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools });
		const reply = await api.send({ ...ask, tools: [bm25Tool, weather, mail, clock] });
		const bodies = transport.bodies();
		expect(offered(bodies[0])).toEqual(["tool_search_tool_bm25", "get_time"]);
		expect(offered(bodies[1])).toEqual(["tool_search_tool_bm25", "send_email", "get_time"]);
		expect(reply.body.content[1].content.tool_references).toEqual([{ type: "tool_reference", tool_name: "send_email" }]);
	});

	it("keeps tools hidden when the search finds nothing and answers errors with the result error", async () => {
		const transport = script([
			json(calling([["c1", "tool_search_tool_regex", { pattern: "nothing" }]])),
			json(calling([["c2", "tool_search_tool_regex", { pattern: "(" }]])),
			json(saying("giving up"))
		]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools });
		const reply = await api.send(ask);
		const bodies = transport.bodies();
		expect(bodies.map(offered)).toEqual(Array(3).fill(["tool_search_tool_regex", "get_time"]));
		expect(bodies[1].messages.at(-1).content).toBe("No matching tools found.");
		expect(reply.body.content.map((block) => block.type)).toEqual([
			"server_tool_use",
			"tool_search_tool_result",
			"server_tool_use",
			"tool_search_tool_result",
			"text"
		]);
		expect(reply.body.content[3].content).toEqual({ type: "tool_search_tool_result_error", error_code: "invalid_tool_input" });
	});

	it("streams the call and the result blocks and loads the tools for the next round", async () => {
		const transport = script([
			sse(
				streamed(
					[
						{
							tool_calls: [
								{ index: 0, id: "c1", type: "function", function: { name: "tool_search_tool_regex", arguments: '{"pattern":"files"}' } }
							]
						}
					],
					"tool_calls",
					usage(10, 5)
				)
			),
			sse(streamed([{ content: "done" }], "stop", usage(20, 7)))
		]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools });
		const reply = await api.send({ ...ask, stream: true });
		const events = await collect(reply.stream);
		const starts = events.filter((event) => event.event === "content_block_start").map((event) => event.data.content_block);
		expect(starts.map((block) => block.type)).toEqual(["server_tool_use", "tool_search_tool_result", "text"]);
		expect(starts[1].content.tool_references).toEqual([{ type: "tool_reference", tool_name: "search_files" }]);
		expect(offered(transport.bodies()[0])).toEqual(["tool_search_tool_regex", "get_time"]);
		expect(offered(transport.bodies()[1])).toEqual(["tool_search_tool_regex", "search_files", "get_time"]);
	});

	it("restores the tools a search loaded earlier from the history, and those a client tool result referenced", async () => {
		const transport = script([json(saying("ok"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools });
		const messages = [
			{ role: "user", content: "mail it" },
			{
				role: "assistant",
				content: [
					{ type: "server_tool_use", id: "srvtoolu_1", name: "tool_search_tool_regex", input: { pattern: "email" } },
					{
						type: "tool_search_tool_result",
						tool_use_id: "srvtoolu_1",
						content: {
							type: "tool_search_tool_search_result",
							tool_references: [
								{ type: "tool_reference", tool_name: "send_email" },
								{ type: "other" },
								{ type: "tool_reference", tool_name: 5 }
							]
						}
					},
					{ type: "text", text: "Found it." },
					{ type: "tool_use", id: "toolu_1", name: "lookup", input: {} }
				]
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_1",
						content: [
							{ type: "text", text: "x" },
							{ type: "tool_reference", tool_name: "get_weather" }
						]
					},
					{ type: "tool_result", tool_use_id: "toolu_2", content: "plain" },
					{ type: "text", text: "go" }
				]
			},
			{ role: "assistant", content: "fine" },
			{ role: "user", content: "again" }
		];
		await api.send({ ...ask, messages, tools: [...catalog, { name: "lookup", input_schema: { type: "object" } }] });
		const body = transport.bodies()[0];
		expect(offered(body)).toEqual(["tool_search_tool_regex", "get_weather", "send_email", "get_time", "lookup"]);
		expect(body.messages.find((message) => message.role === "tool").content).toBe("Loaded tools, now available to call: send_email");
	});

	it("does not touch deferred tools when no tool search executor is configured", async () => {
		const search = { type: /^web_search_/, schema: () => ({ type: "object" }), run: async () => ({ content: [] }) };
		const transport = script([json(saying("ok"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [search] });
		await api.send({ ...ask, tools: [{ type: "web_search_20250305", name: "web_search" }, weather, clock] });
		expect(offered(transport.bodies()[0])).toEqual(["web_search", "get_weather", "get_time"]);
	});

	it("loads nothing for a result with no tool references", async () => {
		const odd = {
			type: /^tool_search_tool_/,
			deferred: true,
			schema: () => ({ type: "object" }),
			run: async (input) => ({ content: input.shape === "text" ? "text" : { tool_references: [{}, null] } })
		};
		const transport = script([
			json(calling([["c1", "tool_search_tool_regex", { shape: "text" }]])),
			json(calling([["c2", "tool_search_tool_regex", {}]])),
			json(saying("ok"))
		]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [odd] });
		await api.send(ask);
		expect(transport.bodies().map(offered)).toEqual(Array(3).fill(["tool_search_tool_regex", "get_time"]));
	});
});

/**
 * @fileoverview Anthropic server tools run by the translator: the executor interface, the round loop (non-streaming and streaming), the
 * limits, errors, history replay and the cases that must stay untouched.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { asyncOf, openaiSse } from "../helpers/streams.mjs";
import { plain } from "../../src/lib/http.mjs";
import { TranslatorError } from "../../src/lib/errors.mjs";
import { add, execute, history, normalize, rewrite, run, wants } from "../../src/lib/servertools.mjs";

afterEach(closeAll);

const chat = { url: "http://vllm.test", backend: "vllm", api: "chat", models: ["qwen3-coder"] };
const claude = { url: "https://api.anthropic.com", backend: "anthropic" };
const search = { type: "web_search_20250305", name: "web_search", max_uses: 5 };
const fetchTool = { type: "web_fetch_20250910", name: "web_fetch" };
const ask = { model: "qwen3-coder", max_tokens: 64, messages: [{ role: "user", content: "find it" }], tools: [search] };

/** An executor for the search tool that records its calls. */
function searcher(extra = {}) {
	const calls = [];
	const executor = {
		type: /^web_search_/,
		schema: () => ({ type: "object", properties: { query: { type: "string" } }, required: ["query"] }),
		description: "Search the web.",
		run: async (input, details) => {
			calls.push({ input, details });
			return { content: [{ type: "web_search_result", url: `https://x.test/${calls.length}`, title: input.query }] };
		},
		...extra
	};
	return { executor, calls };
}

const usage = (prompt, completion) => ({ prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion });

/** A non-streaming Chat Completions reply that calls tools. */
const calling = (calls, tokens = usage(10, 5), finish = "tool_calls") => ({
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
				tool_calls: calls.map(([id, name, args]) => ({
					id,
					type: "function",
					function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) }
				}))
			},
			finish_reason: finish
		}
	],
	usage: tokens
});
/** A non-streaming Chat Completions reply with text. */
const saying = (content, tokens = usage(20, 7)) => ({
	id: "chatcmpl-2",
	object: "chat.completion",
	created: 1,
	model: "qwen3-coder",
	choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
	usage: tokens
});

/** Streaming chunks of an answer: optional text, then tool calls, then usage. */
function chunks({ text, calls = [], tokens = usage(10, 5), extra = [] }) {
	const base = { id: "chatcmpl-s", object: "chat.completion.chunk", created: 1, model: "qwen3-coder" };
	const out = [{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] }];
	if (text !== undefined) out.push({ ...base, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
	calls.forEach(([id, name, args], index) => {
		const json = typeof args === "string" ? args : JSON.stringify(args);
		out.push({
			...base,
			choices: [
				{
					index: 0,
					delta: { tool_calls: [{ index, id, type: "function", function: { name, arguments: json.slice(0, 4) } }] },
					finish_reason: null
				}
			]
		});
		out.push({
			...base,
			choices: [{ index: 0, delta: { tool_calls: [{ index, function: { arguments: json.slice(4) } }] }, finish_reason: null }]
		});
	});
	out.push(...extra);
	out.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: calls.length > 0 ? "tool_calls" : "stop" }] });
	out.push({ ...base, choices: [], usage: tokens });
	out.push("[DONE]");
	return out;
}

const json = (body, status = 200) => ({ status, body });
const sseReply = (list) => ({
	status: 200,
	body: openaiSse(list),
	headers: { "content-type": "text/event-stream" }
});

/** A transport that answers with the scripted replies in order and records the bodies it was sent. */
function script(replies) {
	let turn = 0;
	const transport = fakeTransport(() => {
		const reply = replies[turn++];
		if (reply === undefined) throw new Error("the script ran out of replies");
		return reply;
	});
	transport.bodies = () => transport.calls.map((call) => JSON.parse(call.init.body));
	return transport;
}

const names = (events) => events.map((event) => event.event);
const blocks = (events) => events.filter((event) => event.event === "content_block_start").map((event) => event.data.content_block);

describe("the executor is offered to the model as a function tool", () => {
	it("sends the server tool as a function with the executor's schema and description", async () => {
		const { executor } = searcher();
		const transport = script([json(saying("done"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [executor] });
		const reply = await api.send(ask);
		expect(reply.status).toBe(200);
		const [sent] = transport.bodies();
		expect(sent.tools).toEqual([
			{
				type: "function",
				function: {
					name: "web_search",
					description: "Search the web.",
					parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] }
				}
			}
		]);
		expect(reply.body.content).toEqual([{ type: "text", text: "done" }]);
	});

	it("takes the description from a function and leaves it out when the executor has none", async () => {
		const withFunction = searcher({ description: (tool) => `Search, at most ${tool.max_uses} times.` }).executor;
		const without = searcher({ description: undefined }).executor;
		const transport = script([json(saying("a")), json(saying("b"))]);
		const first = await make({ upstreams: [chat], transport, detect: false, serverTools: [withFunction] });
		await first.send(ask);
		const second = await make({ upstreams: [chat], transport, detect: false, serverTools: [without] });
		await second.send(ask);
		const [one, two] = transport.bodies();
		expect(one.tools[0].function.description).toBe("Search, at most 5 times.");
		expect(two.tools[0].function).not.toHaveProperty("description");
	});

	it("keeps custom tools and server tools without an executor as they are", async () => {
		const { executor } = searcher();
		const transport = script([json(saying("x"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [executor] });
		const custom = { name: "lookup", description: "Look up.", input_schema: { type: "object", properties: {} } };
		const reply = await api.send({ ...ask, tools: [search, custom, fetchTool] });
		expect(reply.status).toBe(200);
		const [sent] = transport.bodies();
		expect(sent.tools.map((tool) => tool.function.name)).toEqual(["web_search", "lookup"]);
	});
});

describe("a round trip, not streaming", () => {
	it("runs the executor, answers with server_tool_use, the result block and the following text, and sums the usage", async () => {
		const { executor, calls } = searcher();
		const transport = script([
			json(calling([["call_1", "web_search", { query: "slothlet" }]], usage(10, 5))),
			json(saying("It is a module loader.", usage(30, 8)))
		]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [executor] });
		const reports = [];
		const reply = await api.send(ask, { onUsage: (report) => reports.push(report) });
		expect(reply.status).toBe(200);
		const [use, result, text] = reply.body.content;
		expect(use).toMatchObject({ type: "server_tool_use", name: "web_search", input: { query: "slothlet" } });
		expect(use.id).toMatch(/^srvtoolu_[0-9a-f]{24}$/);
		expect(result).toEqual({
			type: "web_search_tool_result",
			tool_use_id: use.id,
			content: [{ type: "web_search_result", url: "https://x.test/1", title: "slothlet" }]
		});
		expect(text).toEqual({ type: "text", text: "It is a module loader." });
		expect(reply.body.stop_reason).toBe("end_turn");
		expect(reply.body.usage).toMatchObject({ input_tokens: 40, output_tokens: 13, server_tool_use: { web_search_requests: 1 } });
		expect(calls).toHaveLength(1);
		expect(calls[0].input).toEqual({ query: "slothlet" });
		expect(calls[0].details).toMatchObject({ tool: search, id: use.id, context: { model: "qwen3-coder" } });
		// The second upstream call carries the call and its result.
		const second = transport.bodies()[1];
		const tail = second.messages.slice(-2);
		expect(tail[0]).toMatchObject({ role: "assistant", tool_calls: [{ id: "call_1", function: { name: "web_search" } }] });
		expect(tail[1]).toMatchObject({ role: "tool", tool_call_id: "call_1" });
		expect(JSON.parse(tail[1].content)).toEqual(result.content);
		expect(reports).toHaveLength(1);
		expect(reports[0]).toMatchObject({ input_tokens: 40, output_tokens: 13, complete: true, reason: "done" });
		expect(await reply.usage).toBe(reports[0]);
	});

	it("loops while the model keeps calling, over several tools and several calls in one round", async () => {
		const { executor, calls } = searcher();
		const fetcher = {
			type: "web_fetch_20250910",
			schema: () => ({ type: "object", properties: { url: { type: "string" } } }),
			run: async (input) => ({ type: "web_fetch_tool_result", content: { type: "web_fetch_result", url: input.url } })
		};
		const transport = script([
			json(
				calling([
					["c1", "web_search", { query: "a" }],
					["c2", "web_fetch", { url: "https://a.test" }]
				])
			),
			json(calling([["c3", "web_search", { query: "b" }]])),
			json(saying("fin"))
		]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [executor, fetcher] });
		const reply = await api.send({ ...ask, tools: [search, fetchTool] });
		expect(reply.body.content.map((block) => block.type)).toEqual([
			"server_tool_use",
			"web_search_tool_result",
			"server_tool_use",
			"web_fetch_tool_result",
			"server_tool_use",
			"web_search_tool_result",
			"text"
		]);
		expect(calls.map((call) => call.input.query)).toEqual(["a", "b"]);
		expect(reply.body.usage.server_tool_use).toEqual({ web_search_requests: 2, web_fetch_requests: 1 });
		expect(transport.calls).toHaveLength(3);
	});

	it("passes text and thinking the model wrote before the call on, in order", async () => {
		const { executor } = searcher();
		const first = calling([["c1", "web_search", { query: "a" }]]);
		first.choices[0].message.content = "Let me look.";
		first.choices[0].message.reasoning = "hm";
		const transport = script([json(first), json(saying("ok"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [executor] });
		const reply = await api.send(ask);
		expect(reply.body.content.map((block) => block.type)).toEqual([
			"thinking",
			"text",
			"server_tool_use",
			"web_search_tool_result",
			"text"
		]);
	});

	it("returns client tool calls of the same round after the server blocks, and the client's turn continues", async () => {
		const { executor } = searcher();
		const client = { name: "lookup", description: "Look up.", input_schema: { type: "object", properties: {} } };
		const transport = script([
			json(
				calling([
					["c1", "web_search", { query: "a" }],
					["c2", "lookup", { id: 1 }]
				])
			)
		]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [executor] });
		const reply = await api.send({ ...ask, tools: [search, client] });
		expect(reply.body.content.map((block) => block.type)).toEqual(["server_tool_use", "web_search_tool_result", "tool_use"]);
		expect(reply.body.stop_reason).toBe("tool_use");
		expect(transport.calls).toHaveLength(1);
	});
});

describe("limits and errors", () => {
	it("answers max_uses_exceeded past the tool's max_uses without running the executor or counting it", async () => {
		const { executor, calls } = searcher();
		const transport = script([
			json(calling([["c1", "web_search", { query: "a" }]])),
			json(calling([["c2", "web_search", { query: "b" }]])),
			json(saying("fin"))
		]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [executor] });
		const events = [];
		api.events.on("servertool", (event) => events.push(event));
		const reply = await api.send({ ...ask, tools: [{ ...search, max_uses: 1 }] });
		expect(calls).toHaveLength(1);
		expect(reply.body.content[3].content).toEqual({ type: "web_search_tool_result_error", error_code: "max_uses_exceeded" });
		expect(reply.body.usage.server_tool_use).toEqual({ web_search_requests: 1 });
		expect(events.map((event) => event.kind)).toEqual(["max_uses_exceeded"]);
		// The upstream sees the error as the function result and is flagged as such.
		expect(transport.bodies()[2].messages.at(-1).content).toBe(
			'[error] {"type":"web_search_tool_result_error","error_code":"max_uses_exceeded"}'
		);
	});

	it("turns a throwing executor into the tool's error result, with the error's code when it has a lowercase one", async () => {
		const failing = searcher({
			run: async (input) => {
				throw Object.assign(new Error("slow down"), { code: input.query === "a" ? "too_many_requests" : "ENOENT" });
			}
		}).executor;
		const transport = script([
			json(
				calling([
					["c1", "web_search", { query: "a" }],
					["c2", "web_search", { query: "b" }]
				])
			),
			json(saying("fin"))
		]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [failing] });
		const reply = await api.send(ask);
		expect(reply.status).toBe(200);
		expect(reply.body.content[1].content).toEqual({ type: "web_search_tool_result_error", error_code: "too_many_requests" });
		expect(reply.body.content[3].content).toEqual({ type: "web_search_tool_result_error", error_code: "unavailable" });
	});

	it("reports an executor that throws something that is not an error", async () => {
		const things = [undefined, "plain text"];
		const bad = searcher({
			run: async () => {
				throw things.shift();
			}
		}).executor;
		const transport = script([
			json(
				calling([
					["c1", "web_search", { query: "a" }],
					["c2", "web_search", { query: "b" }]
				])
			),
			json(saying("fin"))
		]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [bad] });
		const reply = await api.send(ask);
		expect(reply.body.content.filter((block) => block.type === "web_search_tool_result").map((block) => block.content.error_code)).toEqual([
			"unavailable",
			"unavailable"
		]);
	});

	it("uses web_fetch_tool_error for web_fetch and a custom result type when the executor names one", async () => {
		const down = async () => {
			throw new Error("down");
		};
		const fetcher = { type: /^web_fetch_/, schema: () => ({ type: "object" }), run: down };
		const custom = { type: /^code_execution_/, schema: () => ({ type: "object" }), run: down, result: "code_execution_tool_result" };
		const transport = script([
			json(
				calling([
					["c1", "web_fetch", {}],
					["c2", "code_execution", {}]
				])
			),
			json(saying("fin"))
		]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [fetcher, custom] });
		const reply = await api.send({ ...ask, tools: [fetchTool, { type: "code_execution_20250522", name: "code_execution" }] });
		expect(reply.body.content[1]).toMatchObject({
			type: "web_fetch_tool_result",
			content: { type: "web_fetch_tool_error", error_code: "unavailable" }
		});
		expect(reply.body.content[3]).toMatchObject({
			type: "code_execution_tool_result",
			content: { type: "code_execution_tool_result_error", error_code: "unavailable" }
		});
		// Kinds without a counter in Anthropic's usage are not counted; web_fetch is.
		expect(reply.body.usage.server_tool_use).toEqual({ web_fetch_requests: 1 });
	});

	it("treats an executor that returns nothing usable as unavailable", async () => {
		const empty = searcher({ run: async () => ({}) }).executor;
		const transport = script([json(calling([["c1", "web_search", { query: "a" }]])), json(saying("fin"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [empty] });
		const reply = await api.send(ask);
		expect(reply.body.content[1].content.error_code).toBe("unavailable");
	});

	it("answers invalid_tool_input without running the executor for arguments that are not a JSON object", async () => {
		const { executor, calls } = searcher();
		const transport = script([json(calling([["c1", "web_search", "not json"]])), json(saying("fin"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [executor] });
		const reply = await api.send(ask);
		expect(calls).toHaveLength(0);
		expect(reply.body.content[1].content.error_code).toBe("invalid_tool_input");
	});

	it("counts with the executor's own usage key", async () => {
		const own = searcher({ usage: "searches" }).executor;
		const transport = script([json(calling([["c1", "web_search", { query: "a" }]])), json(saying("fin"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [own] });
		const reply = await api.send(ask);
		expect(reply.body.usage.server_tool_use).toEqual({ searches: 1 });
	});

	it("ends the turn with pause_turn at the round cap, with the results run so far", async () => {
		const { executor, calls } = searcher();
		const transport = script([
			json(calling([["c1", "web_search", { query: "a" }]])),
			json(calling([["c2", "web_search", { query: "b" }]])),
			json(saying("never asked"))
		]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: { executors: [executor], maxRounds: 2 } });
		const events = [];
		api.events.on("servertool", (event) => events.push(event));
		const reply = await api.send(ask);
		expect(reply.body.stop_reason).toBe("pause_turn");
		expect(reply.body.content.map((block) => block.type)).toEqual([
			"server_tool_use",
			"web_search_tool_result",
			"server_tool_use",
			"web_search_tool_result"
		]);
		expect(calls).toHaveLength(2);
		expect(transport.calls).toHaveLength(2);
		expect(events.map((event) => event.kind)).toEqual(["pause_turn"]);
	});

	it("takes the round cap from the call options before the config, and the call's executors before the config's", async () => {
		const mine = searcher();
		const theirs = searcher();
		const transport = script([json(calling([["c1", "web_search", { query: "a" }]])), json(saying("never"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: { executors: [theirs.executor], maxRounds: 5 } });
		const reply = await api.send(ask, { serverTools: { executors: [mine.executor], maxRounds: 1 } });
		expect(reply.body.stop_reason).toBe("pause_turn");
		expect(mine.calls).toHaveLength(1);
		expect(theirs.calls).toHaveLength(0);
	});

	it("warns when the caller's onUsage throws, and still answers", async () => {
		const { executor } = searcher();
		const transport = script([json(saying("x"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [executor] });
		const warnings = [];
		api.events.on("usage", (event) => warnings.push(event.message));
		const reply = await api.send(ask, {
			onUsage: () => {
				throw new Error("meter down");
			}
		});
		await reply.usage;
		expect(reply.status).toBe(200);
		expect(warnings).toEqual(["onUsage threw: meter down"]);
	});

	it("returns an upstream failure of the first call, and of a later call, as the reply", async () => {
		const { executor } = searcher();
		const failing = script([json({ error: { message: "boom", type: "BadRequestError" } }, 400)]);
		const api = await make({ upstreams: [chat], transport: failing, detect: false, serverTools: [executor] });
		const first = await api.send(ask);
		expect(first.status).toBe(400);
		expect(first.body.type).toBe("error");
		const later = script([json(calling([["c1", "web_search", { query: "a" }]])), json({ error: { message: "boom" } }, 400)]);
		const second = await make({ upstreams: [chat], transport: later, detect: false, serverTools: [executor] });
		const reply = await second.send(ask);
		expect(reply.status).toBe(400);
		expect(await reply.usage).toMatchObject({ reason: "upstream_error", complete: false });
	});

	it("reports an aborted request once and rethrows", async () => {
		const { executor } = searcher();
		const controller = new AbortController();
		const transport = fakeTransport(async () => {
			controller.abort();
			throw new DOMException("aborted", "AbortError");
		});
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [executor] });
		const reports = [];
		await expect(api.send(ask, { signal: controller.signal, onUsage: (report) => reports.push(report) })).rejects.toThrow(/aborted/);
		expect(reports).toHaveLength(1);
		expect(reports[0].reason).toBe("aborted");
	});
});

describe("history replay", () => {
	it("sends server_tool_use and its result as a function call and a function result", async () => {
		const { executor } = searcher();
		const transport = script([json(saying("continuing"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [executor] });
		const messages = [
			{ role: "user", content: "find it" },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Searching." },
					{ type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "x" } },
					{
						type: "web_search_tool_result",
						tool_use_id: "srvtoolu_1",
						content: [{ type: "web_search_result", url: "https://x.test", title: "x" }]
					},
					{ type: "text", text: "Found it." }
				]
			},
			{ role: "user", content: "and then?" }
		];
		const reply = await api.send({ ...ask, messages });
		expect(reply.status).toBe(200);
		const sent = transport.bodies()[0].messages;
		expect(sent.map((message) => message.role)).toEqual(["user", "assistant", "tool", "assistant", "user"]);
		expect(sent[1]).toMatchObject({
			content: "Searching.",
			tool_calls: [{ id: "srvtoolu_1", function: { name: "web_search", arguments: '{"query":"x"}' } }]
		});
		expect(sent[2]).toMatchObject({ tool_call_id: "srvtoolu_1" });
		expect(sent[3].content).toBe("Found it.");
	});

	it("continues a paused turn: the appended assistant message ends with the results", async () => {
		const { executor } = searcher();
		const transport = script([json(saying("done"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [executor] });
		const messages = [
			{ role: "user", content: "find it" },
			{
				role: "assistant",
				content: [
					{ type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "x" } },
					{ type: "web_search_tool_result", tool_use_id: "srvtoolu_1", content: [] }
				]
			}
		];
		const reply = await api.send({ ...ask, messages });
		expect(reply.status).toBe(200);
		expect(transport.bodies()[0].messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"]);
	});

	it("converts every shape: strings, error results, unanswered calls, calls without input, user turns and string assistants", () => {
		const out = history([
			{ role: "user", content: "hi" },
			{ role: "assistant", content: "plain" },
			{
				role: "assistant",
				content: [
					{ type: "server_tool_use", id: "a", name: "web_search" },
					{
						type: "web_search_tool_result",
						tool_use_id: "a",
						content: { type: "web_search_tool_result_error", error_code: "unavailable" }
					},
					{ type: "web_fetch_tool_result", tool_use_id: "b", content: "page text" },
					{ type: "server_tool_use", id: "lost", name: "web_search", input: {} },
					{ type: "text", text: "after" }
				]
			},
			{ role: "assistant", content: [{ type: "server_tool_use", id: "only", name: "web_search", input: {} }] },
			{ role: "assistant", content: [{ type: "tool_result", tool_use_id: "z", content: "x" }] }
		]);
		expect(out).toEqual([
			{ role: "user", content: "hi" },
			{ role: "assistant", content: "plain" },
			{ role: "assistant", content: [{ type: "tool_use", id: "a", name: "web_search", input: {} }] },
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "a",
						content: '{"type":"web_search_tool_result_error","error_code":"unavailable"}',
						is_error: true
					},
					{ type: "tool_result", tool_use_id: "b", content: "page text" }
				]
			},
			{ role: "assistant", content: [{ type: "text", text: "after" }] },
			{ role: "assistant", content: [{ type: "tool_result", tool_use_id: "z", content: "x" }] }
		]);
	});
});

describe("streaming", () => {
	it("emits server_tool_use, the result block and the following text as content blocks in order, with one message start and end", async () => {
		const { executor } = searcher();
		const transport = script([
			sseReply(chunks({ text: "Looking.", calls: [["c1", "web_search", { query: "slothlet" }]], tokens: usage(10, 5) })),
			sseReply(chunks({ text: "A loader.", tokens: usage(30, 8) }))
		]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [executor] });
		const reports = [];
		const reply = await api.send({ ...ask, stream: true }, { onUsage: (report) => reports.push(report) });
		expect(reply.status).toBe(200);
		expect(reply.headers["content-type"]).toMatch(/^text\/event-stream/);
		const events = await collect(reply.stream);
		expect(names(events).filter((name) => name === "message_start")).toHaveLength(1);
		expect(names(events).filter((name) => name === "message_stop")).toHaveLength(1);
		expect(names(events).at(-1)).toBe("message_stop");
		expect(blocks(events).map((block) => block.type)).toEqual(["text", "server_tool_use", "web_search_tool_result", "text"]);
		const starts = events.filter((event) => event.event === "content_block_start").map((event) => event.data.index);
		expect(starts).toEqual([0, 1, 2, 3]);
		const use = blocks(events)[1];
		expect(use).toMatchObject({ name: "web_search", input: {} });
		const delta = events.find((event) => event.data.index === 1 && event.event === "content_block_delta");
		expect(delta.data.delta).toEqual({ type: "input_json_delta", partial_json: '{"query":"slothlet"}' });
		expect(blocks(events)[2]).toMatchObject({ tool_use_id: use.id });
		const stops = events.filter((event) => event.event === "content_block_stop").map((event) => event.data.index);
		expect(stops).toEqual([0, 1, 2, 3]);
		const end = events.find((event) => event.event === "message_delta").data;
		expect(end.delta.stop_reason).toBe("end_turn");
		expect(end.usage).toMatchObject({ input_tokens: 40, output_tokens: 13, server_tool_use: { web_search_requests: 1 } });
		expect(await reply.usage).toMatchObject({ input_tokens: 40, output_tokens: 13, complete: true });
		expect(reports).toHaveLength(1);
		expect(transport.bodies()[1].messages.at(-2)).toMatchObject({ role: "assistant", content: "Looking.", tool_calls: [{ id: "c1" }] });
	});

	it("records thinking, text and tool input over a second round, and forwards other events", async () => {
		const { executor, calls } = searcher();
		const reasoning = (text) => ({
			id: "chatcmpl-s",
			object: "chat.completion.chunk",
			created: 1,
			model: "qwen3-coder",
			choices: [{ index: 0, delta: { reasoning: text }, finish_reason: null }]
		});
		const transport = script([
			sseReply(chunks({ text: "t", calls: [["c1", "web_search", { query: "a" }]], extra: [reasoning("thinking")] })),
			sseReply(chunks({ calls: [["c2", "web_search", { query: "b" }]] })),
			sseReply(chunks({ text: "end" }))
		]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [executor] });
		const reply = await api.send({ ...ask, stream: true });
		const events = await collect(reply.stream);
		expect(calls.map((call) => call.input.query)).toEqual(["a", "b"]);
		expect(blocks(events).map((block) => block.type)).toEqual([
			"text",
			"thinking",
			"server_tool_use",
			"web_search_tool_result",
			"server_tool_use",
			"web_search_tool_result",
			"text"
		]);
		// The recorded first round went back to the upstream with its thinking and text.
		const replay = transport.bodies()[1].messages.at(-2);
		expect(replay).toMatchObject({ role: "assistant", content: "t" });
	});

	it("lets pings through and records thinking, signature and citation deltas", async () => {
		const { executor } = searcher();
		const plan = { tools: new Map([["web_search", { tool: search, executor }]]), maxRounds: 3 };
		const frame = (type, rest) => ({ event: type, data: { type, ...rest } });
		const rounds = [
			[
				frame("message_start", {
					message: { id: "m", type: "message", role: "assistant", model: "m", content: [], usage: { input_tokens: 1, output_tokens: 0 } }
				}),
				frame("ping", {}),
				frame("content_block_start", { index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }),
				frame("content_block_delta", { index: 0, delta: { type: "thinking_delta", thinking: "hm" } }),
				frame("content_block_delta", { index: 0, delta: { type: "signature_delta", signature: "sig" } }),
				frame("content_block_stop", { index: 0 }),
				frame("content_block_start", { index: 1, content_block: { type: "text", text: "" } }),
				frame("content_block_delta", { index: 1, delta: { type: "text_delta", text: "hi" } }),
				frame("content_block_delta", { index: 1, delta: { type: "citations_delta", citation: {} } }),
				frame("content_block_stop", { index: 1 }),
				frame("content_block_start", { index: 2, content_block: { type: "tool_use", id: "c1", name: "web_search", input: {} } }),
				frame("content_block_stop", { index: 2 }),
				frame("message_delta", { delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 2 } }),
				frame("message_stop", {})
			],
			[
				frame("message_start", {
					message: { id: "m2", type: "message", role: "assistant", model: "m", content: [], usage: { input_tokens: 5, output_tokens: 0 } }
				}),
				frame("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
				frame("content_block_delta", { index: 0, delta: { type: "text_delta", text: "end" } }),
				frame("content_block_stop", { index: 0 }),
				frame("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } }),
				frame("message_stop", {})
			]
		];
		const sent = [];
		const report = {
			input_tokens: 1,
			output_tokens: 1,
			cache_read_input_tokens: null,
			cache_creation_input_tokens: null,
			reported: true,
			complete: true,
			reason: "done",
			model: "m",
			upstream: "u",
			estimated: null
		};
		const send = async (body, options) => {
			sent.push(body);
			options.onUsage(report);
			return { status: 200, headers: {}, stream: asyncOf(rounds[sent.length - 1]) };
		};
		const reply = await run({ body: { ...ask, stream: true }, plan, options: {}, send, warn: () => {}, c: { config: {}, state: {} } });
		const events = await collect(reply.stream);
		expect(names(events).filter((name) => name === "ping")).toHaveLength(1);
		expect(blocks(events).map((block) => block.type)).toEqual(["thinking", "text", "server_tool_use", "web_search_tool_result", "text"]);
		const replay = sent[1].messages.at(-2);
		expect(replay.content[0]).toEqual({ type: "thinking", thinking: "hm", signature: "sig" });
		expect(replay.content[2]).toEqual({ type: "tool_use", id: "c1", name: "web_search", input: {} });
		expect(events.at(-2).data.usage).toMatchObject({ input_tokens: 6, output_tokens: 5 });
		expect((await reply.usage).output_tokens).toBe(2);
	});

	it("ends the stream with the error event when the upstream fails mid-stream, and with an error when a later round fails", async () => {
		const { executor } = searcher();
		const broken = script([sseReply(["{not json", "[DONE]"])]);
		const api = await make({ upstreams: [chat], transport: broken, detect: false, serverTools: [executor] });
		const events = await collect((await api.send({ ...ask, stream: true })).stream);
		expect(names(events).at(-1)).toBe("error");
		const later = script([sseReply(chunks({ calls: [["c1", "web_search", { query: "a" }]] })), json({ error: { message: "boom" } }, 400)]);
		const second = await make({ upstreams: [chat], transport: later, detect: false, serverTools: [executor] });
		const tail = await collect((await second.send({ ...ask, stream: true })).stream);
		expect(tail.at(-1)).toMatchObject({ event: "error", data: { type: "error" } });
		expect(blocks(tail).map((block) => block.type)).toEqual(["server_tool_use", "web_search_tool_result"]);
	});

	it("answers invalid_tool_input for streamed arguments that are valid JSON but not an object", async () => {
		const { executor, calls } = searcher();
		const transport = script([
			sseReply(
				chunks({
					calls: [
						["c1", "web_search", "[1, 2]"],
						["c2", "web_search", "null"]
					]
				})
			),
			sseReply(chunks({ text: "fin" }))
		]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [executor] });
		const events = await collect((await api.send({ ...ask, stream: true })).stream);
		expect(calls).toHaveLength(0);
		const results = blocks(events).filter((block) => block.type === "web_search_tool_result");
		expect(results.map((block) => block.content.error_code)).toEqual(["invalid_tool_input", "invalid_tool_input"]);
	});

	it("ends with pause_turn at the cap and with tool_use when the model also called a client tool", async () => {
		const { executor } = searcher();
		const client = { name: "lookup", description: "Look up.", input_schema: { type: "object", properties: {} } };
		const paused = script([sseReply(chunks({ calls: [["c1", "web_search", { query: "a" }]] }))]);
		const api = await make({ upstreams: [chat], transport: paused, detect: false, serverTools: { executors: [executor], maxRounds: 1 } });
		const events = await collect((await api.send({ ...ask, stream: true })).stream);
		expect(events.find((event) => event.event === "message_delta").data.delta.stop_reason).toBe("pause_turn");
		const mixed = script([
			sseReply(
				chunks({
					calls: [
						["c1", "web_search", { query: "a" }],
						["c2", "lookup", { id: 1 }]
					]
				})
			)
		]);
		const other = await make({ upstreams: [chat], transport: mixed, detect: false, serverTools: [executor] });
		const tail = await collect((await other.send({ ...ask, stream: true, tools: [search, client] })).stream);
		expect(blocks(tail).map((block) => block.type)).toEqual(["tool_use", "server_tool_use", "web_search_tool_result"]);
		expect(tail.find((event) => event.event === "message_delta").data.delta.stop_reason).toBe("tool_use");
	});

	it("passes a request with no server tool call through unchanged, usage included", async () => {
		const { executor } = searcher();
		const transport = script([sseReply(chunks({ text: "plain", tokens: usage(9, 3) }))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [executor] });
		const reply = await api.send({ ...ask, stream: true });
		const events = await collect(reply.stream);
		expect(blocks(events)).toEqual([{ type: "text", text: "" }]);
		expect(events.find((event) => event.event === "message_delta").data.usage).not.toHaveProperty("server_tool_use");
		expect((await reply.usage).input_tokens).toBe(9);
	});

	it("settles the usage when the client closes the stream early", async () => {
		const { executor } = searcher();
		const transport = script([sseReply(chunks({ text: "a long answer", tokens: usage(9, 3) }))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [executor] });
		const reports = [];
		const reply = await api.send({ ...ask, stream: true }, { onUsage: (report) => reports.push(report) });
		for await (const event of reply.stream) {
			if (event.event === "message_start") break;
		}
		const report = await reply.usage;
		expect(report.complete).toBe(false);
		expect(reports).toHaveLength(1);
	});

	it("returns the upstream's error reply for a streaming request the upstream refused", async () => {
		const { executor } = searcher();
		const transport = script([json({ error: { message: "no" } }, 400)]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [executor] });
		const reply = await api.send({ ...ask, stream: true });
		expect(reply.status).toBe(400);
		expect(reply.stream).toBeUndefined();
	});
});

describe("what stays as it was", () => {
	it("drops server tools without an executor, and records them", async () => {
		const transport = script([json(saying("x"))]);
		const api = await make({ upstreams: [chat], transport, detect: false });
		const reply = await api.send(ask);
		expect(reply.status).toBe(200);
		expect(transport.bodies()[0]).not.toHaveProperty("tools");
		expect(reply.body.content).toEqual([{ type: "text", text: "x" }]);
	});

	it("drops a server tool that no executor matches even when another has one", async () => {
		const { executor } = searcher();
		const transport = script([json(saying("x"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [executor] });
		await api.send({ ...ask, tools: [fetchTool] });
		expect(transport.bodies()[0]).not.toHaveProperty("tools");
	});

	it("leaves a request to an Anthropic upstream untouched", async () => {
		const { executor, calls } = searcher();
		const transport = fakeTransport(() => ({
			body: {
				id: "m",
				type: "message",
				role: "assistant",
				model: "claude-sonnet-5",
				content: [{ type: "text", text: "x" }],
				stop_reason: "end_turn",
				usage: { input_tokens: 1, output_tokens: 1 }
			}
		}));
		const api = await make({ upstreams: [claude], transport, detect: false, serverTools: [executor] });
		const reply = await api.send({ ...ask, model: "claude-sonnet-5" });
		expect(reply.status).toBe(200);
		expect(calls).toHaveLength(0);
		expect(JSON.parse(transport.calls[0].init.body).tools).toEqual([search]);
	});
});

describe("the executor interface", () => {
	it("reads reply headers given as Headers or as a plain object", () => {
		expect(plain(new Headers({ "X-A": "1" }))).toEqual({ "x-a": "1" });
		expect(plain({ "X-B": 2 })).toEqual({ "x-b": "2" });
		expect(plain({})).toEqual({});
		expect(plain({ A: "x", B: "y" })).toEqual({ a: "x", b: "y" });
	});

	it("is validated in the config and in the call options", async () => {
		const good = searcher().executor;
		const bad = (value) => expect(() => normalize(value)).toThrow(TranslatorError);
		bad({ executors: "x" });
		bad([null]);
		bad([{ ...good, type: 3 }]);
		bad([{ ...good, type: "" }]);
		bad([{ ...good, schema: undefined }]);
		bad([{ ...good, run: undefined }]);
		bad({ executors: [good], maxRounds: 0 });
		bad({ executors: [good], maxRounds: 1.5 });
		expect(normalize(undefined)).toEqual({ executors: [], maxRounds: undefined });
		expect(normalize(null).executors).toEqual([]);
		expect(normalize({ maxRounds: 3 })).toEqual({ executors: [], maxRounds: 3 });
		expect(normalize([good]).executors).toEqual([good]);
		await expect(make({ upstreams: [chat], detect: false, serverTools: [{}] })).rejects.toThrow(/serverTools/);
	});

	it("matches a type by RegExp or by exact string", async () => {
		const exact = searcher({ type: "web_search_20250305" });
		const other = searcher({ type: "web_search_20990101" });
		const transport = script([json(calling([["c1", "web_search", { query: "a" }]])), json(saying("fin"))]);
		const api = await make({ upstreams: [chat], transport, detect: false, serverTools: [other.executor, exact.executor] });
		await api.send(ask);
		expect(exact.calls).toHaveLength(1);
		expect(other.calls).toHaveLength(0);
	});

	it("takes no part in a request without tools, with custom tools, with no executors, or on the OpenAI front", () => {
		const config = { serverTools: { executors: [searcher().executor], maxRounds: undefined } };
		const base = { messages: [], tools: [{ name: "x", input_schema: {} }] };
		expect(wants({ front: "openai", config }, base, {})).toBeNull();
		expect(wants({ front: "anthropic", config }, null, {})).toBeNull();
		expect(wants({ front: "anthropic", config }, [], {})).toBeNull();
		expect(wants({ front: "anthropic", config }, { messages: [] }, {})).toBeNull();
		expect(wants({ front: "anthropic", config }, { tools: [] }, {})).toBeNull();
		expect(wants({ front: "anthropic", config }, { ...base, tools: [{ type: "custom", name: "x" }, { name: "y" }] }, {})).toBeNull();
		expect(wants({ front: "anthropic", config: { serverTools: { executors: [] } } }, { ...base, tools: [search] }, {})).toBeNull();
	});

	it("rewrites tools and history without touching the original body", () => {
		const { executor } = searcher();
		const plan = { tools: new Map([["web_search", { tool: search, executor }]]) };
		const body = { tools: [search, { name: "keep", input_schema: {} }], messages: [{ role: "user", content: "x" }] };
		const out = rewrite(body, plan, [{ role: "assistant", content: "y" }]);
		expect(out.tools.map((tool) => tool.name)).toEqual(["web_search", "keep"]);
		expect(out.tools[0]).not.toHaveProperty("type");
		expect(out.messages).toHaveLength(2);
		expect(body.tools[0]).toBe(search);
	});

	it("adds usage objects field by field", () => {
		expect(add(undefined, 1)).toBe(1);
		expect(add(1, null)).toBe(1);
		expect(add({ a: 1, n: { b: 2 }, tier: "x" }, { a: 2, n: { b: 3 }, tier: "y", c: 1 })).toEqual({ a: 3, n: { b: 5 }, tier: "y", c: 1 });
		expect(add([1], [2])).toEqual([2]);
	});

	it("runs a call straight through execute", async () => {
		const { executor } = searcher();
		const plan = { tools: new Map([["web_search", { tool: search, executor }]]) };
		const state = { used: new Map(), counts: {}, signal: undefined, context: {}, announce: () => {} };
		const done = await execute({ id: "c", name: "web_search", input: { query: "q" } }, plan, state);
		expect(done.result.type).toBe("web_search_tool_result");
		expect(state.used.get("web_search")).toBe(1);
	});
});

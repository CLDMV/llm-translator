/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/hostedtools.test.vitest.mjs
 *	@Date: 2026-11-27T12:00:00-08:00 (1795809600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-27T12:00:00-08:00 (1795809600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The Responses API's hosted tools run by the translator: the request is converted to its Chat form, the runner serves `web_search`,
 * `code_interpreter` and `tool_search` with the `serverTools` executors, and the reply is converted back to Responses items and events. Upstreams are fakes.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { openaiSse } from "../helpers/streams.mjs";
import { webSearch } from "../../src/lib/websearch.mjs";
import { codeExecution } from "../../src/lib/codeexec.mjs";
import { toolSearch } from "../../src/lib/toolsearchtool.mjs";
import { strip } from "../../src/lib/hostedtools.mjs";

afterEach(closeAll);

const chat = { url: "http://vllm.test", backend: "vllm", api: "chat", models: ["qwen3-coder"] };
const usage = (prompt, completion) => ({ prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion });

/** A search provider that records its queries. */
function provider() {
	const queries = [];
	return {
		queries,
		name: "fake",
		async search(query) {
			queries.push(query);
			return [
				{ url: "https://a.test/1", title: "First", snippet: "alpha beta" },
				{ url: "https://b.test/2", title: "Second", snippet: "gamma" }
			];
		}
	};
}

/** A sandbox that records its jobs. */
function sandbox(run) {
	const jobs = [];
	return {
		jobs,
		async run(job) {
			jobs.push(job);
			return run ? run(job) : { stdout: "42\n", stderr: "", return_code: 0 };
		}
	};
}

/** A non-streaming Chat reply that calls tools. */
const calling = (calls, tokens = usage(10, 5), extra = {}) => ({
	id: "chatcmpl-1",
	object: "chat.completion",
	created: 1,
	model: "qwen3-coder",
	choices: [
		{
			index: 0,
			message: {
				role: "assistant",
				content: extra.content ?? null,
				tool_calls: calls.map(([id, name, args]) => ({
					id,
					type: "function",
					function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) }
				}))
			},
			finish_reason: "tool_calls"
		}
	],
	usage: tokens
});
/** A non-streaming Chat reply with text. */
const saying = (content, tokens = usage(20, 7)) => ({
	id: "chatcmpl-2",
	object: "chat.completion",
	created: 1,
	model: "qwen3-coder",
	choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
	usage: tokens
});

/** Streaming chunks of an answer: optional text, then tool calls, then usage. */
function chunks({ text, calls = [], tokens = usage(10, 5), finish = true }) {
	const base = { id: "chatcmpl-s", object: "chat.completion.chunk", created: 1, model: "qwen3-coder" };
	const out = [{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] }];
	if (text !== undefined) {
		for (const piece of text.match(/.{1,5}/gs))
			out.push({ ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] });
	}
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
	if (finish) out.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: calls.length > 0 ? "tool_calls" : "stop" }] });
	if (tokens !== null) out.push({ ...base, choices: [], usage: tokens });
	out.push("[DONE]");
	return out;
}

const json = (body, status = 200) => ({ status, body });
const sseReply = (list) => ({ status: 200, body: openaiSse(list), headers: { "content-type": "text/event-stream" } });

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

/**
 * Answer a Responses request through the translator the way the route does: convert it, send it, convert the reply.
 * @param {any} api - Translator api.
 * @param {any} body - Responses request body.
 * @param {any} [options] - `send` options.
 * @returns {Promise<{reply: any, response?: any, events?: any[], state: any}>} The send reply, and the converted response or events.
 */
async function respond(api, body, options = {}) {
	const { body: made, state } = await toChat(api).request(body);
	const reply = await api.send(made, { wire: "responses", ...options });
	if (reply.status >= 400) return { reply, state };
	if (reply.stream) return { reply, state, events: await collect(fromChat(api).stream(reply.stream, state)) };
	return { reply, state, response: await fromChat(api).response(reply.body, state) };
}

const toChat = (api) => api.convert.openai.responses.to.openai.chat;
const fromChat = (api) => api.convert.openai.chat.to.openai.responses;
const ask = { model: "qwen3-coder", input: "find it" };
const names = (events) => events.map((event) => event.event);

describe("web_search", () => {
	it("serves web_search with the executor, returns a web_search_call and cited text, and sums the usage", async () => {
		const search = provider();
		const transport = script([
			json(calling([["c1", "web_search", { query: "slothlet" }]], usage(10, 5))),
			json(saying("A loader.[[cite:2]]", usage(30, 8)))
		]);
		const api = await make({
			front: "openai",
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: [webSearch({ provider: search })]
		});
		const reports = [];
		const { response, reply } = await respond(
			api,
			{ ...ask, tools: [{ type: "web_search" }] },
			{ onUsage: (report) => reports.push(report) }
		);
		expect(reply.status).toBe(200);
		expect(search.queries).toEqual(["slothlet"]);
		expect(response.status).toBe("completed");
		expect(response.output.map((item) => item.type)).toEqual(["web_search_call", "message"]);
		expect(response.output[0]).toMatchObject({
			status: "completed",
			action: {
				type: "search",
				query: "slothlet",
				sources: [
					{ type: "url", url: "https://a.test/1" },
					{ type: "url", url: "https://b.test/2" }
				]
			}
		});
		expect(response.output[0].id).toMatch(/^ws_[0-9a-f]{24}$/);
		const part = response.output[1].content[0];
		expect(part.text).toBe("A loader.");
		expect(part.annotations).toMatchObject([
			{ type: "url_citation", url: "https://b.test/2", title: "Second", start_index: 0, end_index: 9 }
		]);
		expect(response.usage).toMatchObject({ input_tokens: 40, output_tokens: 13, total_tokens: 53 });
		expect(await reply.usage).toMatchObject({ input_tokens: 40, output_tokens: 13, complete: true });
		expect(reports).toHaveLength(1);
		// The upstream saw a function tool with the executor's schema and no marker, then the call with its numbered result.
		const [first, second] = transport.bodies();
		expect(first.tools).toMatchObject([{ type: "function", function: { name: "web_search", parameters: { required: ["query"] } } }]);
		expect(JSON.stringify(first)).not.toContain("llmt_");
		expect(second.messages.at(-2)).toMatchObject({ role: "assistant", tool_calls: [{ id: "c1" }] });
		expect(second.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "c1" });
		expect(second.messages.at(-1).content).toContain("1. First");
	});

	it("maps the domain filter and the location, and the dated and preview type names", async () => {
		const seen = [];
		const executor = webSearch({
			provider: {
				search: async (query, options) => {
					seen.push(options);
					return [];
				}
			}
		});
		for (const type of ["web_search_preview", "web_search_2025_08_26"]) {
			const transport = script([json(calling([["c1", "web_search", { query: "q" }]])), json(saying("done"))]);
			const api = await make({ front: "openai", upstreams: [chat], transport, detect: false, serverTools: [executor] });
			await respond(api, {
				...ask,
				tools: [{ type, filters: { allowed_domains: ["a.test"] }, user_location: { type: "approximate", country: "US", city: "Austin" } }]
			});
		}
		expect(seen).toHaveLength(2);
		expect(seen[0]).toMatchObject({ allowedDomains: ["a.test"], userLocation: { type: "approximate", country: "US", city: "Austin" } });
	});

	it("streams the web_search_call events, then the message with its citation annotation", async () => {
		const search = provider();
		const transport = script([
			sseReply(chunks({ text: "Looking.", calls: [["c1", "web_search", { query: "slothlet" }]], tokens: usage(10, 5) })),
			sseReply(chunks({ text: "A loader.[[cite:1]] Fast.", tokens: usage(30, 8) }))
		]);
		const api = await make({
			front: "openai",
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: [webSearch({ provider: search })]
		});
		const { events, reply } = await respond(api, { ...ask, stream: true, tools: [{ type: "web_search" }] });
		expect(names(events)[0]).toBe("response.created");
		expect(names(events).at(-1)).toBe("response.completed");
		const added = events.filter((event) => event.event === "response.output_item.added").map((event) => event.data.item.type);
		expect(added).toEqual(["message", "web_search_call", "message"]);
		const order = names(events).filter((name) => name.startsWith("response.web_search_call."));
		expect(order).toEqual([
			"response.web_search_call.in_progress",
			"response.web_search_call.searching",
			"response.web_search_call.completed"
		]);
		const call = events.find((event) => event.event === "response.output_item.done" && event.data.item.type === "web_search_call").data;
		expect(call).toMatchObject({ output_index: 1, item: { status: "completed", action: { query: "slothlet" } } });
		const annotation = events.find((event) => event.event === "response.output_text.annotation.added").data;
		expect(annotation).toMatchObject({
			output_index: 2,
			annotation: { type: "url_citation", url: "https://a.test/1", start_index: 0, end_index: 9 }
		});
		const done = events.find((event) => event.event === "response.completed").data.response;
		expect(done.output.map((item) => item.type)).toEqual(["message", "web_search_call", "message"]);
		expect(done.output[2].content[0].text).toBe("A loader. Fast.");
		expect(done.usage).toMatchObject({ input_tokens: 40, output_tokens: 13 });
		expect(await reply.usage).toMatchObject({ input_tokens: 40, output_tokens: 13 });
		const sequence = events.map((event) => event.data.sequence_number);
		expect(sequence).toEqual(sequence.map((_, index) => index));
	});

	it("reports a failing search as a failed web_search_call and lets the model go on", async () => {
		const executor = webSearch({
			provider: {
				search: async () => {
					throw Object.assign(new Error("slow down"), { code: "too_many_requests" });
				}
			}
		});
		const transport = script([json(calling([["c1", "web_search", { query: "q" }]])), json(saying("could not search"))]);
		const api = await make({ front: "openai", upstreams: [chat], transport, detect: false, serverTools: [executor] });
		const { response } = await respond(api, { ...ask, tools: [{ type: "web_search" }] });
		expect(response.output[0]).toMatchObject({ type: "web_search_call", status: "failed", action: { query: "q", sources: [] } });
		expect(response.output[1].content[0].text).toBe("could not search");
		expect(transport.bodies()[1].messages.at(-1).content).toContain("too_many_requests");
	});

	it("cuts the turn off at maxRounds: the last round's calls run and the response is incomplete", async () => {
		const search = provider();
		const transport = script([
			json(calling([["c1", "web_search", { query: "a" }]])),
			json(calling([["c2", "web_search", { query: "b" }]]))
		]);
		const api = await make({
			front: "openai",
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: { executors: [webSearch({ provider: search })], maxRounds: 2 }
		});
		const { response } = await respond(api, { ...ask, tools: [{ type: "web_search" }] });
		expect(search.queries).toEqual(["a", "b"]);
		expect(response).toMatchObject({ status: "incomplete", incomplete_details: { reason: "max_tool_calls" } });
		expect(response.output.map((item) => item.type)).toEqual(["web_search_call", "web_search_call"]);
		expect(transport.calls).toHaveLength(2);
	});

	it("cuts a stream off at maxRounds with response.incomplete", async () => {
		const transport = script([sseReply(chunks({ calls: [["c1", "web_search", { query: "a" }]] }))]);
		const api = await make({
			front: "openai",
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: { executors: [webSearch({ provider: provider() })], maxRounds: 1 }
		});
		const { events } = await respond(api, { ...ask, stream: true, tools: [{ type: "web_search" }] });
		const end = events.at(-1);
		expect(end.event).toBe("response.incomplete");
		expect(end.data.response).toMatchObject({ status: "incomplete", incomplete_details: { reason: "max_tool_calls" } });
		expect(end.data.response.output.map((item) => item.type)).toEqual(["web_search_call"]);
	});

	it("ends the turn when a round calls a client function next to the hosted tool", async () => {
		const transport = script([
			json(
				calling([
					["c1", "web_search", { query: "a" }],
					["c2", "weather", { city: "x" }]
				])
			)
		]);
		const api = await make({
			front: "openai",
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: [webSearch({ provider: provider() })]
		});
		const { response } = await respond(api, {
			...ask,
			tools: [{ type: "web_search" }, { type: "function", name: "weather", parameters: { type: "object" } }]
		});
		expect(response.status).toBe("completed");
		expect(response.output.map((item) => item.type)).toEqual(["web_search_call", "function_call"]);
		expect(response.output[1]).toMatchObject({ call_id: "c2", name: "weather" });
		expect(transport.calls).toHaveLength(1);
	});

	it("streams a client function call that comes with a hosted one", async () => {
		const transport = script([
			sseReply(
				chunks({
					calls: [
						["c1", "web_search", { query: "a" }],
						["c2", "weather", { city: "x" }]
					]
				})
			)
		]);
		const api = await make({
			front: "openai",
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: [webSearch({ provider: provider() })]
		});
		const { events } = await respond(api, {
			...ask,
			stream: true,
			tools: [{ type: "web_search" }, { type: "function", name: "weather", parameters: { type: "object" } }]
		});
		const done = events.find((event) => event.event === "response.completed").data.response;
		expect(done.output.map((item) => item.type)).toEqual(["web_search_call", "function_call"]);
	});

	it("replays web_search_call items from the history as a call and a numbered result, and keeps numbering", async () => {
		const transport = script([
			json(calling([["c1", "web_search", { query: "next" }]])),
			json(saying("Third.[[cite:3]] Second.[[cite:2]]"))
		]);
		const api = await make({
			front: "openai",
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: [webSearch({ provider: provider() })]
		});
		const { response } = await respond(api, {
			model: "qwen3-coder",
			tools: [{ type: "web_search" }],
			input: [
				{ role: "user", content: "first" },
				{
					type: "web_search_call",
					id: "ws_old",
					status: "completed",
					action: {
						type: "search",
						query: "old",
						sources: [
							{ type: "url", url: "https://old.test/x" },
							{ type: "url", url: "https://old.test/y" }
						]
					}
				},
				{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Before." }] },
				{ role: "user", content: "again" }
			]
		});
		const [first, second] = transport.bodies();
		expect(first.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool", "assistant", "user"]);
		expect(first.messages[1].tool_calls).toMatchObject([{ id: "ws_old", function: { name: "web_search", arguments: '{"query":"old"}' } }]);
		expect(first.messages[2]).toMatchObject({ tool_call_id: "ws_old" });
		expect(first.messages[2].content).toContain("1. https://old.test/x");
		expect(first.messages[2].content).toContain("2. https://old.test/y");
		expect(JSON.stringify(first)).not.toContain("llmt_");
		// The new search continues at 3, so [[cite:3]] names its first result.
		expect(second.messages.at(-1).content).toContain("3. First");
		const annotations = response.output.at(-1).content[0].annotations;
		expect(annotations.map((entry) => entry.url)).toEqual(["https://a.test/1", "https://old.test/y"]);
	});

	it("renders replayed hosted calls when the request has no hosted tool: the executor reads them if there is one, else the content as text", async () => {
		const transport = script([json(saying("ok")), json(saying("ok"))]);
		const withExecutor = await make({
			front: "openai",
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: [webSearch({ provider: provider() })]
		});
		const input = [
			{ role: "user", content: "q" },
			{
				type: "web_search_call",
				id: "ws_1",
				status: "completed",
				action: { type: "search", query: "x", sources: [{ type: "url", url: "https://o.test" }] }
			},
			{ role: "user", content: "more" }
		];
		const { response } = await respond(withExecutor, { ...ask, input });
		expect(response.output[0].content[0].text).toBe("ok");
		expect(transport.bodies()[0].messages[2].content).toContain("1. https://o.test");
		const bare = await make({ front: "openai", upstreams: [chat], transport, detect: false });
		await respond(bare, { ...ask, input });
		expect(transport.bodies()[1].messages[2].content).toContain("https://o.test");
	});

	it("streams a replay-only request as it came", async () => {
		const transport = script([sseReply(chunks({ text: "fine" }))]);
		const api = await make({ front: "openai", upstreams: [chat], transport, detect: false });
		const { events } = await respond(api, {
			...ask,
			stream: true,
			input: [
				{ role: "user", content: "q" },
				{ type: "web_search_call", id: "ws_1", status: "failed", action: { type: "search", query: "x" } },
				{ role: "user", content: "more" }
			]
		});
		expect(events.at(-1).data.response.output[0].content[0].text).toBe("fine");
		expect(transport.bodies()[0].messages[2].content).toContain("error_code");
	});
});

describe("code_interpreter", () => {
	it("runs the code through the sandbox and returns a code_interpreter_call with its logs", async () => {
		const box = sandbox((job) => ({ stdout: "hello\n", stderr: "warn\n", return_code: 0, container: { id: "cntr_abc" }, job }));
		const transport = script([json(calling([["c1", "code_interpreter", { code: "print('hello')" }]])), json(saying("It printed hello."))]);
		const api = await make({
			front: "openai",
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: [codeExecution({ sandbox: box })]
		});
		const { response } = await respond(api, { ...ask, tools: [{ type: "code_interpreter", container: { type: "auto" } }] });
		expect(box.jobs).toMatchObject([{ kind: "python", code: "print('hello')" }]);
		expect(response.output[0]).toMatchObject({
			type: "code_interpreter_call",
			status: "completed",
			code: "print('hello')",
			container_id: "cntr_abc",
			outputs: [{ type: "logs", logs: "hello\n\nwarn\n" }]
		});
		expect(response.output[1].content[0].text).toBe("It printed hello.");
		expect(transport.bodies()[0].tools[0].function).toMatchObject({ name: "code_interpreter", parameters: { required: ["code"] } });
		expect(transport.bodies()[1].messages.at(-1).content).toContain("stdout:\nhello");
	});

	it("streams the code_interpreter_call events and fails the item when the sandbox fails", async () => {
		const box = sandbox(() => {
			throw Object.assign(new Error("gone"), { code: "container_expired" });
		});
		const transport = script([
			sseReply(chunks({ calls: [["c1", "code_interpreter", { code: "x" }]] })),
			sseReply(chunks({ text: "sorry" }))
		]);
		const api = await make({
			front: "openai",
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: [codeExecution({ sandbox: box })]
		});
		const { events } = await respond(api, { ...ask, stream: true, tools: [{ type: "code_interpreter" }] });
		const progress = names(events).filter((name) => name.startsWith("response.code_interpreter_call"));
		expect(progress).toEqual([
			"response.code_interpreter_call.in_progress",
			"response.code_interpreter_call_code.delta",
			"response.code_interpreter_call_code.done",
			"response.code_interpreter_call.interpreting",
			"response.code_interpreter_call.completed"
		]);
		const item = events.find((event) => event.event === "response.output_item.done" && event.data.item.type === "code_interpreter_call")
			.data.item;
		expect(item).toMatchObject({ status: "failed", code: "x", outputs: [] });
		expect(item.container_id).toMatch(/^cntr_/);
	});

	it("replays a code_interpreter_call from the history", async () => {
		const transport = script([json(saying("ok"))]);
		const api = await make({
			front: "openai",
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: [codeExecution({ sandbox: sandbox() })]
		});
		await respond(api, {
			...ask,
			input: [
				{ role: "user", content: "run" },
				{
					type: "code_interpreter_call",
					id: "ci_1",
					status: "completed",
					code: "1+1",
					container_id: "c",
					outputs: [{ type: "logs", logs: "2" }]
				},
				{ role: "user", content: "again" }
			]
		});
		const [body] = transport.bodies();
		expect(body.messages[1].tool_calls[0].function).toEqual({ name: "code_interpreter", arguments: '{"code":"1+1"}' });
		expect(body.messages[2].content).toContain("stdout:\n2");
	});
});

describe("tool_search", () => {
	const lookup = {
		type: "function",
		name: "lookup_order",
		description: "Find an order by id",
		parameters: { type: "object", properties: { id: { type: "string" } } },
		defer_loading: true
	};
	const refund = { type: "function", name: "refund", description: "Refund a payment", parameters: { type: "object" }, defer_loading: true };
	const plain = { type: "function", name: "weather", parameters: { type: "object" } };

	it("withholds the deferred functions until a search names them, and returns the tool_search items", async () => {
		const transport = script([json(calling([["c1", "tool_search", { query: "order lookup" }]])), json(saying("found it"))]);
		const api = await make({ front: "openai", upstreams: [chat], transport, detect: false, serverTools: [toolSearch()] });
		const { response } = await respond(api, { ...ask, tools: [{ type: "tool_search" }, plain, lookup, refund] });
		const [first, second] = transport.bodies();
		expect(first.tools.map((tool) => tool.function.name)).toEqual(["tool_search", "weather"]);
		expect(second.tools.map((tool) => tool.function.name)).toEqual(["tool_search", "weather", "lookup_order"]);
		expect(JSON.stringify(second)).not.toContain("defer_loading");
		expect(response.output.map((item) => item.type)).toEqual(["tool_search_call", "tool_search_output", "message"]);
		expect(response.output[0]).toMatchObject({ call_id: "c1", execution: "server", arguments: { query: "order lookup" } });
		expect(response.output[1]).toMatchObject({
			call_id: "c1",
			status: "completed",
			tools: [{ type: "function", name: "lookup_order", defer_loading: true }]
		});
	});

	it("offers deferred functions at once when the request has no tool_search tool", async () => {
		const transport = script([json(saying("hi"))]);
		const api = await make({ front: "openai", upstreams: [chat], transport, detect: false });
		await respond(api, { ...ask, tools: [lookup] });
		expect(transport.bodies()[0].tools).toMatchObject([{ function: { name: "lookup_order" } }]);
		expect(JSON.stringify(transport.bodies()[0])).not.toContain("defer_loading");
	});

	it("replays tool_search items: the loaded tools are offered and the result is read", async () => {
		const transport = script([json(saying("ok"))]);
		const api = await make({ front: "openai", upstreams: [chat], transport, detect: false, serverTools: [toolSearch()] });
		await respond(api, {
			...ask,
			tools: [{ type: "tool_search" }, lookup, refund],
			input: [
				{ role: "user", content: "find" },
				{
					type: "tool_search_call",
					id: "tsc_1",
					call_id: "call_1",
					execution: "server",
					status: "completed",
					arguments: { query: "order" }
				},
				{
					type: "tool_search_output",
					id: "tso_1",
					call_id: "call_1",
					execution: "server",
					status: "completed",
					tools: [{ type: "function", name: "lookup_order" }]
				},
				{ role: "user", content: "now use it" }
			]
		});
		const [body] = transport.bodies();
		expect(body.tools.map((tool) => tool.function.name)).toEqual(["tool_search", "lookup_order"]);
		expect(body.messages[1].tool_calls[0]).toMatchObject({ id: "call_1", function: { name: "tool_search" } });
		expect(body.messages[2]).toMatchObject({ role: "tool", tool_call_id: "call_1" });
		expect(body.messages[2].content).toContain("lookup_order");
	});
});

describe("tools with no executor", () => {
	it.each([
		["web_search", "web_search_*"],
		["code_interpreter", "code_execution_*"],
		["tool_search", "tool_search_tool_*"]
	])("refuses %s with an OpenAI-shaped unsupported_tool error that names the serverTools executor", async (type, executor) => {
		const transport = script([]);
		const api = await make({ front: "openai", upstreams: [chat], transport, detect: false });
		const { reply } = await respond(api, { ...ask, tools: [{ type: "function", name: "a", parameters: { type: "object" } }, { type }] });
		expect(reply.status).toBe(400);
		expect(reply.body.error).toMatchObject({ code: "unsupported_tool", param: "tools[1]" });
		expect(reply.body.error.message).toContain(executor);
		expect(reply.body.error.message).toContain("serverTools");
		expect(transport.calls).toHaveLength(0);
		expect(await reply.usage).toMatchObject({ reason: "error" });
	});

	it("serves an executor given as a send option", async () => {
		const transport = script([json(calling([["c1", "web_search", { query: "q" }]])), json(saying("done"))]);
		const api = await make({ front: "openai", upstreams: [chat], transport, detect: false });
		const { response } = await respond(
			api,
			{ ...ask, tools: [{ type: "web_search" }] },
			{ serverTools: [webSearch({ provider: provider() })] }
		);
		expect(response.output[0].type).toBe("web_search_call");
	});
});

describe("errors and cleanup", () => {
	it("returns the upstream's error reply when a later round fails", async () => {
		const transport = script([
			json(calling([["c1", "web_search", { query: "q" }]])),
			{ status: 500, body: { error: { message: "boom", type: "server_error" } } }
		]);
		const api = await make({
			front: "openai",
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: [webSearch({ provider: provider() })]
		});
		const { reply } = await respond(api, { ...ask, tools: [{ type: "web_search" }] });
		expect(reply.status).toBe(500);
		expect(reply.body.error.message).toBe("boom");
	});

	it("sends a stream error of a later round as an error chunk", async () => {
		const transport = script([
			sseReply(chunks({ calls: [["c1", "web_search", { query: "q" }]] })),
			{ status: 500, body: { error: { message: "boom", type: "server_error" } } }
		]);
		const api = await make({
			front: "openai",
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: [webSearch({ provider: provider() })]
		});
		const { events } = await respond(api, { ...ask, stream: true, tools: [{ type: "web_search" }] });
		expect(events.at(-1).event).toBe("response.failed");
		expect(events.at(-1).data.response.error.message).toBe("boom");
	});

	it("passes an upstream error of the first round through", async () => {
		const transport = script([{ status: 429, body: { error: { message: "slow", type: "rate_limit_error" } } }]);
		const api = await make({
			front: "openai",
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: [webSearch({ provider: provider() })]
		});
		const { reply } = await respond(api, { ...ask, tools: [{ type: "web_search" }] });
		expect(reply.status).toBe(429);
	});

	it("closes the round in flight when a stream is closed early", async () => {
		const transport = script([sseReply(chunks({ text: "Looking.", calls: [["c1", "web_search", { query: "q" }]] }))]);
		const api = await make({
			front: "openai",
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: [webSearch({ provider: provider() })]
		});
		const { body: made } = await toChat(api).request({ ...ask, stream: true, tools: [{ type: "web_search" }] });
		const reply = await api.send(made, { wire: "responses" });
		const iterator = reply.stream[Symbol.asyncIterator]();
		await iterator.next();
		await iterator.return();
		expect(await reply.usage).toMatchObject({ complete: false });
	});

	it("keeps reasoning of an earlier round and sends it with the next one", async () => {
		const reasoning = {
			id: "chatcmpl-s",
			object: "chat.completion.chunk",
			created: 1,
			model: "qwen3-coder",
			choices: [
				{
					index: 0,
					delta: { reasoning: "thinking", reasoning_details: [{ type: "reasoning.text", index: 0, text: "thinking" }] },
					finish_reason: null
				}
			]
		};
		const first = chunks({ text: "t", calls: [["c1", "web_search", { query: "a" }]] });
		first.splice(1, 0, reasoning);
		const transport = script([sseReply(first), sseReply(chunks({ text: "end" }))]);
		const api = await make({
			front: "openai",
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: [webSearch({ provider: provider() })]
		});
		await respond(api, { ...ask, stream: true, tools: [{ type: "web_search" }] });
		const replay = transport.bodies()[1].messages.at(-2);
		expect(replay).toMatchObject({ role: "assistant", content: "t", reasoning_details: [{ type: "reasoning.text", text: "thinking" }] });
	});

	it("strips the markers for a caller that does not run the tools", async () => {
		const api = await make({ front: "openai", upstreams: [chat], transport: script([]), detect: false });
		const { body } = await toChat(api).request({
			...ask,
			tools: [{ type: "web_search" }],
			input: [{ type: "web_search_call", id: "ws_1" }]
		});
		expect(JSON.stringify(body)).toContain("llmt_hosted");
		const plain = strip(body);
		expect(JSON.stringify(plain)).not.toContain("llmt_");
		expect(plain.tools[0].function.name).toBe("web_search");
		expect(strip({ messages: [] })).toEqual({ messages: [] });
		expect(strip(null)).toBeNull();
		const counted = await api.token.count(body);
		expect(counted.input_tokens).toBeGreaterThan(0);
	});
});

describe("calls the model gets wrong", () => {
	it("answers a call with arguments that are not a JSON object, or without its input, with a failed item", async () => {
		const executors = [webSearch({ provider: provider() }), codeExecution({ sandbox: sandbox() }), toolSearch()];
		const transport = script([
			json(
				calling([
					["c1", "web_search", "oops"],
					["c2", "code_interpreter", "[1]"],
					["c3", "tool_search", {}]
				])
			),
			json(saying("sorry"))
		]);
		const api = await make({ front: "openai", upstreams: [chat], transport, detect: false, serverTools: executors });
		const { response } = await respond(api, {
			...ask,
			tools: [{ type: "web_search" }, { type: "code_interpreter" }, { type: "tool_search" }]
		});
		const items = response.output;
		expect(items.map((item) => `${item.type}:${item.status}`)).toEqual([
			"web_search_call:failed",
			"code_interpreter_call:failed",
			"tool_search_call:failed",
			"tool_search_output:failed",
			"message:completed"
		]);
		expect(items[0].action).toMatchObject({ query: "", sources: [] });
		expect(items[1]).toMatchObject({ code: "", outputs: [] });
		expect(items[3].tools).toEqual([]);
		expect(transport.bodies()[1].messages.at(-3).content).toContain("invalid_tool_input");
	});

	it("treats a call that has no arguments at all as an empty input", async () => {
		const bare = calling([["c1", "web_search", {}]]);
		delete bare.choices[0].message.tool_calls[0].function.arguments;
		const transport = script([json(bare), json(saying("hm"))]);
		const api = await make({
			front: "openai",
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: [webSearch({ provider: provider() })]
		});
		const { response } = await respond(api, { ...ask, tools: [{ type: "web_search" }] });
		expect(response.output[0]).toMatchObject({ type: "web_search_call", status: "failed" });
	});

	it("handles a model that sends no finish reason, no usage or chunks without choices", async () => {
		const empty = { id: "chatcmpl-s", object: "chat.completion.chunk", created: 1, model: "qwen3-coder", choices: [] };
		const first = chunks({ calls: [["c1", "web_search", { query: "a" }]], tokens: null });
		first.splice(1, 0, empty);
		const transport = script([sseReply(first), sseReply(chunks({ text: "cut short", finish: false, tokens: null }))]);
		const api = await make({
			front: "openai",
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: [webSearch({ provider: provider() })]
		});
		const { events } = await respond(api, { ...ask, stream: true, tools: [{ type: "web_search" }] });
		expect(events.at(-1).event).toBe("response.failed");
		expect(events.at(-1).data.response.error.message).toContain("ended before completion");
	});

	it("reads usage that comes on the last chunk of a round, a call with no index and a call whose name comes first", async () => {
		const base = { id: "chatcmpl-s", object: "chat.completion.chunk", created: 1, model: "qwen3-coder" };
		const name = {
			...base,
			choices: [
				{ index: 0, delta: { tool_calls: [{ id: "c1", type: "function", function: { name: "web_search" } }] }, finish_reason: null }
			]
		};
		const args = {
			...base,
			choices: [{ index: 0, delta: { tool_calls: [{ function: { arguments: '{"query":"q"}' } }] }, finish_reason: null }]
		};
		const last = { ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: usage(3, 4) };
		const transport = script([
			sseReply([name, args, last, "[DONE]"]),
			sseReply([{ ...base, choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }], usage: usage(5, 6) }, "[DONE]"])
		]);
		const search = provider();
		const api = await make({
			front: "openai",
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: [webSearch({ provider: search })]
		});
		const { events, reply } = await respond(api, { ...ask, stream: true, tools: [{ type: "web_search" }] });
		expect(search.queries).toEqual(["q"]);
		expect(events.at(-1).data.response.usage).toMatchObject({ input_tokens: 8, output_tokens: 10 });
		expect(await reply.usage).toMatchObject({ input_tokens: 8, output_tokens: 10 });
	});

	it("passes an error chunk of the first round on as a failed response", async () => {
		const base = { id: "chatcmpl-s", object: "chat.completion.chunk", created: 1, model: "qwen3-coder" };
		const transport = script([
			sseReply([
				{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
				{ error: { message: "bad", type: "server_error" } }
			])
		]);
		const api = await make({
			front: "openai",
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: [webSearch({ provider: provider() })]
		});
		const { events } = await respond(api, { ...ask, stream: true, tools: [{ type: "web_search" }] });
		expect(events.at(-1).event).toBe("response.failed");
		expect(events.at(-1).data.response.error.message).toBe("bad");
	});
});

describe("citations in a stream", () => {
	/** Run a streamed search whose answer is the text, and return the final message item. */
	async function answer(text, sources = 2) {
		const search = {
			async search() {
				return [
					{ url: "https://a.test/1", title: "First", snippet: "alpha" },
					{ url: "https://b.test/2", title: "Second", snippet: "beta" }
				].slice(0, sources);
			}
		};
		const transport = script([sseReply(chunks({ calls: [["c1", "web_search", { query: "q" }]] })), sseReply(chunks({ text }))]);
		const api = await make({
			front: "openai",
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: [webSearch({ provider: search })]
		});
		const { events } = await respond(api, { ...ask, stream: true, tools: [{ type: "web_search" }] });
		return events.at(-1).data.response.output.at(-1).content[0];
	}

	it("gives adjacent markers the same span and drops a marker with nothing before it", async () => {
		const part = await answer("[[cite:1]]Start. Fact.[[cite:1]][[cite:2]] End");
		expect(part.text).toBe("Start. Fact. End");
		expect(part.annotations.map((entry) => [entry.url, entry.start_index, entry.end_index])).toEqual([
			["https://a.test/1", 0, 12],
			["https://b.test/2", 0, 12]
		]);
	});

	it("sends a tail that looked like a marker as text when the stream ends", async () => {
		const part = await answer("Fact.[[cite:1]] and [[cit");
		expect(part.text).toBe("Fact. and [[cit");
		expect(part.annotations).toHaveLength(1);
	});

	it("leaves a marker that names no source in the text", async () => {
		const part = await answer("Fact.[[cite:9]]", 1);
		expect(part.text).toBe("Fact.[[cite:9]]");
		expect(part.annotations).toEqual([]);
	});
});

describe("executors with members and unusual citations", () => {
	it("offers each member of an executor as its own function, without a description when it has none", async () => {
		const jobs = [];
		const executor = {
			type: /^code_execution_/,
			schema: () => ({ type: "object" }),
			members: () => [
				{ name: "bash_code_execution", schema: { type: "object", properties: { command: { type: "string" } } } },
				{ name: "text_editor_code_execution", schema: { type: "object" }, description: "Edit." }
			],
			run: async (input, details) => {
				jobs.push([details.name, input]);
				return { content: { type: "code_execution_result", stdout: "ok", stderr: "", return_code: 0, content: [] } };
			}
		};
		const transport = script([json(calling([["c1", "bash_code_execution", { command: "ls" }]])), json(saying("done"))]);
		const api = await make({ front: "openai", upstreams: [chat], transport, detect: false, serverTools: [executor] });
		const { response } = await respond(api, { ...ask, tools: [{ type: "code_interpreter" }] });
		const [first] = transport.bodies();
		expect(first.tools.map((tool) => tool.function.name)).toEqual(["bash_code_execution", "text_editor_code_execution"]);
		expect(first.tools[0].function.description).toBeUndefined();
		expect(first.tools[1].function.description).toBe("Edit.");
		expect(jobs).toEqual([["bash_code_execution", { command: "ls" }]]);
		expect(response.output[0]).toMatchObject({
			type: "code_interpreter_call",
			status: "completed",
			outputs: [{ type: "logs", logs: "ok" }]
		});
	});

	it("keeps the text of a marker whose citation the translator cannot read", async () => {
		const executor = {
			type: /^web_search_/,
			schema: () => ({ type: "object" }),
			run: async () => ({ content: [{ title: "x" }] }),
			cite: () => ({ type: "unknown_location" })
		};
		const transport = script([json(calling([["c1", "web_search", { query: "q" }]])), json(saying("Fact.[[cite:1]]"))]);
		const api = await make({ front: "openai", upstreams: [chat], transport, detect: false, serverTools: [executor] });
		const { response } = await respond(api, { ...ask, tools: [{ type: "web_search" }] });
		const part = response.output.at(-1).content[0];
		expect(part).toMatchObject({ text: "Fact.", annotations: [] });
	});

	it("answers a reply with no usage with null usage", async () => {
		const first = calling([["c1", "web_search", { query: "q" }]]);
		delete first.usage;
		const last = saying("hi");
		delete last.usage;
		const transport = script([json(first), json(last)]);
		const api = await make({
			front: "openai",
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: [webSearch({ provider: provider() })]
		});
		const { response } = await respond(api, { ...ask, tools: [{ type: "web_search" }] });
		expect(response.usage).toBeNull();
	});

	it("gives a loaded function that has no parameters an empty object schema in the tool_search output", async () => {
		const bare = { type: "function", name: "bare", description: "d", defer_loading: true };
		const transport = script([json(calling([["c1", "tool_search", { query: "bare" }]])), json(saying("ok"))]);
		const api = await make({ front: "openai", upstreams: [chat], transport, detect: false, serverTools: [toolSearch()] });
		const { response } = await respond(api, { ...ask, tools: [{ type: "tool_search" }, bare, { type: "function", name: "plain" }] });
		expect(response.output[1].tools).toEqual([
			{ type: "function", name: "bare", description: "d", parameters: { type: "object", properties: {} }, defer_loading: true }
		]);
	});
});

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/mcp-tool.test.vitest.mjs
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
 * @fileoverview The Responses `mcp` tool: the request converter's checks, the allowlist gate, listing and calling the tools of an in-process MCP server, the
 * approval round trip, the stream events, the history items and the credentials staying out of the response. The chat upstream is a mocked transport.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { openaiSse } from "../helpers/streams.mjs";
import { mockMcp } from "../helpers/mock-mcp.mjs";
import { mcpName } from "../../src/lib/responses-tools.mjs";

const servers = [];
afterEach(async () => {
	await closeAll();
	while (servers.length > 0) await servers.pop().close();
});
const serve = async (options) => {
	const server = await mockMcp(options);
	servers.push(server);
	return server;
};

const chat = { url: "http://vllm.test", backend: "vllm", api: "chat", models: ["qwen"] };
const toChat = (api) => api.convert.openai.responses.to.openai.chat;
const fromChat = (api) => api.convert.openai.chat.to.openai.responses;
const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
const calling = (calls) => ({
	id: "c",
	object: "chat.completion",
	created: 1,
	model: "qwen",
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
	usage
});
const saying = (content) => ({
	id: "c",
	object: "chat.completion",
	created: 1,
	model: "qwen",
	choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
	usage
});
const chunks = (calls) => {
	const base = { id: "s", object: "chat.completion.chunk", created: 1, model: "qwen" };
	return [
		{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: calls.length === 0 ? "streamed" : "" }, finish_reason: null }] },
		...calls.map(([id, name, args], index) => ({
			...base,
			choices: [
				{
					index: 0,
					delta: { tool_calls: [{ index, id, type: "function", function: { name, arguments: JSON.stringify(args) } }] },
					finish_reason: null
				}
			]
		})),
		{ ...base, choices: [{ index: 0, delta: {}, finish_reason: calls.length > 0 ? "tool_calls" : "stop" }] },
		{ ...base, choices: [], usage },
		"[DONE]"
	];
};
const sse = (list) => ({ status: 200, body: openaiSse(list), headers: { "content-type": "text/event-stream" } });
const json = (body) => ({ status: 200, body });

/** A translator whose upstream answers with the scripted replies, with MCP allowed for loopback. */
async function start(replies, mcp = { hosts: ["127.0.0.1"] }) {
	let turn = 0;
	const transport = fakeTransport(() => {
		const next = replies[turn++];
		if (next === undefined) throw new Error("the script ran out of replies");
		return next;
	});
	const api = await make({
		front: "openai",
		upstreams: [chat],
		transport,
		detect: false,
		...(mcp === null ? {} : { serverTools: { executors: [], mcp } })
	});
	return { api, transport };
}
const bodies = (transport) => transport.calls.map((call) => JSON.parse(call.init.body));
const run = async (api, body, options = {}) => {
	const { body: made, state } = toChat(api).request(body);
	const reply = await api.send(made, { wire: "responses", ...options });
	if (reply.status >= 400) return { reply };
	if (reply.stream) return { reply, events: await collect(fromChat(api).stream(reply.stream, state)) };
	return { reply, response: fromChat(api).response(reply.body, state) };
};
const docs = (server, extra = {}) => ({ type: "mcp", server_label: "docs", server_url: server.url, require_approval: "never", ...extra });
const ask = (server, extra = {}, tool = {}) => ({ model: "qwen", input: "find it", tools: [docs(server, tool)], ...extra });
const fn = mcpName("docs", "search");

describe("the request converter", () => {
	it("keeps a valid mcp tool, redacts its credentials from the echoed parameters and refuses a malformed one", async () => {
		const { api } = await start([]);
		const request = (tool) => toChat(api).request({ model: "qwen", input: "x", tools: [tool] });
		const tool = {
			type: "mcp",
			server_label: "a",
			server_url: "https://m.test/",
			authorization: "tok",
			headers: { "x-k": "v" },
			require_approval: { never: { tool_names: ["a"] } },
			allowed_tools: { tool_names: ["a"], read_only: true }
		};
		const { body, state } = request(tool);
		expect(body.tools[0].llmt_hosted).toEqual({ kind: "mcp", at: "tools[0]", tool });
		expect(JSON.stringify(state.echo)).not.toContain("SECRET-1");
		expect(state.echo.tools[0]).toEqual({
			type: "mcp",
			server_label: "a",
			server_url: "https://m.test/",
			require_approval: { never: { tool_names: ["a"] } },
			allowed_tools: { tool_names: ["a"], read_only: true }
		});
		const bad = (change, param) =>
			expect(() => request({ ...tool, ...change })).toThrowError(
				expect.objectContaining({ code: "invalid_request", param: `tools[0].${param}` })
			);
		bad({ server_label: "" }, "server_label");
		bad({ server_label: undefined }, "server_label");
		bad({ server_url: 5 }, "server_url");
		bad({ authorization: 5 }, "authorization");
		bad({ headers: "x" }, "headers");
		bad({ headers: null }, "headers");
		bad({ headers: { a: 1 } }, "headers");
		bad({ require_approval: "sometimes" }, "require_approval");
		bad({ require_approval: null }, "require_approval");
		bad({ require_approval: [] }, "require_approval");
		bad({ require_approval: { always: "x" } }, "require_approval");
		bad({ require_approval: { never: { tool_names: "x" } } }, "require_approval");
		bad({ allowed_tools: "x" }, "allowed_tools");
		bad({ allowed_tools: { tool_names: "x" } }, "allowed_tools");
		bad({ allowed_tools: null }, "allowed_tools");
		for (const fine of ["always", "never", { always: {}, never: { tool_names: [] } }])
			expect(() => request({ ...tool, require_approval: fine })).not.toThrow();
		for (const fine of [["a"], { read_only: true }, undefined]) expect(() => request({ ...tool, allowed_tools: fine })).not.toThrow();
	});

	it("refuses a connector, and keeps an mcp tool choice for the runner", async () => {
		const { api } = await start([]);
		expect(() =>
			toChat(api).request({ model: "qwen", input: "x", tools: [{ type: "mcp", server_label: "a", connector_id: "connector_gmail" }] })
		).toThrowError(expect.objectContaining({ code: "unsupported_tool", param: "tools[0]" }));
		const kept = toChat(api).request(
			{ model: "qwen", input: "x", tools: [{ type: "mcp", server_label: "a", connector_id: "connector_gmail" }] },
			{ hostedTools: "native" }
		);
		expect(kept.body.tools[0].llmt_hosted).toMatchObject({ kind: "mcp", native: true });
		const choice = toChat(api).request({
			model: "qwen",
			input: "x",
			tools: [docs({ url: "https://m.test/" })],
			tool_choice: { type: "mcp", server_label: "docs", name: "search" }
		});
		expect(choice.body.llmt_mcp_choice).toEqual({ server_label: "docs", name: "search" });
		expect(choice.body.tool_choice).toBeUndefined();
		expect(
			toChat(api).request({ model: "qwen", input: "x", tools: [docs({ url: "u" })], tool_choice: { type: "mcp", server_label: "docs" } })
				.body.llmt_mcp_choice
		).toEqual({
			server_label: "docs"
		});
	});

	it("turns every mcp input item into a marked message, even without native passthrough", async () => {
		const { api } = await start([]);
		const { body } = toChat(api).request({
			model: "qwen",
			input: [
				{ type: "mcp_list_tools", id: "l", server_label: "a", tools: [] },
				{ type: "mcp_call", id: "c", server_label: "a", name: "t", arguments: "{}" }
			]
		});
		expect(body.messages.map((message) => message.llmt_native.item.type)).toEqual(["mcp_list_tools", "mcp_call"]);
	});

	it("names the function an mcp tool is offered as, within 64 characters", () => {
		expect(mcpName("docs", "search")).toBe("mcp_docs_search");
		expect(mcpName("my docs", "a.b")).toBe("mcp_my_docs_a_b");
		const long = mcpName("x".repeat(40), "y".repeat(40));
		expect(long.length).toBeLessThanOrEqual(64);
		expect(long).toMatch(/^mcp_x+_y+_[0-9a-f]{8}$/);
		expect(mcpName("x".repeat(40), "z".repeat(40))).not.toBe(long);
	});
});

describe("the gate", () => {
	it("refuses the tool when serverTools.mcp is off, and an mcp item with it", async () => {
		const server = await serve();
		const { api, transport } = await start([], null);
		const { reply } = await run(api, ask(server));
		expect(reply.status).toBe(400);
		expect(reply.body.error).toMatchObject({ code: "unsupported_tool", param: "tools[0]" });
		expect(reply.body.error.message).toContain("serverTools.mcp");
		const item = await run(api, {
			model: "qwen",
			input: [{ type: "mcp_call", id: "c", server_label: "docs", name: "t", arguments: "{}" }]
		});
		expect(item.reply.body.error).toMatchObject({ code: "unsupported_content", param: "input[0]" });
		expect(transport.calls).toHaveLength(0);
		expect(server.requests).toHaveLength(0);
	});

	it("refuses a host that is not listed, and the same label twice", async () => {
		const server = await serve();
		const { api } = await start([], { hosts: ["mcp.example.com"] });
		const { reply } = await run(api, ask(server));
		expect(reply.body.error).toMatchObject({ code: "unsupported_tool", param: "tools[0].server_url" });
		expect(reply.body.error.message).toContain("not in the serverTools.mcp hosts list");
		const open = await start([], { hosts: ["127.0.0.1"] });
		const twice = await run(open.api, { model: "qwen", input: "x", tools: [docs(server), docs(server)] });
		expect(twice.reply.body.error).toMatchObject({ code: "invalid_request", param: "tools[1].server_label" });
		expect(server.requests).toHaveLength(0);
	});

	it("reads the allowlist from the send option too", async () => {
		const server = await serve();
		const { api } = await start([json(saying("hi"))], null);
		const { response } = await run(api, ask(server), { serverTools: { mcp: { hosts: ["127.0.0.1"] } } });
		expect(response.output.map((item) => item.type)).toEqual(["mcp_list_tools", "message"]);
	});
});

describe("listing and calling", () => {
	it("lists the tools first, offers them as functions, calls the one the model picks and returns the items", async () => {
		const server = await serve({ session: "s1" });
		const { api, transport } = await start([json(calling([["k1", fn, { q: "x" }]])), json(saying("found"))]);
		const { response, reply } = await run(
			api,
			ask(server, {}, { authorization: "secret-token", headers: { "x-team": "t" }, server_description: "docs" })
		);
		expect(response.output.map((item) => item.type)).toEqual(["mcp_list_tools", "mcp_call", "message"]);
		expect(response.output[0]).toMatchObject({
			server_label: "docs",
			tools: [{ name: "search", description: "Search the docs", annotations: { readOnlyHint: true } }, { name: "delete" }]
		});
		expect(response.output[0].id).toMatch(/^mcpl_/);
		expect(response.output[1]).toMatchObject({
			server_label: "docs",
			name: "search",
			arguments: '{"q":"x"}',
			output: 'called search {"q":"x"}',
			error: null,
			status: "completed"
		});
		expect(response.output[1].id).toMatch(/^mcp_/);
		expect(response.status).toBe("completed");
		const [first, second] = bodies(transport);
		expect(first.tools.map((tool) => tool.function.name)).toEqual([fn, mcpName("docs", "delete")]);
		expect(first.tools[0].function).toMatchObject({ description: "Search the docs", parameters: { required: ["q"] } });
		expect(second.messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "k1", content: 'called search {"q":"x"}' });
		expect(JSON.stringify(response)).not.toContain("secret-token");
		expect(JSON.stringify(response.tools)).not.toContain("secret-token");
		for (const request of server.requests.filter((entry) => entry.method === "POST")) {
			expect(request.headers.authorization).toBe("Bearer secret-token");
			expect(request.headers["x-team"]).toBe("t");
		}
		expect(server.requests.at(-1).method).toBe("DELETE");
		expect(await reply.usage).toMatchObject({ input_tokens: 20, output_tokens: 10 });
	});

	it("offers only the allowed tools, and only the read-only ones when asked", async () => {
		const server = await serve();
		const names = async (tool) => {
			const { api, transport } = await start([json(saying("x"))]);
			await run(api, ask(server, {}, tool));
			return (bodies(transport)[0].tools ?? []).map((entry) => entry.function.name);
		};
		expect(await names({ allowed_tools: ["delete"] })).toEqual([mcpName("docs", "delete")]);
		expect(await names({ allowed_tools: { tool_names: ["search", "delete"], read_only: true } })).toEqual([fn]);
		expect(await names({ allowed_tools: { read_only: true } })).toEqual([fn]);
		expect(await names({ allowed_tools: { read_only: false } })).toEqual([fn, mcpName("docs", "delete")]);
		expect(await names({ allowed_tools: ["nothing"] })).toEqual([]);
	});

	it("reuses an mcp_list_tools item of the history instead of listing again, and replays an earlier mcp_call", async () => {
		const server = await serve();
		const { api, transport } = await start([json(saying("ok"))]);
		const listed = {
			type: "mcp_list_tools",
			id: "l1",
			server_label: "docs",
			tools: [{ name: "search", description: "cached", input_schema: { type: "object" } }]
		};
		const { response } = await run(api, {
			...ask(server),
			input: [
				{ role: "user", content: "first" },
				listed,
				{
					type: "mcp_call",
					id: "mcp_old",
					server_label: "docs",
					name: "search",
					arguments: '{"q":"a"}',
					output: "old result",
					error: null
				},
				{ type: "mcp_call", id: "mcp_bad", server_label: "docs", name: "search", arguments: "{}", output: null, error: "it broke" },
				{ type: "mcp_call", id: "mcp_none", server_label: "docs", name: "search", arguments: 5, output: null, error: null },
				{ role: "user", content: "again" }
			]
		});
		expect(server.requests.filter((entry) => entry.body?.method === "tools/list")).toHaveLength(0);
		expect(response.output.map((item) => item.type)).toEqual(["message"]);
		const [body] = bodies(transport);
		expect(body.tools[0].function).toMatchObject({ name: fn, description: "cached" });
		expect(body.messages.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"tool",
			"assistant",
			"tool",
			"assistant",
			"tool",
			"user"
		]);
		expect(body.messages[2]).toMatchObject({ tool_call_id: "mcp_old", content: "old result" });
		expect(body.messages[4].content).toBe("error: it broke");
		expect(body.messages[5].tool_calls[0].function.arguments).toBe("{}");
		expect(body.messages[6].content).toBe("");
	});

	it("offers a tool the server listed without a description or a schema, and takes a cached list without tools", async () => {
		const server = await serve({ tools: [{ name: "bare" }] });
		const { api, transport } = await start([json(saying("x")), json(saying("y"))]);
		await run(api, ask(server));
		expect(bodies(transport)[0].tools[0].function).toEqual({
			name: mcpName("docs", "bare"),
			parameters: { type: "object", properties: {} }
		});
		await run(api, {
			...ask(server),
			input: [
				{ role: "user", content: "x" },
				{ type: "mcp_list_tools", id: "l", server_label: "docs" }
			]
		});
		expect(bodies(transport)[1].tools).toBeUndefined();
	});

	it("reports a server that cannot be listed and goes on without its tools", async () => {
		const server = await serve({ listStatus: 500 });
		const { api, transport } = await start([json(saying("no tools"))]);
		const { response } = await run(api, ask(server));
		expect(response.output[0]).toMatchObject({ type: "mcp_list_tools", tools: [], error: expect.stringContaining("HTTP 500") });
		expect(bodies(transport)[0].tools).toBeUndefined();
		const { api: other } = await start([json(saying("x"))]);
		const gone = await serve();
		const url = gone.url;
		await gone.close();
		servers.pop();
		const { response: failed } = await run(other, { ...ask({ url }) });
		expect(failed.output[0].error).toEqual(expect.any(String));
		expect(failed.output[0].error).not.toContain(url);
	});

	it("tells the model about a failing tool, a server error and arguments that are not an object", async () => {
		const server = await serve({ call: () => ({ content: [{ type: "text", text: "tool failed" }], isError: true }) });
		const { api, transport } = await start([json(calling([["k1", fn, { q: "x" }]])), json(saying("sorry"))]);
		const { response } = await run(api, ask(server));
		expect(response.output[1]).toMatchObject({ type: "mcp_call", output: null, error: "tool failed", status: "failed" });
		expect(bodies(transport)[1].messages.at(-1).content).toBe("error: tool failed");
		const rpc = await serve({ rpcError: "denied" });
		const second = await start([json(calling([["k1", fn, {}]])), json(saying("sorry"))]);
		const { response: failed } = await run(second.api, ask(rpc));
		expect(failed.output[1].error).toContain("denied");
		const third = await start([
			{
				status: 200,
				body: {
					...calling([["k1", fn, {}]]),
					choices: [
						{
							index: 0,
							message: {
								role: "assistant",
								content: null,
								tool_calls: [{ id: "k1", type: "function", function: { name: fn, arguments: "oops" } }]
							},
							finish_reason: "tool_calls"
						}
					]
				}
			},
			json(saying("sorry"))
		]);
		const { response: raw } = await run(third.api, ask(server));
		expect(raw.output[1]).toMatchObject({
			type: "mcp_call",
			arguments: '{"_raw_arguments":"oops"}',
			error: "the arguments were not a JSON object",
			status: "failed"
		});
	});

	it("streams the list and call events", async () => {
		const server = await serve();
		const { api } = await start([sse(chunks([["k1", fn, { q: "x" }]])), sse(chunks([]))]);
		const { events } = await run(api, ask(server, { stream: true }));
		const names = events.map((event) => event.event).filter((name) => name.includes("mcp") || name.includes("output_item"));
		expect(names).toEqual([
			"response.output_item.added",
			"response.mcp_list_tools.in_progress",
			"response.mcp_list_tools.completed",
			"response.output_item.done",
			"response.output_item.added",
			"response.mcp_call.in_progress",
			"response.mcp_call_arguments.delta",
			"response.mcp_call_arguments.done",
			"response.mcp_call.completed",
			"response.output_item.done",
			"response.output_item.added",
			"response.output_item.done"
		]);
		const added = events.filter((event) => event.event === "response.output_item.added").map((event) => event.data.item);
		expect(added[0]).toMatchObject({ type: "mcp_list_tools", tools: [] });
		expect(added[1]).toMatchObject({ type: "mcp_call", output: null, status: "in_progress" });
		expect(events.find((event) => event.event === "response.mcp_call_arguments.done").data.arguments).toBe('{"q":"x"}');
		expect(events.at(-1).data.response.output.map((item) => item.type)).toEqual(["mcp_list_tools", "mcp_call", "message"]);
	});

	it("streams a failed listing and a failed call", async () => {
		const broken = await serve({ listStatus: 500, call: () => ({ content: [], isError: true }) });
		const { api } = await start([sse(chunks([]))]);
		const { events } = await run(api, ask(broken, { stream: true }));
		expect(events.map((event) => event.event)).toContain("response.mcp_list_tools.failed");
		const server = await serve({ call: () => ({ content: [{ type: "text", text: "bad" }], isError: true }) });
		const second = await start([sse(chunks([["k1", fn, {}]])), sse(chunks([]))]);
		const { events: more } = await run(second.api, ask(server, { stream: true }));
		expect(more.map((event) => event.event)).toContain("response.mcp_call.failed");
	});

	it("forces a tool or any tool of the server with tool_choice", async () => {
		const server = await serve();
		const first = await start([json(saying("a"))]);
		await run(first.api, ask(server, { tool_choice: { type: "mcp", server_label: "docs", name: "delete" } }));
		expect(bodies(first.transport)[0].tool_choice).toEqual({ type: "function", function: { name: mcpName("docs", "delete") } });
		const second = await start([json(saying("a"))]);
		await run(second.api, ask(server, { tool_choice: { type: "mcp", server_label: "docs" } }));
		expect(bodies(second.transport)[0].tool_choice).toBe("required");
		const third = await start([json(saying("a"))]);
		await run(third.api, ask(server, { tool_choice: { type: "mcp", server_label: "docs", name: "unknown" } }));
		expect(bodies(third.transport)[0].tool_choice).toBe("required");
		const fourth = await start([json(saying("a"))]);
		await run(fourth.api, {
			model: "qwen",
			input: "x",
			tool_choice: { type: "mcp", server_label: "docs" },
			tools: [{ type: "function", name: "f", parameters: { type: "object" } }]
		});
		expect(bodies(fourth.transport)[0].tool_choice).toBeUndefined();
		const fifth = await start([json(saying("a"))]);
		await run(fifth.api, ask(server, { tool_choice: { type: "mcp", server_label: "docs" } }, { allowed_tools: ["nothing"] }));
		expect(bodies(fifth.transport)[0].tool_choice).toBeUndefined();
	});
});

describe("approvals", () => {
	const ask2 = (server, extra = {}, tool = {}) => ask(server, extra, { require_approval: "always", ...tool });

	it("asks about a call instead of making it, and ends the turn", async () => {
		const server = await serve();
		const { api, transport } = await start([json(calling([["k1", fn, { q: "x" }]]))]);
		const { response } = await run(api, ask2(server));
		expect(response.output.map((item) => item.type)).toEqual(["mcp_list_tools", "mcp_approval_request"]);
		expect(response.output[1]).toMatchObject({ server_label: "docs", name: "search", arguments: '{"q":"x"}' });
		expect(response.output[1].id).toMatch(/^mcpr_/);
		expect(response.status).toBe("completed");
		expect(transport.calls).toHaveLength(1);
		expect(server.requests.some((request) => request.body?.method === "tools/call")).toBe(false);
	});

	it("is the default, and the object form decides per tool", async () => {
		const server = await serve();
		const types = async (tool) => {
			const { api } = await start([json(calling([["k1", fn, {}]])), json(saying("done"))]);
			const { response } = await run(api, {
				model: "qwen",
				input: "x",
				tools: [{ type: "mcp", server_label: "docs", server_url: server.url, ...tool }]
			});
			return response.output.map((item) => item.type);
		};
		expect(await types({})).toEqual(["mcp_list_tools", "mcp_approval_request"]);
		expect(await types({ require_approval: { never: { tool_names: ["search"] } } })).toEqual(["mcp_list_tools", "mcp_call", "message"]);
		expect(await types({ require_approval: { always: { tool_names: ["search"] } } })).toEqual(["mcp_list_tools", "mcp_approval_request"]);
		expect(await types({ require_approval: { never: { tool_names: ["search"] }, always: { tool_names: ["search"] } } })).toEqual([
			"mcp_list_tools",
			"mcp_approval_request"
		]);
		expect(await types({ require_approval: { never: { tool_names: ["delete"] } } })).toEqual(["mcp_list_tools", "mcp_approval_request"]);
		expect(await types({ require_approval: {} })).toEqual(["mcp_list_tools", "mcp_approval_request"]);
	});

	it("streams an approval request", async () => {
		const server = await serve();
		const { api } = await start([sse(chunks([["k1", fn, { q: "x" }]]))]);
		const { events } = await run(api, ask2(server, { stream: true }));
		const done = events.filter((event) => event.event === "response.output_item.done").map((event) => event.data.item.type);
		expect(done).toEqual(["mcp_list_tools", "mcp_approval_request"]);
		expect(events.at(-1).event).toBe("response.completed");
	});

	const history = (approve, extra = {}) => [
		{ role: "user", content: "find it" },
		{
			type: "mcp_list_tools",
			id: "l1",
			server_label: "docs",
			tools: [{ name: "search", description: "d", input_schema: { type: "object" } }]
		},
		{ type: "mcp_approval_request", id: "mcpr_1", server_label: "docs", name: "search", arguments: '{"q":"x"}' },
		{ type: "mcp_approval_response", approval_request_id: "mcpr_1", approve, ...extra }
	];

	it("makes the call when the client approves, and the response starts with the mcp_call", async () => {
		const server = await serve();
		const { api, transport } = await start([json(saying("here it is"))]);
		const { response } = await run(api, ask2(server, { input: history(true) }));
		expect(response.output.map((item) => item.type)).toEqual(["mcp_call", "message"]);
		expect(response.output[0]).toMatchObject({
			name: "search",
			arguments: '{"q":"x"}',
			output: 'called search {"q":"x"}',
			approval_request_id: "mcpr_1"
		});
		const [body] = bodies(transport);
		expect(body.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"]);
		expect(body.messages[1].tool_calls[0]).toMatchObject({ id: "mcpr_1", function: { name: fn, arguments: '{"q":"x"}' } });
		expect(body.messages[2].content).toBe('called search {"q":"x"}');
	});

	it("tells the model when the client declines, and makes no call", async () => {
		const server = await serve();
		const { api, transport } = await start([json(saying("ok, not doing it"))]);
		const { response } = await run(api, ask2(server, { input: history(false, { reason: "no" }) }));
		expect(response.output.map((item) => item.type)).toEqual(["message"]);
		expect(bodies(transport)[0].messages.at(-1).content).toContain("did not approve");
		expect(server.requests.some((request) => request.body?.method === "tools/call")).toBe(false);
	});

	it("reports an approved call whose server is not in the request, and one with arguments that are not an object", async () => {
		const server = await serve();
		const { api, transport } = await start([json(saying("a")), json(saying("b")), json(saying("c"))]);
		const other = history(true).map((item) => (item.server_label === "docs" ? { ...item, server_label: "else" } : item));
		const { response } = await run(api, ask2(server, { input: other }));
		expect(response.output.find((item) => item.type === "mcp_call")).toMatchObject({
			type: "mcp_call",
			server_label: "else",
			error: expect.stringContaining("not part of the request"),
			status: "failed"
		});
		const odd = history(true).map((item) => (item.type === "mcp_approval_request" ? { ...item, arguments: "not json" } : item));
		await run(api, ask2(server, { input: odd }));
		const array = history(true).map((item) => (item.type === "mcp_approval_request" ? { ...item, arguments: "[1]" } : item));
		await run(api, ask2(server, { input: array }));
		expect(transport.calls).toHaveLength(3);
		expect(
			server.requests.filter((request) => request.body?.method === "tools/call").map((request) => request.body.params.arguments)
		).toEqual([{}, {}]);
	});

	it("asks the server with no arguments when the approved request had none", async () => {
		const server = await serve();
		const { api } = await start([json(saying("a"))]);
		const input = history(true).map((item) =>
			item.type === "mcp_approval_request" ? { type: item.type, id: item.id, server_label: "docs", name: "search" } : item
		);
		await run(api, ask2(server, { input }));
		expect(
			server.requests.filter((request) => request.body?.method === "tools/call").map((request) => request.body.params.arguments)
		).toEqual([{}]);
	});

	it("refuses an approval response that names no request, and drops a request nobody answered", async () => {
		const server = await serve();
		const { api, transport } = await start([json(saying("a"))]);
		const { reply } = await run(
			api,
			ask2(server, {
				input: [
					{ role: "user", content: "x" },
					{ type: "mcp_approval_response", approval_request_id: "nope", approve: true }
				]
			})
		);
		expect(reply.body.error).toMatchObject({ code: "unsupported_content", param: "input[1].approval_request_id" });
		const open = [
			{ role: "user", content: "x" },
			{ type: "mcp_approval_request", id: "mcpr_9", server_label: "docs", name: "search", arguments: "{}" },
			{ role: "user", content: "y" }
		];
		await run(api, ask2(server, { input: open }));
		expect(bodies(transport)[0].messages.map((message) => message.role)).toEqual(["user", "user"]);
	});

	it("ends the turn when a call that needs approval comes with a call of the client's own function", async () => {
		const server = await serve();
		const { api, transport } = await start([
			json(
				calling([
					["k1", fn, {}],
					["k2", "weather", {}]
				])
			)
		]);
		const { response } = await run(api, {
			...ask2(server),
			tools: [...ask2(server).tools, { type: "function", name: "weather", parameters: { type: "object" } }]
		});
		expect(response.output.map((item) => item.type)).toEqual(["mcp_list_tools", "mcp_approval_request", "function_call"]);
		expect(transport.calls).toHaveLength(1);
	});
});

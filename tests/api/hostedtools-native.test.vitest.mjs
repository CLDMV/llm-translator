/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/hostedtools-native.test.vitest.mjs
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
 * @fileoverview `hostedTools: "native"`: hosted tools, tool choices, `include` and hosted history items go to an upstream on the Responses API as they are, and
 * its hosted output items and events come back unchanged; any other route refuses what only a Responses upstream can serve. Upstreams are mocked transports.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { refuse, strip } from "../../src/lib/hostedtools.mjs";
import { stream as responsesStream } from "../../src/api/convert/openai/chat/to/openai/responses/stream.mjs";

afterEach(closeAll);

const url = "http://responses.test";
const toChat = (api) => api.convert.openai.responses.to.openai.chat;
const fromChat = (api) => api.convert.openai.chat.to.openai.responses;
const hosted = [
	{ type: "web_search", filters: { allowed_domains: ["a.test"] } },
	{ type: "file_search", vector_store_ids: ["vs_1"] },
	{ type: "image_generation" },
	{ type: "mcp", server_label: "docs", server_url: "https://mcp.test/", require_approval: "never" },
	{ type: "shell", environment: { type: "container_auto" } },
	{ type: "mystery_tool", x: 1 },
	{ type: "function", name: "weather", parameters: { type: "object" } }
];
const history = [
	{ role: "user", content: "first" },
	{
		type: "web_search_call",
		id: "ws_1",
		status: "completed",
		action: { type: "search", query: "q", sources: [{ type: "url", url: "https://a.test" }] }
	},
	{ type: "file_search_call", id: "fs_1", status: "completed", queries: ["q"], results: [] },
	{ type: "tool_search_call", id: "tsc_1", call_id: "k1", execution: "server", arguments: { query: "x" } },
	{ type: "tool_search_output", id: "tso_1", call_id: "k1", execution: "server", tools: [] },
	{ type: "code_interpreter_call", id: "ci_1", status: "completed", code: "1", container_id: "c", outputs: [] },
	{ type: "mcp_call", id: "mcp_1", server_label: "docs", name: "t", arguments: "{}", output: "o" },
	{ role: "user", content: "again" }
];
const output = [
	{ type: "web_search_call", id: "ws_9", status: "completed", action: { type: "search", query: "n" } },
	{ type: "file_search_call", id: "fs_9", status: "completed", queries: ["n"], results: [{ file_id: "f", text: "t" }] },
	{
		type: "message",
		id: "msg_9",
		role: "assistant",
		status: "completed",
		content: [{ type: "output_text", text: "done", annotations: [] }]
	}
];
const answer = {
	id: "resp_up",
	object: "response",
	created_at: 5,
	status: "completed",
	model: "gpt-x",
	output,
	usage: { input_tokens: 4, output_tokens: 3, total_tokens: 7 }
};
const sse = (events) =>
	new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""), {
		status: 200,
		headers: { "content-type": "text/event-stream" }
	});
const events = [
	{ type: "response.created", sequence_number: 0, response: { id: "resp_up", status: "in_progress", output: [] } },
	{ type: "response.output_item.added", sequence_number: 1, output_index: 0, item: { ...output[0], status: "in_progress" } },
	{ type: "response.web_search_call.searching", sequence_number: 2, output_index: 0, item_id: "ws_9" },
	{ type: "response.output_item.done", sequence_number: 3, output_index: 0, item: output[0] },
	{ type: "response.completed", sequence_number: 4, response: answer }
];

/** A translator with one upstream and a transport that records its calls. */
async function start(upstream, settings = { hostedTools: "native" }, handler) {
	const transport = fakeTransport(handler ?? ((target, init) => (JSON.parse(init.body).stream === true ? sse(events) : { body: answer })));
	const api = await make({
		front: "openai",
		upstreams: [{ url, backend: "compatible", models: ["gpt-x"], ...upstream }],
		settings,
		detect: false,
		transport
	});
	return { api, transport };
}
const respond = async (api, body, settings = { hostedTools: "native" }) => {
	const { body: chat, state } = toChat(api).request(body, settings);
	const reply = await api.send(chat, { wire: "responses" });
	if (reply.status >= 400) return { reply };
	if (reply.stream) return { reply, events: await collect(fromChat(api).stream(reply.stream, state)) };
	return { reply, response: fromChat(api).response(reply.body, state) };
};
const sent = (transport) => JSON.parse(transport.calls.at(-1).init.body);

describe("a Responses upstream with hostedTools native", () => {
	it("sends the tools, the tool choice, include and the hosted history items as they are, and returns the upstream's items unchanged", async () => {
		const { api, transport } = await start({ api: "responses" });
		const { response } = await respond(api, {
			model: "gpt-x",
			input: history,
			tools: hosted,
			tool_choice: { type: "file_search" },
			include: ["web_search_call.action.sources", "file_search_call.results"]
		});
		const body = sent(transport);
		expect(body.tools).toEqual(hosted.map((tool) => (tool.type === "function" ? { ...tool, strict: false } : tool)));
		expect(body.tool_choice).toEqual({ type: "file_search" });
		expect(body.include).toEqual(["reasoning.encrypted_content", "web_search_call.action.sources", "file_search_call.results"]);
		expect(body.input.map((item) => item.type ?? item.role)).toEqual([
			"user",
			"web_search_call",
			"file_search_call",
			"tool_search_call",
			"tool_search_output",
			"code_interpreter_call",
			"mcp_call",
			"user"
		]);
		expect(body.input[1]).toEqual(history[1]);
		expect(body.input[6]).toEqual(history[6]);
		expect(JSON.stringify(body)).not.toContain("llmt_");
		expect(response.output).toEqual(output);
		expect(response.status).toBe("completed");
		expect(response.usage).toMatchObject({ input_tokens: 4, output_tokens: 3 });
	});

	it("streams the upstream's events unchanged and adds none of its own", async () => {
		const { api } = await start({ api: "responses" });
		const { events: seen } = await respond(api, { model: "gpt-x", input: "hi", stream: true, tools: [{ type: "web_search" }] });
		expect(seen.map((event) => event.data)).toEqual(events);
		expect(seen.map((event) => event.event)).toEqual(events.map((event) => event.type));
	});

	it("keeps a tool choice it cannot map, and leaves an allowed_tools list of hosted tools to the upstream", async () => {
		const { api, transport } = await start({ api: "responses" });
		const choice = { type: "allowed_tools", mode: "auto", tools: [{ type: "file_search" }, { type: "web_search" }] };
		await respond(api, { model: "gpt-x", input: "hi", tools: hosted, tool_choice: choice });
		expect(sent(transport).tool_choice).toEqual(choice);
		await respond(api, { model: "gpt-x", input: "hi", tools: [{ type: "web_search" }], tool_choice: { type: "web_search" } });
		expect(sent(transport).tool_choice).toEqual({ type: "web_search" });
	});

	it("does not touch a request with no hosted tools", async () => {
		const { api, transport } = await start({ api: "responses" });
		const { response } = await respond(api, {
			model: "gpt-x",
			input: "hi",
			include: ["x"],
			tool_choice: { type: "function", name: "f" },
			tools: [{ type: "function", name: "f" }]
		});
		expect(sent(transport).include).toEqual(["reasoning.encrypted_content"]);
		expect(response.output.map((item) => item.type)).toEqual(["message"]);
	});
});

describe("what a native request needs, and where it is refused", () => {
	const wanted = { model: "gpt-x", input: "hi", tools: [{ type: "web_search" }, { type: "file_search" }] };

	it("refuses a hosted tool on the default setting, naming the setting", async () => {
		const { api } = await start({ api: "responses" }, {});
		expect(() => toChat(api).request({ model: "gpt-x", input: "hi", tools: [{ type: "file_search" }] }, {})).toThrow(
			/hostedTools setting "native"/
		);
	});

	it("refuses a tool or an item only a Responses upstream can take when the upstream speaks Chat Completions", async () => {
		const { api, transport } = await start({ api: "chat" });
		const { reply } = await respond(api, wanted);
		expect(reply.status).toBe(400);
		expect(reply.body.error).toMatchObject({ code: "unsupported_tool", param: "tools[1]" });
		expect(reply.body.error.message).toContain('"native"');
		const item = await respond(api, {
			model: "gpt-x",
			input: [
				{ role: "user", content: "x" },
				{ type: "file_search_call", id: "fs" }
			]
		});
		expect(item.reply.body.error).toMatchObject({ code: "unsupported_content", param: "input[1]" });
		expect(transport.calls).toHaveLength(0);
	});

	it("still emulates a tool the translator can run when the upstream speaks Chat Completions", async () => {
		const search = { name: "fake", search: async () => [{ url: "https://a.test", title: "A", snippet: "s" }] };
		const { webSearch } = await import("../../src/lib/websearch.mjs");
		const replies = [
			{
				body: {
					id: "c",
					object: "chat.completion",
					created: 1,
					model: "gpt-x",
					choices: [
						{
							index: 0,
							message: {
								role: "assistant",
								content: null,
								tool_calls: [{ id: "k", type: "function", function: { name: "web_search", arguments: '{"query":"q"}' } }]
							},
							finish_reason: "tool_calls"
						}
					]
				}
			},
			{
				body: {
					id: "c",
					object: "chat.completion",
					created: 1,
					model: "gpt-x",
					choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }]
				}
			}
		];
		let turn = 0;
		const transport = fakeTransport(() => replies[turn++]);
		const api = await make({
			front: "openai",
			upstreams: [{ url, backend: "vllm", api: "chat", models: ["gpt-x"] }],
			settings: { hostedTools: "native" },
			serverTools: [webSearch({ provider: search })],
			detect: false,
			transport
		});
		const { response } = await respond(api, {
			model: "gpt-x",
			input: [
				{ role: "user", content: "x" },
				{ type: "web_search_call", id: "ws_1", action: { query: "q" } },
				{ role: "user", content: "y" }
			],
			tools: [{ type: "web_search" }]
		});
		expect(response.output.map((item) => item.type)).toEqual(["web_search_call", "message"]);
		const first = JSON.parse(transport.calls[0].init.body);
		expect(JSON.stringify(first)).not.toContain("llmt_");
	});

	it("refuses the hosted tools when an auto upstream falls back to Chat Completions, and emulates them from then on", async () => {
		const transport = fakeTransport((target) =>
			new URL(target).pathname === "/v1/responses"
				? { status: 404, body: { detail: "Not Found" } }
				: {
						body: {
							id: "c",
							object: "chat.completion",
							created: 1,
							model: "gpt-x",
							choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }]
						}
					}
		);
		const api = await make({
			front: "openai",
			upstreams: [{ url, backend: "vllm", api: "auto", models: ["gpt-x"] }],
			settings: { hostedTools: "native" },
			detect: false,
			transport
		});
		const first = await respond(api, { model: "gpt-x", input: "hi", tools: [{ type: "web_search" }, { type: "file_search" }] });
		expect(first.reply.status).toBe(400);
		expect(first.reply.body.error).toMatchObject({ code: "unsupported_tool", param: "tools[0]" });
		const emulated = await respond(api, { model: "gpt-x", input: "hi", tools: [{ type: "file_search" }] });
		expect(emulated.reply.body.error).toMatchObject({ code: "unsupported_tool", param: "tools[0]" });
		const fallen = await respond(api, { model: "gpt-x", input: "hi", tools: [{ type: "web_search" }] });
		expect(fallen.reply.body.error).toMatchObject({ code: "unsupported_tool", param: "tools[0]" });
		expect(fallen.reply.body.error.message).toContain("executor");
	});
});

describe("strip", () => {
	it("removes the native markers, fields and items for a caller that does not run them", async () => {
		const { api } = await start({ api: "responses" });
		const { body } = toChat(api).request(
			{ model: "gpt-x", input: history, tools: hosted, tool_choice: { type: "file_search" }, include: ["x"] },
			{ hostedTools: "native" }
		);
		expect(JSON.stringify(body)).toContain("llmt_native_choice");
		const plain = strip(body);
		expect(JSON.stringify(plain).replace(/llmt_native_\d+/g, "")).not.toContain("llmt_");
		expect(plain.messages.every((message) => message.role !== undefined)).toBe(true);
		expect(plain.messages.length).toBeLessThan(body.messages.length);
		const counted = await api.token.count(body);
		expect(counted.input_tokens).toBeGreaterThan(0);
	});
});

describe("edges", () => {
	it("refuses nothing for a body with nothing marked, and names the input item of a replayed call that reached a Chat upstream", () => {
		expect(() => refuse({}, true)).not.toThrow();
		expect(() =>
			refuse({ messages: [{ role: "tool", llmt_hosted: { kind: "web_search", item: { type: "web_search_call" } } }] }, true)
		).toThrow(/input: unsupported input item type "web_search_call"/);
		expect(() => refuse({ messages: [{ role: "tool", llmt_hosted: { kind: "web_search", item: {} } }] }, true)).toThrow(/type null/);
		expect(() => refuse({ messages: [{ role: "tool", llmt_hosted: { kind: "web_search", item: {} } }] }, false)).not.toThrow();
	});

	it("merges include with the reasoning carrier only when the upstream asks for one", async () => {
		const { api, transport } = await start({ api: "responses", settings: { reasoningRoundTrip: false } });
		await respond(api, { model: "gpt-x", input: "hi", tools: [{ type: "file_search" }], include: ["file_search_call.results"] });
		expect(sent(transport).include).toEqual(["file_search_call.results"]);
	});

	it("ends an empty stream the way a Chat stream ends: failed, as cut short", async () => {
		const seen = await collect(responsesStream([], { model: "m", echo: {} }));
		expect(seen.at(-1).event).toBe("response.failed");
	});

	it("reads a replayed tool_search output whose tools have no usable names", async () => {
		const { api, transport } = await start({ api: "chat" }, {}, () => ({
			body: {
				id: "c",
				object: "chat.completion",
				created: 1,
				model: "gpt-x",
				choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }]
			}
		}));
		for (const extra of [{}, { tools: [{ function: { name: "a" } }, { type: "function" }, null] }, { status: "failed" }]) {
			await respond(
				api,
				{
					model: "gpt-x",
					input: [
						{ role: "user", content: "x" },
						{ type: "tool_search_call", id: "tsc", call_id: "k", arguments: {} },
						{ type: "tool_search_output", id: "tso", call_id: "k", ...extra },
						{ role: "user", content: "y" }
					]
				},
				{}
			);
		}
		expect(transport.calls).toHaveLength(3);
	});

	it("replays a code_interpreter_call that has no outputs", async () => {
		const { api, transport } = await start({ api: "chat" }, {}, () => ({
			body: {
				id: "c",
				object: "chat.completion",
				created: 1,
				model: "gpt-x",
				choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }]
			}
		}));
		await respond(
			api,
			{
				model: "gpt-x",
				input: [
					{ role: "user", content: "x" },
					{ type: "code_interpreter_call", id: "ci", code: "1" },
					{ role: "user", content: "y" }
				]
			},
			{}
		);
		expect(JSON.parse(transport.calls[0].init.body).messages[2].content).toContain("code_execution_result");
	});
});

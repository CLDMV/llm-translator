/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/webfetch.test.vitest.mjs
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
 * @fileoverview The `webFetch` executor in `serverTools` end to end: the tool is offered to a converted upstream, the model's call runs the safeguarded
 * fetcher, and the client gets `server_tool_use` and `web_fetch_tool_result` blocks, streamed or not. The upstream and the web are faked.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { openaiSse } from "../helpers/streams.mjs";
import { fakeWeb } from "../helpers/fake-web.mjs";
import { webFetch } from "../../src/index.mjs";

afterEach(closeAll);

const chat = { url: "http://vllm.test", backend: "vllm", api: "chat", models: ["qwen3-coder"] };
const fetchTool = { type: "web_fetch_20250910", name: "web_fetch", max_uses: 1 };
const URL_A = "https://docs.example.com/guide";
const ask = { model: "qwen3-coder", max_tokens: 64, messages: [{ role: "user", content: `summarize ${URL_A}` }], tools: [fetchTool] };
const usage = (prompt, completion) => ({ prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion });

const calling = (id, args, name = "web_fetch") => ({
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
				tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }]
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
const streamCall = (id, args) => {
	const json = JSON.stringify(args);
	const call = (tool) => ({ ...base, choices: [{ index: 0, delta: { tool_calls: [tool] }, finish_reason: null }] });
	return [
		{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
		call({ index: 0, id, type: "function", function: { name: "web_fetch", arguments: json.slice(0, 6) } }),
		call({ index: 0, function: { arguments: json.slice(6) } }),
		{ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
		{ ...base, choices: [], usage: usage(10, 5) },
		"[DONE]"
	];
};
const streamText = (text) => [
	{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] },
	{ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
	{ ...base, choices: [], usage: usage(30, 8) },
	"[DONE]"
];
const json = (body) => ({ status: 200, body });
const sse = (list) => ({ status: 200, body: openaiSse(list), headers: { "content-type": "text/event-stream" } });

/** A transport that answers with the scripted replies in order. */
function script(replies) {
	let turn = 0;
	const transport = fakeTransport(() => replies[turn++]);
	transport.bodies = () => transport.calls.map((call) => JSON.parse(call.init.body));
	return transport;
}

const html = "<html><head><title>Guide</title></head><body><h1>Guide</h1><p>Install it.</p></body></html>";

describe("webFetch", () => {
	it("offers web_fetch as a function, fetches the URL and returns the blocks and the counter", async () => {
		const web = fakeWeb(() => ({ body: html }));
		const transport = script([json(calling("c1", { url: URL_A })), json(saying("It says to install it."))]);
		const api = await make({
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: [webFetch({ allow: ["docs.example.com"], deps: web.deps })]
		});
		const reply = await api.send(ask);
		expect(reply.status).toBe(200);
		const [first, second] = transport.bodies();
		expect(first.tools[0].function).toMatchObject({
			name: "web_fetch",
			parameters: { type: "object", required: ["url"] }
		});
		const [use, result, text] = reply.body.content;
		expect(use).toMatchObject({ type: "server_tool_use", name: "web_fetch", input: { url: URL_A } });
		expect(result).toMatchObject({
			type: "web_fetch_tool_result",
			tool_use_id: use.id,
			content: {
				type: "web_fetch_result",
				url: URL_A,
				content: { type: "document", title: "Guide", source: { type: "text", media_type: "text/plain", data: "Guide\nInstall it." } }
			}
		});
		expect(text).toEqual({ type: "text", text: "It says to install it." });
		expect(reply.body.usage.server_tool_use).toEqual({ web_fetch_requests: 1 });
		// The model reads the result as the function's output.
		const output = second.messages.at(-1);
		expect(output.role).toBe("tool");
		expect(output.content).toBe(`Guide\n${URL_A}\n\nGuide\nInstall it.`);
		expect(web.calls).toHaveLength(1);
	});

	it("answers a URL that is not in the conversation with url_not_allowed and fetches nothing", async () => {
		const web = fakeWeb(() => ({ body: html }));
		const transport = script([json(calling("c1", { url: "https://docs.example.com/other" })), json(saying("I could not."))]);
		const api = await make({
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: [webFetch({ allow: ["docs.example.com"], deps: web.deps })]
		});
		const reply = await api.send(ask);
		expect(reply.body.content[1]).toMatchObject({
			type: "web_fetch_tool_result",
			content: { type: "web_fetch_tool_error", error_code: "url_not_allowed" }
		});
		expect(web.calls).toHaveLength(0);
		expect(reply.body.usage.server_tool_use).toEqual({ web_fetch_requests: 1 });
	});

	it("streams the call and the result as content blocks", async () => {
		const web = fakeWeb(() => ({ body: html }));
		const transport = script([sse(streamCall("c1", { url: URL_A })), sse(streamText("Done."))]);
		const api = await make({
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: [webFetch({ allow: ["docs.example.com"], deps: web.deps })]
		});
		const reply = await api.send({ ...ask, stream: true });
		const events = await collect(reply.stream);
		const blocks = events.filter((event) => event.event === "content_block_start").map((event) => event.data.content_block);
		expect(blocks.map((block) => block.type)).toEqual(["server_tool_use", "web_fetch_tool_result", "text"]);
		expect(blocks[1]).toMatchObject({
			tool_use_id: blocks[0].id,
			content: { type: "web_fetch_result", url: URL_A, content: { title: "Guide" } }
		});
		expect(events.find((event) => event.event === "message_delta").data.usage.server_tool_use).toEqual({ web_fetch_requests: 1 });
	});

	const search = {
		type: /^web_search_/,
		schema: () => ({ type: "object" }),
		run: async () => ({ content: [{ type: "web_search_result", url: "https://docs.example.com/found" }] })
	};

	it("lets a URL from an earlier result of the same request be fetched", async () => {
		const web = fakeWeb(() => ({ body: html }));
		const transport = script([
			json(calling("c1", { query: "x" }, "web_search")),
			json(calling("c2", { url: "https://docs.example.com/found" })),
			json(saying("ok"))
		]);
		const api = await make({
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: [search, webFetch({ allow: ["docs.example.com"], deps: web.deps })]
		});
		const reply = await api.send({ ...ask, tools: [{ type: "web_search_20250305", name: "web_search" }, fetchTool] });
		expect(reply.body.content.map((block) => block.type)).toEqual([
			"server_tool_use",
			"web_search_tool_result",
			"server_tool_use",
			"web_fetch_tool_result",
			"text"
		]);
		expect(reply.body.content[3].content.type).toBe("web_fetch_result");
		expect(web.calls).toHaveLength(1);
	});

	it("lets a URL from a server tool result in the history be fetched", async () => {
		const web = fakeWeb(() => ({ body: html }));
		const transport = script([json(calling("c1", { url: "https://docs.example.com/found" })), json(saying("ok"))]);
		const api = await make({
			upstreams: [chat],
			transport,
			detect: false,
			serverTools: [webFetch({ allow: ["docs.example.com"], deps: web.deps })]
		});
		const messages = [
			{ role: "user", content: "look something up" },
			{
				role: "assistant",
				content: [
					{ type: "server_tool_use", id: "srvtoolu_1", name: "web_search", input: { query: "x" } },
					{
						type: "web_search_tool_result",
						tool_use_id: "srvtoolu_1",
						content: [{ type: "web_search_result", url: "https://docs.example.com/found" }]
					}
				]
			},
			{ role: "user", content: "now read the first hit" }
		];
		const reply = await api.send({ ...ask, messages });
		expect(reply.body.content[1].content.type).toBe("web_fetch_result");
		expect(web.calls).toHaveLength(1);
	});
});

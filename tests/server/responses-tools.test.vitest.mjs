/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/server/responses-tools.test.vitest.mjs
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
 * @fileoverview The Responses front over HTTP: the errors for tool types with no counterpart (OpenAI-shaped bodies), emulated shell, apply_patch and custom
 * tools, hosted tools through `serverTools`, and `POST /v1/responses/compact` with the compaction item round trip. The upstream is a local fake.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, make } from "../helpers/translator.mjs";
import { completion, fakeVllm, json, sse } from "../helpers/fake-server.mjs";
import { webSearch } from "../../src/lib/websearch.mjs";
import { COMPACTED, unsummarize } from "../../src/lib/responses.mjs";

afterEach(closeAll);

const post = (url, body, headers = {}) =>
	fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const frames = (text) =>
	text
		.split("\n\n")
		.filter(Boolean)
		.map((block) => {
			const out = {};
			for (const line of block.split("\n")) {
				if (line.startsWith("event: ")) out.event = line.slice(7);
				else if (line.startsWith("data: ")) out.data = JSON.parse(line.slice(6));
			}
			return out;
		});
const chatBody = (upstream) => upstream.requests.filter((entry) => entry.url === "/v1/chat/completions").at(-1).body;
const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
const calling = (calls) => ({
	id: "chatcmpl-1",
	object: "chat.completion",
	created: 1,
	model: "qwen3-coder",
	choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: calls }, finish_reason: "tool_calls" }],
	usage
});
const fn = (id, name, args) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const base = { id: "chatcmpl-s", object: "chat.completion.chunk", created: 1, model: "qwen3-coder" };
const chunk = (delta, finish = null) => ({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] });

/** Start the translator on the Responses front with a fake upstream whose chat handler is given. */
async function start(chat, config = {}, serving = {}) {
	// Detection probes the upstream's chat route before the first request; the handler under test only sees the requests after that.
	let live = false;
	const upstream = await fakeVllm({
		chat: (req, body, res, record) => (live ? chat(req, body, res, record) : json(res, 200, completion("ok")))
	});
	const api = await make({ front: "openai", upstreams: [upstream.url], ...config });
	const server = await api.server.start({ port: 0, ...serving });
	live = true;
	upstream.requests.length = 0;
	return { upstream, api, server, url: `${server.url}/v1/responses` };
}

describe("tool types with no counterpart", () => {
	it.each(["file_search", "image_generation", "local_shell", "computer_use_preview", "something_new"])(
		"answers %s with a 400 in the OpenAI error shape and never calls the upstream",
		async (type) => {
			const { upstream, url } = await start((req, body, res) => json(res, 200, completion("hi")));
			try {
				for (const stream of [false, true]) {
					const reply = await post(url, { model: "qwen3-coder", input: "x", stream, tools: [{ type: "function", name: "a" }, { type }] });
					expect(reply.status).toBe(400);
					expect(reply.headers.get("content-type")).toMatch(/json/);
					const body = await reply.json();
					expect(Object.keys(body)).toEqual(["error"]);
					expect(body.error).toEqual({
						message: expect.stringContaining(type),
						type: "invalid_request_error",
						param: "tools[1]",
						code: "unsupported_tool"
					});
				}
				expect(upstream.requests.filter((entry) => entry.url === "/v1/chat/completions")).toHaveLength(0);
			} finally {
				await upstream.close();
			}
		}
	);

	it("answers an emulated hosted tool with no executor the same way, and refuses an unknown context management type", async () => {
		const { upstream, url } = await start((req, body, res) => json(res, 200, completion("hi")));
		try {
			const reply = await post(url, { model: "qwen3-coder", input: "x", tools: [{ type: "web_search" }] });
			expect(reply.status).toBe(400);
			expect((await reply.json()).error).toMatchObject({ code: "unsupported_tool", param: "tools[0]", type: "invalid_request_error" });
			const managed = await post(url, {
				model: "qwen3-coder",
				input: "x",
				context_management: [{ type: "something_else" }]
			});
			expect(managed.status).toBe(400);
			expect((await managed.json()).error).toMatchObject({ code: "unsupported_field", param: "context_management[0].type" });
		} finally {
			await upstream.close();
		}
	});
});

describe("shell and apply_patch", () => {
	it("offers the tools as functions, returns the calls as items, and takes the outputs back", async () => {
		let turn = 0;
		const { upstream, url } = await start((req, body, res) =>
			json(
				res,
				200,
				turn++ === 0
					? calling([fn("c1", "shell", { commands: ["ls"] }), fn("c2", "apply_patch", { type: "create_file", path: "a.txt", diff: "+x" })])
					: completion("done")
			)
		);
		try {
			const first = await (
				await post(url, {
					model: "qwen3-coder",
					input: "go",
					tools: [{ type: "shell" }, { type: "apply_patch" }],
					tool_choice: { type: "shell" }
				})
			).json();
			const sent = chatBody(upstream);
			expect(sent.tools.map((tool) => tool.function.name)).toEqual(["shell", "apply_patch"]);
			expect(sent.tool_choice).toEqual({ type: "function", function: { name: "shell" } });
			expect(first.output.map((item) => item.type)).toEqual(["shell_call", "apply_patch_call"]);
			expect(first.output[0]).toMatchObject({ call_id: "c1", action: { commands: ["ls"] } });
			const second = await (
				await post(url, {
					model: "qwen3-coder",
					tools: [{ type: "shell" }, { type: "apply_patch" }],
					input: [
						{ role: "user", content: "go" },
						...first.output,
						{
							type: "shell_call_output",
							call_id: "c1",
							output: [{ stdout: "a.txt\n", stderr: "", outcome: { type: "exit", exit_code: 0 } }]
						},
						{ type: "apply_patch_call_output", call_id: "c2", status: "completed", output: "created" }
					]
				})
			).json();
			expect(second.output[0].content[0].text).toBe("done");
			const messages = chatBody(upstream).messages;
			expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "tool", "tool"]);
			expect(messages[1].tool_calls.map((call) => call.function.name)).toEqual(["shell", "apply_patch"]);
			expect(messages[2].content).toContain("a.txt");
			expect(messages[3].content).toBe("completed\ncreated");
		} finally {
			await upstream.close();
		}
	});

	it("streams a shell_call", async () => {
		const { upstream, url } = await start((req, body, res) =>
			sse(res, [
				chunk({ tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "shell", arguments: '{"commands":' } }] }),
				chunk({ tool_calls: [{ index: 0, function: { arguments: '["pwd"]}' } }] }),
				chunk({}, "tool_calls"),
				"[DONE]"
			])
		);
		try {
			const text = await (await post(url, { model: "qwen3-coder", input: "go", stream: true, tools: [{ type: "shell" }] })).text();
			const done = frames(text).find((frame) => frame.event === "response.output_item.done");
			expect(done.data.item).toMatchObject({ type: "shell_call", call_id: "c1", action: { commands: ["pwd"] } });
		} finally {
			await upstream.close();
		}
	});
});

describe("custom tools", () => {
	it("sends them as Chat custom tools and returns a custom call as a custom_tool_call", async () => {
		const { upstream, url } = await start((req, body, res) =>
			json(res, 200, calling([{ id: "c1", type: "custom", custom: { name: "words", input: "hello" } }]))
		);
		try {
			const format = { type: "text" };
			const reply = await (
				await post(url, {
					model: "qwen3-coder",
					input: "go",
					tools: [{ type: "custom", name: "words", description: "d", format }],
					tool_choice: { type: "custom", name: "words" }
				})
			).json();
			const sent = chatBody(upstream);
			expect(sent.tools).toEqual([{ type: "custom", custom: { name: "words", description: "d", format } }]);
			expect(sent.tool_choice).toEqual({ type: "custom", custom: { name: "words" } });
			expect(reply.output[0]).toMatchObject({ type: "custom_tool_call", call_id: "c1", name: "words", input: "hello" });
		} finally {
			await upstream.close();
		}
	});
});

describe("hosted tools over HTTP", () => {
	it("runs web_search with a configured executor, non-streaming and streaming, and stores the response", async () => {
		const queries = [];
		const executor = webSearch({
			provider: {
				search: async (query) => {
					queries.push(query);
					return [{ url: "https://a.test/1", title: "First", snippet: "alpha" }];
				}
			}
		});
		let turn = 0;
		const { upstream, url } = await start(
			(req, body, res) => {
				turn++;
				if (body.stream) {
					return sse(
						res,
						turn % 2 === 1
							? [
									chunk({
										tool_calls: [
											{ index: 0, id: `c${turn}`, type: "function", function: { name: "web_search", arguments: '{"query":"slothlet"}' } }
										]
									}),
									chunk({}, "tool_calls"),
									{ ...base, choices: [], usage },
									"[DONE]"
								]
							: [chunk({ content: "Found it.[[cite:1]]" }), chunk({}, "stop"), { ...base, choices: [], usage }, "[DONE]"]
					);
				}
				return json(
					res,
					200,
					turn % 2 === 1 ? calling([fn(`c${turn}`, "web_search", { query: "slothlet" })]) : completion("Found it.[[cite:1]]")
				);
			},
			{ serverTools: [executor] }
		);
		try {
			const plain = await (await post(url, { model: "qwen3-coder", input: "find", tools: [{ type: "web_search" }] })).json();
			expect(plain.output.map((item) => item.type)).toEqual(["web_search_call", "message"]);
			expect(plain.output[1].content[0].annotations).toMatchObject([{ type: "url_citation", url: "https://a.test/1" }]);
			expect(plain.usage).toMatchObject({ input_tokens: expect.any(Number) });
			const streamed = frames(
				await (await post(url, { model: "qwen3-coder", input: "find", stream: true, tools: [{ type: "web_search" }] })).text()
			);
			expect(streamed.map((frame) => frame.event)).toContain("response.web_search_call.searching");
			expect(streamed.at(-1).data.response.output.map((item) => item.type)).toEqual(["web_search_call", "message"]);
			expect(queries).toEqual(["slothlet", "slothlet"]);
			// A later turn replays the stored web_search_call through previous_response_id.
			const followed = await post(url, {
				model: "qwen3-coder",
				input: "more",
				previous_response_id: plain.id,
				tools: [{ type: "web_search" }]
			});
			expect(followed.status).toBe(200);
			const replayed = chatBody(upstream).messages;
			expect(replayed.some((message) => message.role === "tool" && message.content.includes("1. https://a.test/1"))).toBe(true);
		} finally {
			await upstream.close();
		}
	});
});

describe("POST /v1/responses/compact", () => {
	const reply = (text) => (req, body, res) => json(res, 200, { ...completion(text), usage });

	it("summarises the conversation and returns the user messages and a compaction item the next request can use", async () => {
		const { upstream, url } = await start(reply("The user is porting a loader."));
		try {
			const compacted = await post(`${url}/compact`, {
				model: "qwen3-coder",
				instructions: "be brief",
				input: [
					{ role: "user", content: "port the loader" },
					{ type: "message", role: "assistant", content: [{ type: "output_text", text: "On it." }] },
					{ type: "function_call", call_id: "c1", name: "ls", arguments: "{}" },
					{ type: "function_call_output", call_id: "c1", output: "a.js" },
					{ role: "user", content: [{ type: "input_text", text: "and the tests" }] }
				]
			});
			expect(compacted.status).toBe(200);
			const body = await compacted.json();
			expect(body).toMatchObject({ object: "response.compaction", usage: { input_tokens: 10, output_tokens: 5 } });
			expect(body.id).toMatch(/^resp_[0-9a-f]{24}$/);
			expect(typeof body.created_at).toBe("number");
			expect(body.output.map((item) => item.type ?? item.role)).toEqual(["user", "user", "compaction"]);
			expect(unsummarize(body.output[2].encrypted_content)).toBe("The user is porting a loader.");
			const sent = chatBody(upstream);
			expect(sent.messages[0]).toEqual({ role: "system", content: "be brief" });
			expect(sent.messages.at(-1).content).toContain("Write a summary of the conversation above");
			expect(sent.tools).toBeUndefined();
			// The window goes back as the next request's input.
			const next = await post(url, { model: "qwen3-coder", input: [...body.output, { role: "user", content: "continue" }] });
			expect(next.status, await next.clone().text()).toBe(200);
			const messages = chatBody(upstream).messages;
			expect(messages.map((message) => message.role)).toEqual(["user", "user", "user", "user"]);
			expect(messages[2].content).toBe(`${COMPACTED}\n\nThe user is porting a loader.`);
		} finally {
			await upstream.close();
		}
	});

	it("compacts a string input and a stored conversation named by previous_response_id", async () => {
		const { upstream, url } = await start(reply("S"));
		try {
			const plain = await (await post(`${url}/compact`, { model: "qwen3-coder", input: "hello" })).json();
			expect(plain.output[0]).toMatchObject({ role: "user", content: [{ type: "input_text", text: "hello" }] });
			const first = await (await post(url, { model: "qwen3-coder", input: "remember 7" })).json();
			const chained = await post(`${url}/compact`, { model: "qwen3-coder", input: "and 8", previous_response_id: first.id });
			expect(chained.status).toBe(200);
			const sent = chatBody(upstream).messages;
			expect(sent.map((message) => message.role)).toEqual(["user", "assistant", "user", "user"]);
			expect(sent[0].content[0].text).toBe("remember 7");
		} finally {
			await upstream.close();
		}
	});

	it("refuses bad bodies and a compaction item it did not write with OpenAI-shaped errors", async () => {
		const { upstream, url } = await start(reply("S"));
		try {
			const cases = [
				[{ input: "x" }, "invalid_request", "model"],
				[{ model: "qwen3-coder", input: [{ type: "compaction", encrypted_content: "foreign" }] }, "unsupported_content", "input[0]"],
				[{ model: "qwen3-coder", input: [{ type: "file_search_call", id: "x" }] }, "unsupported_content", "input[0]"]
			];
			for (const [body, code, param] of cases) {
				const answer = await post(`${url}/compact`, body);
				expect(answer.status).toBe(400);
				expect((await answer.json()).error).toMatchObject({ code, param, type: "invalid_request_error" });
			}
			expect((await post(`${url}/compact`, [1])).status).toBe(400);
			expect(upstream.requests.filter((entry) => entry.url === "/v1/chat/completions")).toHaveLength(0);
		} finally {
			await upstream.close();
		}
	});

	it("passes an upstream failure and an empty summary through as errors", async () => {
		const failing = await start((req, body, res) => json(res, 500, { error: { message: "boom", type: "server_error" } }));
		try {
			const answer = await post(`${failing.url}/compact`, { model: "qwen3-coder", input: "x" });
			expect(answer.status).toBe(500);
			expect((await answer.json()).error.message).toBe("boom");
		} finally {
			await failing.upstream.close();
		}
		const empty = await start(reply(""));
		try {
			const answer = await post(`${empty.url}/compact`, { model: "qwen3-coder", input: "x" });
			expect(answer.status).toBe(502);
			expect((await answer.json()).error).toMatchObject({ code: "invalid_upstream_response" });
		} finally {
			await empty.upstream.close();
		}
	});
});

describe("automatic compaction with the response store", () => {
	it("keeps a compacting response without the history it replaced", async () => {
		const answers = ["A1", "SUM", "A2", "A3"];
		let turn = 0;
		const { upstream, url } = await start((req, body, res) => json(res, 200, completion(answers[turn++])));
		try {
			const first = await (await post(url, { model: "qwen3-coder", input: "first" })).json();
			const second = await (
				await post(url, {
					model: "qwen3-coder",
					input: "second",
					previous_response_id: first.id,
					context_management: [{ type: "compaction", compact_threshold: 10 }]
				})
			).json();
			expect(second.output.map((item) => item.type)).toEqual(["compaction", "message"]);
			expect(unsummarize(second.output[0].encrypted_content)).toBe("SUM");
			const turnBody = chatBody(upstream);
			expect(turnBody.messages.map((message) => message.role)).toEqual(["user", "user", "user"].slice(0, 2));
			const third = await post(url, { model: "qwen3-coder", input: "third", previous_response_id: second.id });
			expect(third.status).toBe(200);
			const replayed = chatBody(upstream).messages;
			expect(replayed.map((message) => message.role)).toEqual(["user", "user", "assistant", "user"]);
			expect(JSON.stringify(replayed)).not.toContain("first");
			expect(replayed[1].content).toBe(`${COMPACTED}\n\nSUM`);
		} finally {
			await upstream.close();
		}
	});
});

describe("compact edge cases", () => {
	const answer = (text) => (req, body, res) => json(res, 200, { ...completion(text), usage });

	it("compacts the stored history alone when the request has no input, and reports the usage to onUsage", async () => {
		const reports = [];
		const { upstream, url } = await start(answer("S"), {}, { onUsage: (report) => reports.push(report) });
		try {
			const first = await (await post(url, { model: "qwen3-coder", input: "remember 7" })).json();
			const reply = await post(`${url}/compact`, { model: "qwen3-coder", previous_response_id: first.id });
			expect(reply.status).toBe(200);
			expect((await reply.json()).output.at(-1).type).toBe("compaction");
			expect(reports).toHaveLength(2);
		} finally {
			await upstream.close();
		}
	});

	it("refuses previous_response_id when there is no response store", async () => {
		const { upstream, url } = await start(answer("S"), { settings: { responses: null } });
		try {
			const reply = await post(`${url}/compact`, { model: "qwen3-coder", input: "x", previous_response_id: "resp_1" });
			expect(reply.status).toBe(400);
			expect((await reply.json()).error).toMatchObject({ code: "unsupported_field", param: "previous_response_id" });
		} finally {
			await upstream.close();
		}
	});

	it("stops the upstream call when the client leaves", async () => {
		let seen = false;
		const { upstream, url } = await start(async (req, body, res) => {
			seen = true;
			await new Promise((resolve) => setTimeout(resolve, 400));
			json(res, 200, completion("late"));
		});
		try {
			const controller = new AbortController();
			const sent = fetch(`${url}/compact`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ model: "qwen3-coder", input: "x" }),
				signal: controller.signal
			});
			await new Promise((resolve) => setTimeout(resolve, 100));
			controller.abort();
			await expect(sent).rejects.toThrow();
			expect(seen).toBe(true);
		} finally {
			await upstream.close();
		}
	});

	it("treats a reply whose message has no text as no summary", async () => {
		const { upstream, url } = await start((req, body, res) =>
			json(res, 200, { ...completion("x"), choices: [{ index: 0, message: { role: "assistant", content: null }, finish_reason: "stop" }] })
		);
		try {
			const reply = await post(`${url}/compact`, { model: "qwen3-coder", input: "x" });
			expect(reply.status).toBe(502);
		} finally {
			await upstream.close();
		}
	});
});

describe("api.responses.compact", () => {
	it("refuses the stateful fields it cannot resolve", async () => {
		const upstream = await fakeVllm();
		try {
			const api = await make({ front: "openai", upstreams: [upstream.url] });
			await expect(api.responses.compact({ model: "qwen3-coder", input: "x", previous_response_id: "resp_1" })).rejects.toMatchObject({
				code: "unsupported_field",
				param: "previous_response_id"
			});
			await expect(api.responses.compact(null)).rejects.toMatchObject({ code: "invalid_request" });
			const bare = await api.responses.compact({ model: "qwen3-coder" });
			expect(bare.status).toBe(200);
		} finally {
			await upstream.close();
		}
	});
});

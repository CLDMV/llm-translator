/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/server/responses-state.test.vitest.mjs
 *	@Date: 2026-11-23T12:00:00-08:00 (1795550400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-23T12:00:00-08:00 (1795550400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The stateful Responses API over HTTP: `store`, `previous_response_id`, `conversation`, retrieval, deletion, input items, background
 * responses and cancelling, and the Conversations API.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, fakeTransport, make } from "../helpers/translator.mjs";
import { completion, fakeVllm, json, sse, textChunks } from "../helpers/fake-server.mjs";

afterEach(closeAll);

const send = (url, method, body, signal) =>
	fetch(url, {
		method,
		headers: body === undefined ? {} : { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
		signal
	});
const post = (url, body, signal) => send(url, "POST", body, signal);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (check, limit = 3000) => {
	const end = Date.now() + limit;
	while (Date.now() < end) {
		const value = await check();
		if (value) return value;
		await pause(10);
	}
	throw new Error("timed out");
};
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
		})
		.filter((frame) => frame.event);
const chats = (upstream) => upstream.requests.filter((entry) => entry.url === "/v1/chat/completions").map((entry) => entry.body);
const hello = { model: "qwen3-coder", input: "hi" };
const text = (response) => response.output.find((item) => item.type === "message")?.content[0].text;
const toolCall = (id, name, args) => ({ id, type: "function", function: { name, arguments: args } });
const weather = { type: "function", name: "weather", parameters: { type: "object", properties: { city: { type: "string" } } } };

/**
 * Start a translator on the OpenAI front with a fake vLLM upstream.
 * @param {object} [options] - `{ settings, upstream }` (fakeVllm options).
 * @returns {Promise<{ api: any, upstream: any, server: any, url: string }>} Handles.
 */
async function start(options = {}) {
	const upstream = await fakeVllm(options.upstream);
	const api = await make({
		front: "openai",
		upstreams: [{ url: upstream.url, backend: "compatible" }],
		detect: false,
		settings: options.settings
	});
	const server = await api.server.start({ port: 0, ...options.server });
	return { api, upstream, server, url: server.url };
}

/**
 * An upstream whose chat answers wait until `release()`, and which notes the requests the client closed.
 * @returns {{ options: object, release: Function, held: any[], closed: any[] }} Options for `start` and the controls.
 */
function slowUpstream() {
	const held = [];
	const closed = [];
	return {
		held,
		closed,
		release: (status = 200) => {
			for (const entry of held.splice(0)) {
				if (status === 200 && entry.body.stream) void sse(entry.res, textChunks(["Hello", " world"]));
				else if (status === 200) json(entry.res, 200, completion("Hello world"));
				else json(entry.res, status, { error: { message: "upstream broke", type: "server_error", code: "boom" } });
			}
		},
		options: {
			chat: (_req, body, res) => {
				held.push({ body, res });
				res.on("close", () => {
					if (!res.writableFinished) closed.push(body);
				});
			}
		}
	};
}

describe("stored responses", () => {
	it("keeps a response by default and serves it back, with its input items and in the order asked for", async () => {
		const { upstream, url } = await start();
		try {
			const made = await (await post(`${url}/v1/responses`, { ...hello, store: undefined })).json();
			expect(made).toMatchObject({ status: "completed", store: true, previous_response_id: null, background: false, conversation: null });
			const again = await send(`${url}/v1/responses/${made.id}`, "GET");
			expect(again.status).toBe(200);
			expect(await again.json()).toEqual(made);
			const input = {
				model: "qwen3-coder",
				input: [
					{ role: "user", content: "one" },
					{ role: "assistant", content: "two" },
					{ type: "message", role: "user", content: [{ type: "input_text", text: "three" }] }
				]
			};
			const three = await (await post(`${url}/v1/responses`, input)).json();
			const list = await (await send(`${url}/v1/responses/${three.id}/input_items`, "GET")).json();
			expect(list).toMatchObject({ object: "list", has_more: false, first_id: list.data[0].id, last_id: list.data[2].id });
			expect(list.data.map((item) => item.content[0].text)).toEqual(["three", "two", "one"]);
			expect(list.data[0]).toMatchObject({ id: expect.stringMatching(/^msg_/), type: "message", role: "user" });
			const asc = await (await send(`${url}/v1/responses/${three.id}/input_items?order=asc&limit=2`, "GET")).json();
			expect(asc.data.map((item) => item.content[0].text)).toEqual(["one", "two"]);
			expect(asc.has_more).toBe(true);
			const after = await (await send(`${url}/v1/responses/${three.id}/input_items?order=asc&after=${asc.last_id}`, "GET")).json();
			expect(after.data.map((item) => item.content[0].text)).toEqual(["three"]);
			const before = await (
				await send(`${url}/v1/responses/${three.id}/input_items?order=asc&before=${asc.last_id}&include=x`, "GET")
			).json();
			expect(before.data.map((item) => item.content[0].text)).toEqual(["one"]);
			const bad = await send(`${url}/v1/responses/${three.id}/input_items?limit=0`, "GET");
			expect(bad.status).toBe(400);
			expect((await bad.json()).error).toMatchObject({ type: "invalid_request_error", code: "invalid_limit", param: "limit" });
			const lost = await send(`${url}/v1/responses/${three.id}/input_items?after=msg_nope`, "GET");
			expect(lost.status).toBe(404);
			expect((await send(`${url}/v1/responses/resp_unknown00000/input_items`, "GET")).status).toBe(404);
			expect(chats(upstream)).toHaveLength(2);
		} finally {
			await upstream.close();
		}
	});

	it("does not keep a response made with store: false", async () => {
		const { upstream, url } = await start();
		try {
			const made = await (await post(`${url}/v1/responses`, { ...hello, store: false })).json();
			expect(made.store).toBe(false);
			expect((await send(`${url}/v1/responses/${made.id}`, "GET")).status).toBe(404);
			const streamed = await post(`${url}/v1/responses`, { ...hello, store: false, stream: true });
			const done = frames(await streamed.text()).at(-1);
			expect(done.event).toBe("response.completed");
			expect((await send(`${url}/v1/responses/${done.data.response.id}`, "GET")).status).toBe(404);
		} finally {
			await upstream.close();
		}
	});

	it("deletes a response, answers an unknown id in the OpenAI error shape", async () => {
		const { upstream, url } = await start();
		try {
			const made = await (await post(`${url}/v1/responses`, hello)).json();
			const gone = await send(`${url}/v1/responses/${made.id}`, "DELETE");
			expect(gone.status).toBe(200);
			expect(await gone.json()).toEqual({ id: made.id, object: "response.deleted", deleted: true });
			for (const method of ["GET", "DELETE"]) {
				const missing = await send(`${url}/v1/responses/${made.id}`, method);
				expect(missing.status).toBe(404);
				expect(await missing.json()).toEqual({
					error: {
						message: `Response with id '${made.id}' not found.`,
						type: "invalid_request_error",
						param: "response_id",
						code: "response_not_found"
					}
				});
			}
		} finally {
			await upstream.close();
		}
	});

	it("keeps a streamed response when its stream ends", async () => {
		const { upstream, url } = await start();
		try {
			const streamed = await post(`${url}/v1/responses`, { ...hello, stream: true });
			const done = frames(await streamed.text()).at(-1);
			const stored = await (await send(`${url}/v1/responses/${done.data.response.id}`, "GET")).json();
			expect(stored).toEqual(done.data.response);
			expect(text(stored)).toBe("Hello world");
			// A stream that fails is kept too, as failed.
			const broken = await start({
				upstream: { chat: (_req, _body, res) => sse(res, [{ error: { message: "bad", type: "x", code: "y" } }]) }
			});
			try {
				const failed = frames(await (await post(`${broken.url}/v1/responses`, { ...hello, stream: true })).text()).at(-1);
				expect(failed.event).toBe("response.failed");
				expect((await (await send(`${broken.url}/v1/responses/${failed.data.response.id}`, "GET")).json()).status).toBe("failed");
			} finally {
				await broken.upstream.close();
			}
		} finally {
			await upstream.close();
		}
	});

	it("turns the routes into responses_disabled errors when the responses setting is null", async () => {
		const { upstream, url } = await start({ settings: { responses: null } });
		try {
			for (const [method, path, body] of [
				["GET", "/v1/responses/resp_aaaaaaaaaaaa"],
				["DELETE", "/v1/responses/resp_aaaaaaaaaaaa"],
				["POST", "/v1/responses/resp_aaaaaaaaaaaa/cancel"],
				["GET", "/v1/responses/resp_aaaaaaaaaaaa/input_items"],
				["POST", "/v1/conversations", {}],
				["GET", "/v1/conversations/conv_aaaaaaaaaaaa"]
			]) {
				const reply = await send(`${url}${path}`, method, body);
				expect(reply.status).toBe(404);
				expect((await reply.json()).error.code).toBe("responses_disabled");
			}
		} finally {
			await upstream.close();
		}
	});

	it("has none of these routes on the Anthropic front", async () => {
		const upstream = await fakeVllm();
		try {
			const api = await make({ front: "anthropic", upstreams: [{ url: upstream.url, backend: "compatible" }], detect: false });
			const server = await api.server.start({ port: 0 });
			expect((await send(`${server.url}/v1/responses/resp_aaaaaaaaaaaa`, "GET")).status).toBe(404);
			expect((await send(`${server.url}/v1/conversations`, "POST", {})).status).toBe(404);
		} finally {
			await upstream.close();
		}
	});
});

describe("previous_response_id", () => {
	it("replays the stored input and output of the chain, in order, to the upstream", async () => {
		const { upstream, url } = await start();
		try {
			const first = await (await post(`${url}/v1/responses`, { ...hello, instructions: "be brief" })).json();
			const second = await (
				await post(`${url}/v1/responses`, { model: "qwen3-coder", input: "and then", previous_response_id: first.id })
			).json();
			expect(second).toMatchObject({ previous_response_id: first.id, store: true });
			const third = await (
				await post(`${url}/v1/responses`, { model: "qwen3-coder", input: "last", previous_response_id: second.id })
			).json();
			expect(third.previous_response_id).toBe(second.id);
			expect(chats(upstream).at(-1).messages).toEqual([
				{ role: "user", content: [{ type: "text", text: "hi" }] },
				{ role: "assistant", content: "Hello world" },
				{ role: "user", content: [{ type: "text", text: "and then" }] },
				{ role: "assistant", content: "Hello world" },
				{ role: "user", content: "last" }
			]);
			// The instructions of an earlier response are not carried over.
			expect(JSON.stringify(chats(upstream).at(-1))).not.toContain("be brief");
			// Only the response's own input is listed.
			const items = await (await send(`${url}/v1/responses/${third.id}/input_items`, "GET")).json();
			expect(items.data.map((item) => item.content[0].text)).toEqual(["last"]);
			// Deleting an earlier response does not break the chain.
			await send(`${url}/v1/responses/${first.id}`, "DELETE");
			const fourth = await post(`${url}/v1/responses`, { model: "qwen3-coder", input: "more", previous_response_id: third.id });
			expect(fourth.status).toBe(200);
			expect(chats(upstream).at(-1).messages).toHaveLength(7);
		} finally {
			await upstream.close();
		}
	});

	it("replays tool calls and their outputs, and works with a stream", async () => {
		const { upstream, url } = await start({
			upstream: {
				chat: (_req, body, res) =>
					body.messages.some((entry) => entry.role === "tool")
						? body.stream
							? sse(res, textChunks(["Rainy."]))
							: json(res, 200, completion("Rainy."))
						: json(res, 200, {
								id: "c",
								object: "chat.completion",
								created: 1,
								model: "qwen3-coder",
								choices: [
									{
										index: 0,
										message: { role: "assistant", content: null, tool_calls: [toolCall("call_1", "weather", '{"city":"Oslo"}')] },
										finish_reason: "tool_calls"
									}
								],
								usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 }
							})
			}
		});
		try {
			const first = await (await post(`${url}/v1/responses`, { ...hello, tools: [weather] })).json();
			const output = { type: "function_call_output", call_id: "call_1", output: "rain" };
			const second = await post(`${url}/v1/responses`, {
				...hello,
				input: [output],
				tools: [weather],
				previous_response_id: first.id,
				stream: true
			});
			const done = frames(await second.text()).at(-1);
			expect(done.event).toBe("response.completed");
			expect(text(done.data.response)).toBe("Rainy.");
			expect(chats(upstream).at(-1).messages).toEqual([
				{ role: "user", content: [{ type: "text", text: "hi" }] },
				{ role: "assistant", content: null, tool_calls: [toolCall("call_1", "weather", '{"city":"Oslo"}')] },
				{ role: "tool", tool_call_id: "call_1", content: "rain" }
			]);
			const items = await (await send(`${url}/v1/responses/${done.data.response.id}/input_items`, "GET")).json();
			expect(items.data).toMatchObject([{ type: "function_call_output", id: expect.stringMatching(/^fco_/), call_id: "call_1" }]);
		} finally {
			await upstream.close();
		}
	});

	it("answers an unknown id with the OpenAI 400, and refuses the other bad combinations", async () => {
		const { upstream, url } = await start();
		try {
			const unknown = await post(`${url}/v1/responses`, { ...hello, previous_response_id: "resp_nope00000000" });
			expect(unknown.status).toBe(400);
			expect((await unknown.json()).error).toEqual({
				message: "Previous response with id 'resp_nope00000000' not found.",
				type: "invalid_request_error",
				param: "previous_response_id",
				code: "previous_response_not_found"
			});
			const first = await (await post(`${url}/v1/responses`, hello)).json();
			const both = await post(`${url}/v1/responses`, { ...hello, previous_response_id: first.id, conversation: "conv_aaaaaaaaaaaa" });
			expect(both.status).toBe(400);
			expect((await both.json()).error.code).toBe("mutually_exclusive_parameters");
			const lonely = await post(`${url}/v1/responses`, { ...hello, background: true, store: false });
			expect(lonely.status).toBe(400);
			// An error in the new input names its position in the request, not in the replayed history.
			const wrong = await post(`${url}/v1/responses`, {
				...hello,
				input: [{ type: "file_search_call", id: "fs_1" }],
				previous_response_id: first.id
			});
			expect(wrong.status).toBe(400);
			expect((await wrong.json()).error).toMatchObject({ code: "unsupported_content", param: "input[0]" });
			expect(chats(upstream)).toHaveLength(1);
		} finally {
			await upstream.close();
		}
	});

	it("works with an Anthropic upstream", async () => {
		const transport = fakeTransport(() => ({
			body: {
				id: "msg_01",
				type: "message",
				role: "assistant",
				model: "claude-x",
				content: [{ type: "text", text: "Bonjour" }],
				stop_reason: "end_turn",
				stop_sequence: null,
				usage: { input_tokens: 10, output_tokens: 5 }
			}
		}));
		const api = await make({
			front: "openai",
			upstreams: [{ url: "https://api.anthropic.com", backend: "anthropic" }],
			detect: false,
			transport
		});
		const server = await api.server.start({ port: 0 });
		const first = await (await post(`${server.url}/v1/responses`, { model: "claude-x", input: "salut", max_output_tokens: 50 })).json();
		const second = await post(`${server.url}/v1/responses`, {
			model: "claude-x",
			input: "encore",
			max_output_tokens: 50,
			previous_response_id: first.id
		});
		expect(second.status).toBe(200);
		expect(JSON.parse(transport.calls.at(-1).init.body).messages).toEqual([
			{ role: "user", content: [{ type: "text", text: "salut" }] },
			{ role: "assistant", content: [{ type: "text", text: "Bonjour" }] },
			{ role: "user", content: [{ type: "text", text: "encore" }] }
		]);
	});
});

describe("conversations", () => {
	it("create, retrieve, update and delete a conversation", async () => {
		const { upstream, url } = await start();
		try {
			const created = await post(`${url}/v1/conversations`, {
				metadata: { topic: "demo" },
				items: [{ type: "message", role: "user", content: "remember 42" }]
			});
			expect(created.status).toBe(200);
			const conversation = await created.json();
			expect(conversation).toEqual({
				id: expect.stringMatching(/^conv_/),
				object: "conversation",
				created_at: expect.any(Number),
				metadata: { topic: "demo" }
			});
			expect(await (await send(`${url}/v1/conversations/${conversation.id}`, "GET")).json()).toEqual(conversation);
			const updated = await (await post(`${url}/v1/conversations/${conversation.id}`, { metadata: { topic: "changed" } })).json();
			expect(updated).toEqual({ ...conversation, metadata: { topic: "changed" } });
			const empty = await (await send(`${url}/v1/conversations`, "POST")).json();
			expect(empty.metadata).toEqual({});
			expect((await post(`${url}/v1/conversations/${conversation.id}`, {})).status).toBe(400);
			expect((await post(`${url}/v1/conversations/conv_nope00000000`, { metadata: {} })).status).toBe(404);
			expect(await (await send(`${url}/v1/conversations/${conversation.id}`, "DELETE")).json()).toEqual({
				id: conversation.id,
				object: "conversation.deleted",
				deleted: true
			});
			for (const method of ["GET", "DELETE"]) {
				const missing = await send(`${url}/v1/conversations/${conversation.id}`, method);
				expect(missing.status).toBe(404);
				expect((await missing.json()).error).toMatchObject({ code: "conversation_not_found", param: "conversation_id" });
			}
		} finally {
			await upstream.close();
		}
	});

	it("refuses a bad conversation body", async () => {
		const { upstream, url } = await start({ settings: { responses: { maxItems: 2 } } });
		try {
			const bad = [
				{ items: "x" },
				{ items: Array.from({ length: 21 }, () => ({ role: "user", content: "x" })) },
				{ items: [{ type: "file_search_call" }] },
				{
					items: [
						{ role: "user", content: "a" },
						{ role: "user", content: "b" },
						{ role: "user", content: "c" }
					]
				},
				{ metadata: { a: 1 } }
			];
			for (const body of bad) expect((await post(`${url}/v1/conversations`, body)).status).toBe(400);
		} finally {
			await upstream.close();
		}
	});

	it("answers a response from the conversation, and the response's input and output are added to it", async () => {
		const { upstream, url } = await start();
		try {
			const conversation = await (
				await post(`${url}/v1/conversations`, { items: [{ type: "message", role: "user", content: "my number is 42" }] })
			).json();
			const first = await (await post(`${url}/v1/responses`, { ...hello, input: "what is it?", conversation: conversation.id })).json();
			expect(first.conversation).toEqual({ id: conversation.id });
			expect(chats(upstream).at(-1).messages).toEqual([
				{ role: "user", content: [{ type: "text", text: "my number is 42" }] },
				{ role: "user", content: "what is it?" }
			]);
			const second = await await post(`${url}/v1/responses`, {
				...hello,
				input: "again",
				conversation: { id: conversation.id },
				stream: true
			})
				.then((reply) => reply.text())
				.then((body) => frames(body).at(-1).data.response);
			expect(second.conversation).toEqual({ id: conversation.id });
			expect(chats(upstream).at(-1).messages).toHaveLength(4);
			const items = await (await send(`${url}/v1/conversations/${conversation.id}/items?order=asc`, "GET")).json();
			expect(items.data.map((item) => item.role)).toEqual(["user", "user", "assistant", "user", "assistant"]);
			expect(items).toMatchObject({ object: "list", has_more: false, first_id: items.data[0].id, last_id: items.data[4].id });
			const newest = await (await send(`${url}/v1/conversations/${conversation.id}/items?limit=1`, "GET")).json();
			expect(newest.data[0].content[0].text).toBe("Hello world");
			expect(newest.has_more).toBe(true);
			const paged = await (
				await send(`${url}/v1/conversations/${conversation.id}/items?order=asc&after=${items.data[2].id}&limit=1`, "GET")
			).json();
			expect(paged.data.map((item) => item.id)).toEqual([items.data[3].id]);
			// A response kept with store: false adds nothing.
			await post(`${url}/v1/responses`, { ...hello, conversation: conversation.id, store: false });
			expect((await (await send(`${url}/v1/conversations/${conversation.id}/items`, "GET")).json()).data).toHaveLength(5);
			// The response that used it can still be retrieved and its input items listed.
			expect((await send(`${url}/v1/responses/${first.id}`, "GET")).status).toBe(200);
			const own = await (await send(`${url}/v1/responses/${first.id}/input_items`, "GET")).json();
			expect(own.data.map((item) => item.content[0].text)).toEqual(["what is it?"]);
			// A conversation that does not exist is a 404.
			const unknown = await post(`${url}/v1/responses`, { ...hello, conversation: "conv_nope00000000" });
			expect(unknown.status).toBe(404);
			expect((await unknown.json()).error).toMatchObject({ code: "conversation_not_found", param: "conversation" });
		} finally {
			await upstream.close();
		}
	});

	it("adds, lists, retrieves and deletes items", async () => {
		const { upstream, url } = await start();
		try {
			const conversation = await (await post(`${url}/v1/conversations`, {})).json();
			const base = `${url}/v1/conversations/${conversation.id}/items`;
			const added = await post(base, {
				items: [
					{ type: "message", role: "user", content: "a", id: "msg_mine" },
					{ type: "function_call", call_id: "c1", name: "f", arguments: "{}" },
					{ type: "function_call_output", call_id: "c1", output: "done" }
				]
			});
			expect(added.status).toBe(200);
			const list = await added.json();
			expect(list).toMatchObject({ object: "list", first_id: "msg_mine", has_more: false });
			expect(list.data.map((item) => item.type)).toEqual(["message", "function_call", "function_call_output"]);
			expect((await post(base, { items: [{ type: "message", role: "user", content: "a", id: "msg_mine" }] })).status).toBe(400);
			for (const body of [
				{},
				{ items: [] },
				{ items: "x" },
				{ items: Array.from({ length: 21 }, () => ({ role: "user", content: "x" })) }
			]) {
				expect((await post(base, body)).status).toBe(400);
			}
			expect((await post(`${url}/v1/conversations/conv_nope00000000/items`, { items: [{ role: "user", content: "a" }] })).status).toBe(404);
			const one = await send(`${base}/msg_mine`, "GET");
			expect((await one.json()).content).toEqual([{ type: "input_text", text: "a" }]);
			expect((await send(`${base}/msg_nope`, "GET")).status).toBe(404);
			expect((await send(`${url}/v1/conversations/conv_nope00000000/items/msg_mine`, "GET")).status).toBe(404);
			expect((await send(`${url}/v1/conversations/conv_nope00000000/items`, "GET")).status).toBe(404);
			const removed = await send(`${base}/msg_mine`, "DELETE");
			expect(await removed.json()).toEqual(conversation);
			expect((await send(`${base}/msg_mine`, "DELETE")).status).toBe(404);
			expect((await send(`${url}/v1/conversations/conv_nope00000000/items/msg_mine`, "DELETE")).status).toBe(404);
			expect((await (await send(base, "GET")).json()).data).toHaveLength(2);
		} finally {
			await upstream.close();
		}
	});
});

describe("background responses", () => {
	it("answers at once as queued, finishes in the background and can be retrieved", async () => {
		const slow = slowUpstream();
		const { upstream, url } = await start({ upstream: slow.options });
		try {
			const reply = await post(`${url}/v1/responses`, { ...hello, background: true });
			expect(reply.status).toBe(200);
			const queued = await reply.json();
			expect(queued).toMatchObject({ object: "response", status: "queued", background: true, store: true, output: [], usage: null });
			await until(() => slow.held.length === 1);
			expect((await (await send(`${url}/v1/responses/${queued.id}`, "GET")).json()).status).toBe("in_progress");
			slow.release();
			const done = await until(async () => {
				const current = await (await send(`${url}/v1/responses/${queued.id}`, "GET")).json();
				return current.status === "completed" ? current : null;
			});
			expect(done).toMatchObject({ id: queued.id, background: true, usage: { input_tokens: 12 } });
			expect(text(done)).toBe("Hello world");
			// It can be continued like any other response.
			const next = post(`${url}/v1/responses`, { ...hello, input: "more", previous_response_id: queued.id });
			await until(() => slow.held.length === 1);
			slow.release();
			expect((await next).status).toBe(200);
			// Deleting a finished background response leaves nothing to cancel.
			expect((await send(`${url}/v1/responses/${queued.id}`, "DELETE")).status).toBe(200);
		} finally {
			await upstream.close();
		}
	});

	it("reports the usage of a background response to onUsage, with the context the authorize hook returned", async () => {
		const reports = [];
		const { upstream, url } = await start({
			server: { authorize: () => ({ ok: true, context: "tenant-1" }), onUsage: (report, context) => reports.push({ report, context }) }
		});
		try {
			const queued = await (await post(`${url}/v1/responses`, { ...hello, background: true })).json();
			await until(() => reports.length === 1);
			expect(reports[0]).toMatchObject({ context: "tenant-1", report: { front: "openai", complete: true } });
			await until(async () => (await (await send(`${url}/v1/responses/${queued.id}`, "GET")).json()).status === "completed");
		} finally {
			await upstream.close();
		}
	});

	it("cancels a response that is running: the upstream request is aborted and the status is cancelled", async () => {
		const slow = slowUpstream();
		const { upstream, url } = await start({ upstream: slow.options });
		try {
			const queued = await (await post(`${url}/v1/responses`, { ...hello, background: true })).json();
			await until(() => slow.held.length === 1);
			// A response that is still running cannot be continued.
			const early = await post(`${url}/v1/responses`, { ...hello, previous_response_id: queued.id });
			expect(early.status).toBe(400);
			expect((await early.json()).error.code).toBe("previous_response_in_progress");
			const cancelled = await post(`${url}/v1/responses/${queued.id}/cancel`);
			expect(cancelled.status).toBe(200);
			expect(await cancelled.json()).toMatchObject({ id: queued.id, status: "cancelled", background: true });
			await until(() => slow.closed.length === 1);
			expect((await (await send(`${url}/v1/responses/${queued.id}`, "GET")).json()).status).toBe("cancelled");
			// Cancelling again changes nothing, and a late answer from the upstream does not replace the status.
			expect((await (await post(`${url}/v1/responses/${queued.id}/cancel`)).json()).status).toBe("cancelled");
			slow.release();
			await pause(50);
			expect((await (await send(`${url}/v1/responses/${queued.id}`, "GET")).json()).status).toBe("cancelled");
		} finally {
			await upstream.close();
		}
	});

	it("cancel refuses a response that was not made in the background, and a finished one is returned as it is", async () => {
		const { upstream, url } = await start();
		try {
			const plain = await (await post(`${url}/v1/responses`, hello)).json();
			const refused = await post(`${url}/v1/responses/${plain.id}/cancel`);
			expect(refused.status).toBe(400);
			expect((await refused.json()).error).toMatchObject({ message: "Cannot cancel a synchronous response.", code: "not_background" });
			const unknown = await post(`${url}/v1/responses/resp_nope00000000/cancel`);
			expect(unknown.status).toBe(404);
			const queued = await (await post(`${url}/v1/responses`, { ...hello, background: true })).json();
			await until(async () => (await (await send(`${url}/v1/responses/${queued.id}`, "GET")).json()).status === "completed");
			expect((await (await post(`${url}/v1/responses/${queued.id}/cancel`)).json()).status).toBe("completed");
		} finally {
			await upstream.close();
		}
	});

	it("deleting a running response cancels it", async () => {
		const slow = slowUpstream();
		const { upstream, url } = await start({ upstream: slow.options });
		try {
			const queued = await (await post(`${url}/v1/responses`, { ...hello, background: true })).json();
			await until(() => slow.held.length === 1);
			expect((await send(`${url}/v1/responses/${queued.id}`, "DELETE")).status).toBe(200);
			await until(() => slow.closed.length === 1);
			slow.release();
			await pause(50);
			expect((await send(`${url}/v1/responses/${queued.id}`, "GET")).status).toBe(404);
		} finally {
			await upstream.close();
		}
	});

	it("an upstream error makes a failed response", async () => {
		const slow = slowUpstream();
		const { upstream, url } = await start({ upstream: slow.options });
		try {
			const queued = await (await post(`${url}/v1/responses`, { ...hello, background: true })).json();
			await until(() => slow.held.length === 1);
			slow.release(500);
			const failed = await until(async () => {
				const current = await (await send(`${url}/v1/responses/${queued.id}`, "GET")).json();
				return current.status === "failed" ? current : null;
			});
			expect(failed.error).toEqual({ code: "boom", message: "upstream broke" });
		} finally {
			await upstream.close();
		}
	});

	it("streams a background response, keeps going when the client leaves, and serves the events again from any point", async () => {
		const slow = slowUpstream();
		const { upstream, url } = await start({ upstream: slow.options });
		try {
			const reply = await post(`${url}/v1/responses`, { ...hello, background: true, stream: true });
			expect(reply.headers.get("content-type")).toContain("text/event-stream");
			await until(() => slow.held.length === 1);
			slow.release();
			const events = frames(await reply.text());
			expect(events.map((frame) => frame.event)).toEqual(
				expect.arrayContaining(["response.created", "response.output_text.delta", "response.completed"])
			);
			const id = events[0].data.response.id;
			expect(events.at(-1).data.response).toMatchObject({ id, status: "completed", background: true });
			const stored = await (await send(`${url}/v1/responses/${id}`, "GET")).json();
			expect(stored).toEqual(events.at(-1).data.response);
			const again = frames(await (await send(`${url}/v1/responses/${id}?stream=true`, "GET")).text());
			expect(again).toEqual(events);
			const rest = frames(await (await send(`${url}/v1/responses/${id}?stream=true&starting_after=2`, "GET")).text());
			expect(rest.map((frame) => frame.data.sequence_number)).toEqual(events.slice(3).map((frame) => frame.data.sequence_number));
			for (const query of ["starting_after=x", "starting_after=-5"]) {
				const bad = await send(`${url}/v1/responses/${id}?stream=true&${query}`, "GET");
				expect(bad.status).toBe(400);
				expect((await bad.json()).error.param).toBe("starting_after");
			}
			// A client that leaves does not stop the response.
			const controller = new AbortController();
			const leaving = await post(`${url}/v1/responses`, { ...hello, background: true, stream: true }, controller.signal);
			await until(() => slow.held.length === 1);
			controller.abort();
			await leaving.body?.cancel().catch(() => {});
			await pause(50);
			expect(slow.closed).toHaveLength(0);
			slow.release();
			const [created] =
				(await until(async () => {
					const last = (await (await send(`${url}/v1/responses/${id}`, "GET")).json()).id;
					return last ? [last] : null;
				})) ?? [];
			expect(created).toBe(id);
			await until(() => chats(upstream).length === 2);
		} finally {
			await upstream.close();
		}
	});

	it("a streamed background response whose upstream fails has one event that says so, and a response that was not streamed has no stream to read", async () => {
		const slow = slowUpstream();
		const { upstream, url } = await start({ upstream: slow.options });
		try {
			const reply = await post(`${url}/v1/responses`, { ...hello, background: true, stream: true });
			await until(() => slow.held.length === 1);
			slow.release(500);
			const events = frames(await reply.text());
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({
				event: "response.failed",
				data: { sequence_number: 0, response: { status: "failed", error: { code: "boom" } } }
			});
			const asking = post(`${url}/v1/responses`, hello);
			await until(() => slow.held.length === 1);
			slow.release();
			const plain = await (await asking).json();
			const quiet = await send(`${url}/v1/responses/${plain.id}?stream=true`, "GET");
			expect(quiet.status).toBe(400);
			expect((await quiet.json()).error.code).toBe("stream_unavailable");
			const nonStreamed = await (await post(`${url}/v1/responses`, { ...hello, background: true })).json();
			await until(() => slow.held.length === 1);
			expect((await send(`${url}/v1/responses/${nonStreamed.id}?stream=true`, "GET")).status).toBe(400);
			slow.release();
		} finally {
			await upstream.close();
		}
	});

	it("a response with no job left (a restart with a directory store) is reported as failed", async () => {
		const slow = slowUpstream();
		const first = await start({
			upstream: slow.options,
			settings: { responses: { store: "disk", dir: `${process.cwd()}/tmp/responses-restart` } }
		});
		let id;
		try {
			id = (await (await post(`${first.url}/v1/responses`, { ...hello, background: true })).json()).id;
			await until(() => slow.held.length === 1);
			const second = await start({ settings: { responses: { store: "disk", dir: `${process.cwd()}/tmp/responses-restart` } } });
			try {
				const orphan = await (await send(`${second.url}/v1/responses/${id}`, "GET")).json();
				expect(orphan).toMatchObject({ status: "failed", error: { code: "server_error" } });
				// Nothing is running it, so there is nothing to cancel.
				expect((await (await post(`${second.url}/v1/responses/${id}/cancel`)).json()).status).toBe("failed");
			} finally {
				await second.upstream.close();
			}
		} finally {
			await first.upstream.close();
			const { rm } = await import("node:fs/promises");
			await rm(`${process.cwd()}/tmp/responses-restart`, { recursive: true, force: true });
		}
	});
});

describe("a custom store", () => {
	it("holds the records of a whole conversation through its own backend", async () => {
		const held = new Map();
		const calls = [];
		const store = {
			scan: async () => [],
			read: async (kind, id) => (calls.push("read"), held.get(`${kind}/${id}`) ?? null),
			write: async (kind, id, text) => (calls.push("write"), void held.set(`${kind}/${id}`, text)),
			erase: async (kind, id) => (calls.push("erase"), void held.delete(`${kind}/${id}`))
		};
		const { upstream, url } = await start({ settings: { responses: { store } } });
		try {
			const first = await (await post(`${url}/v1/responses`, hello)).json();
			expect(JSON.parse(held.get(`response/${first.id}`)).response.id).toBe(first.id);
			const second = await (await post(`${url}/v1/responses`, { ...hello, input: "more", previous_response_id: first.id })).json();
			expect(chats(upstream).at(-1).messages).toHaveLength(3);
			const conversation = await (await post(`${url}/v1/conversations`, { items: [{ role: "user", content: "hi" }] })).json();
			expect(held.has(`conversation/${conversation.id}`)).toBe(true);
			expect(await (await send(`${url}/v1/responses/${second.id}`, "GET")).json()).toEqual(second);
			expect((await send(`${url}/v1/responses/${first.id}`, "DELETE")).status).toBe(200);
			expect(held.has(`response/${first.id}`)).toBe(false);
			expect(calls).toEqual(expect.arrayContaining(["read", "write", "erase"]));
		} finally {
			await upstream.close();
		}
	});
});

describe("item references", () => {
	it("are resolved from stored responses and conversations, and an unknown id is a 400 on input", async () => {
		const { upstream, url } = await start();
		try {
			const first = await (await post(`${url}/v1/responses`, hello)).json();
			const output = first.output[0].id;
			const conversation = await (
				await post(`${url}/v1/conversations`, {
					items: [{ type: "message", role: "user", content: "kept in a conversation", id: "msg_kept" }]
				})
			).json();
			const second = await post(`${url}/v1/responses`, {
				...hello,
				input: [
					{ type: "item_reference", id: output },
					{ type: "item_reference", id: "msg_kept" },
					{ role: "user", content: "and now?" }
				]
			});
			expect(second.status).toBe(200);
			expect(chats(upstream).at(-1).messages).toEqual([
				{ role: "assistant", content: "Hello world" },
				{ role: "user", content: [{ type: "text", text: "kept in a conversation" }] },
				{ role: "user", content: "and now?" }
			]);
			const listed = await (await send(`${url}/v1/responses/${(await second.json()).id}/input_items?order=asc`, "GET")).json();
			expect(listed.data.map((item) => item.id)).not.toContain(output);
			expect(conversation.id).toMatch(/^conv_/);
			const unknown = await post(`${url}/v1/responses`, { ...hello, input: [{ type: "item_reference", id: "msg_nope" }] });
			expect(unknown.status).toBe(400);
			expect((await unknown.json()).error).toMatchObject({ code: "item_not_found", param: "input" });
		} finally {
			await upstream.close();
		}
	});

	it("are still refused when the responses setting is null", async () => {
		const { upstream, url } = await start({ settings: { responses: null } });
		try {
			const reply = await post(`${url}/v1/responses`, { ...hello, input: [{ type: "item_reference", id: "msg_1" }] });
			expect(reply.status).toBe(400);
			expect((await reply.json()).error).toMatchObject({ code: "unsupported_content", param: "input[0]" });
		} finally {
			await upstream.close();
		}
	});
});

describe("stored prompts", () => {
	const prompts = {
		support: {
			1: { instructions: "Old." },
			2: { instructions: "You answer for {{company}}.", input: [{ role: "user", content: "Context: {{context}}" }] }
		}
	};

	it("go ahead of the request's instructions and input, with the variables filled in and echoed", async () => {
		const { upstream, url } = await start({ settings: { responses: { prompts } } });
		try {
			const prompt = { id: "support", version: "2", variables: { company: "Acme", context: "gold plan" } };
			const reply = await post(`${url}/v1/responses`, { ...hello, instructions: "Be brief.", prompt });
			expect(reply.status).toBe(200);
			const made = await reply.json();
			expect(made.prompt).toEqual({ id: "support", version: "2", variables: prompt.variables });
			expect(chats(upstream).at(-1).messages).toEqual([
				{ role: "system", content: "You answer for Acme.\n\nBe brief." },
				{ role: "user", content: "Context: gold plan" },
				{ role: "user", content: "hi" }
			]);
			expect((await (await send(`${url}/v1/responses/${made.id}`, "GET")).json()).prompt).toEqual(made.prompt);
			const latest = await (await post(`${url}/v1/responses`, { model: "qwen3-coder", prompt: { ...prompt, version: undefined } })).json();
			expect(latest.prompt.version).toBe("2");
		} finally {
			await upstream.close();
		}
	});

	it("an unknown prompt, version or a missing variable is a 400 on prompt", async () => {
		const { upstream, url } = await start({ settings: { responses: { prompts } } });
		try {
			for (const [prompt, code] of [
				[{ id: "nope" }, "prompt_not_found"],
				[{ id: "support", version: "9" }, "prompt_version_not_found"],
				[{ id: "support", variables: { company: "Acme" } }, "prompt_variable_missing"],
				["support", "invalid_prompt"]
			]) {
				const reply = await post(`${url}/v1/responses`, { ...hello, prompt });
				expect(reply.status).toBe(400);
				expect((await reply.json()).error).toMatchObject({ code, param: "prompt" });
			}
			expect(chats(upstream)).toHaveLength(0);
		} finally {
			await upstream.close();
		}
	});
});

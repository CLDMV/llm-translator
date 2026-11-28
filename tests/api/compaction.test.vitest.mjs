/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/compaction.test.vitest.mjs
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
 * @fileoverview Automatic compaction: `context_management` with a `compaction` entry on a Responses request. The request converter's rules, the threshold check, the
 * summary step, the `compaction` item in the response (streamed too), the usage and the errors. Upstreams are mocked transports.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { openaiSse } from "../helpers/streams.mjs";
import { COMPACTED, unsummarize } from "../../src/lib/responses.mjs";
import { strip } from "../../src/lib/hostedtools.mjs";

afterEach(closeAll);

const toChat = (api) => api.convert.openai.responses.to.openai.chat;
const fromChat = (api) => api.convert.openai.chat.to.openai.responses;
const usage = (prompt, completion) => ({ prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion });
const completion = (content, tokens = usage(10, 5)) => ({
	id: "c",
	object: "chat.completion",
	created: 1,
	model: "qwen",
	choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
	usage: tokens
});
const chunks = (text, tokens) => [
	{
		id: "s",
		object: "chat.completion.chunk",
		created: 1,
		model: "qwen",
		choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }]
	},
	{ id: "s", object: "chat.completion.chunk", created: 1, model: "qwen", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
	{ id: "s", object: "chat.completion.chunk", created: 1, model: "qwen", choices: [], usage: tokens },
	"[DONE]"
];
const long = "word ".repeat(400);
const convo = [
	{ role: "user", content: `first ${long}` },
	{ type: "message", role: "assistant", content: [{ type: "output_text", text: `answer ${long}` }] },
	{ role: "user", content: "now" }
];
const manage = (threshold) => [{ type: "compaction", compact_threshold: threshold }];

/** A translator whose upstream answers with the scripted replies in order. */
async function start(replies, extra = {}) {
	let turn = 0;
	const transport = fakeTransport((target, init) => {
		const next = replies[turn++];
		if (next === undefined) throw new Error("the script ran out of replies");
		return typeof next === "function" ? next(init) : next;
	});
	const api = await make({
		front: "openai",
		upstreams: [{ url: "http://up.test", backend: "compatible", api: "chat", models: ["qwen"], ...extra }],
		detect: false,
		transport
	});
	return { api, transport };
}
const bodies = (transport) => transport.calls.map((call) => JSON.parse(call.init.body));
const run = async (api, body, options = {}) => {
	const { body: chat, state } = toChat(api).request(body);
	const reply = await api.send(chat, { wire: "responses", ...options });
	if (reply.status >= 400) return { reply };
	if (reply.stream) return { reply, events: await collect(fromChat(api).stream(reply.stream, state)) };
	return { reply, response: fromChat(api).response(reply.body, state) };
};
const ok = (body) => ({ body });

describe("the request converter", () => {
	it("keeps the first threshold on the chat body and refuses what is not a compaction or has no threshold", async () => {
		const { api } = await start([]);
		const request = (list) => toChat(api).request({ model: "qwen", input: "x", context_management: list });
		expect(request(manage(5000)).body.llmt_compact).toEqual({ threshold: 5000 });
		expect(request([...manage(7), ...manage(9)]).body.llmt_compact).toEqual({ threshold: 7 });
		expect(request([]).state.dropped).toEqual(["context_management"]);
		expect(request([]).body.llmt_compact).toBeUndefined();
		expect(() => request([{ type: "clear_tool_uses" }])).toThrowError(
			expect.objectContaining({ code: "unsupported_field", param: "context_management[0].type" })
		);
		expect(() => request([null])).toThrowError(expect.objectContaining({ code: "unsupported_field" }));
		for (const threshold of [undefined, 0, 1.5, "100"]) {
			expect(() => request([{ type: "compaction", compact_threshold: threshold }])).toThrowError(
				expect.objectContaining({ code: "invalid_request", param: "context_management[0].compact_threshold" })
			);
		}
	});

	it("is not sent upstream as a field, and a token count ignores it", async () => {
		const { api } = await start([]);
		const { body } = toChat(api).request({ model: "qwen", input: "x", context_management: manage(5) });
		expect(
			strip({
				...body,
				tools: [],
				messages: [
					{ role: "user", content: "x" },
					{ role: "assistant", content: null, llmt_native: { item: {}, at: "input[1]" } }
				]
			}).llmt_compact
		).toBeUndefined();
		expect((await api.token.count(body)).input_tokens).toBeGreaterThan(0);
	});
});

describe("below the threshold", () => {
	it("runs the turn as it is and adds nothing", async () => {
		const { api, transport } = await start([ok(completion("fine"))]);
		const { response } = await run(api, { model: "qwen", input: convo, context_management: manage(1000000) });
		expect(transport.calls).toHaveLength(1);
		expect(JSON.stringify(bodies(transport)[0])).not.toContain("llmt_");
		expect(response.output.map((item) => item.type)).toEqual(["message"]);
	});

	it("has nothing to compact when the request is one turn, or only system text", async () => {
		const { api, transport } = await start([ok(completion("a")), ok(completion("b"))]);
		await run(api, { model: "qwen", input: "just this", instructions: "be brief", context_management: manage(1) });
		await run(api, { model: "qwen", input: [{ role: "system", content: "only" }], context_management: manage(1) });
		expect(transport.calls).toHaveLength(2);
	});
});

describe("at the threshold", () => {
	it("summarises what came before the current turn, runs the turn on the summary and starts the response with a compaction item", async () => {
		const reports = [];
		const { api, transport } = await start([
			ok(completion("The user asked for words.", usage(100, 8))),
			ok(completion("Done.", usage(20, 4)))
		]);
		const { response, reply } = await run(
			api,
			{ model: "qwen", instructions: "be brief", input: convo, context_management: manage(50) },
			{ onUsage: (report) => reports.push(report) }
		);
		expect(transport.calls).toHaveLength(2);
		const [summing, turn] = bodies(transport);
		expect(summing.tools).toBeUndefined();
		expect(summing.messages.map((message) => message.role)).toEqual(["system", "user", "assistant", "user"]);
		expect(summing.messages.at(-1).content).toContain("Write a summary of the conversation above");
		expect(JSON.stringify(summing)).not.toContain("now");
		expect(turn.messages).toEqual(
			[
				{ role: "system", content: "be brief" },
				{ role: "user", content: `${COMPACTED}\n\nThe user asked for words.` },
				{ role: "user", content: [{ type: "text", text: "now" }] }
			].map((message, index) => (index === 2 ? { role: "user", content: "now" } : message))
		);
		expect(response.output.map((item) => item.type)).toEqual(["compaction", "message"]);
		expect(response.output[0].id).toMatch(/^cmp_[0-9a-f]{24}$/);
		expect(unsummarize(response.output[0].encrypted_content)).toBe("The user asked for words.");
		expect(response.output[1].content[0].text).toBe("Done.");
		expect(response.usage).toMatchObject({ input_tokens: 20, output_tokens: 4 });
		expect(await reply.usage).toMatchObject({ input_tokens: 120, output_tokens: 12, complete: true });
		expect(reports).toHaveLength(1);
	});

	it("streams the compaction item before the answer", async () => {
		const sse = (list) => ({ status: 200, body: openaiSse(list), headers: { "content-type": "text/event-stream" } });
		const { api } = await start([ok(completion("Summary.")), sse(chunks("Streamed.", usage(30, 6)))]);
		const { events, reply } = await run(api, { model: "qwen", input: convo, stream: true, context_management: manage(50) });
		const kinds = events
			.filter((event) => event.event.startsWith("response.output_item"))
			.map((event) => `${event.event}:${event.data.item.type}`);
		expect(kinds).toEqual([
			"response.output_item.added:compaction",
			"response.output_item.done:compaction",
			"response.output_item.added:message",
			"response.output_item.done:message"
		]);
		const added = events.find((event) => event.event === "response.output_item.added").data.item;
		expect(added).not.toHaveProperty("status");
		expect(events.at(-1).data.response.output.map((item) => item.type)).toEqual(["compaction", "message"]);
		expect(await reply.usage).toMatchObject({ input_tokens: expect.any(Number) });
	});

	it("answers the upstream's error for the summary, and an empty summary as a bad upstream reply", async () => {
		const failing = await start([{ status: 500, body: { error: { message: "boom", type: "server_error" } } }]);
		const first = await run(failing.api, { model: "qwen", input: convo, context_management: manage(50) });
		expect(first.reply.status).toBe(500);
		const empty = await start([ok(completion("   ")), ok(completion(null))]);
		const second = await run(empty.api, { model: "qwen", input: convo, context_management: manage(50) });
		expect(second.reply.status).toBe(502);
		const third = await run(empty.api, { model: "qwen", input: convo, context_management: manage(50) });
		expect(third.reply.status).toBe(502);
		expect(second.reply.body.error).toMatchObject({ code: "invalid_upstream_response" });
	});

	it("passes the error of the turn itself through, without a compaction item", async () => {
		const { api } = await start([
			ok(completion("Summary.")),
			{ status: 429, body: { error: { message: "slow", type: "rate_limit_error" } } }
		]);
		const { reply } = await run(api, { model: "qwen", input: convo, context_management: manage(50) });
		expect(reply.status).toBe(429);
	});

	it("is refused next to hosted tools sent natively", async () => {
		const { api, transport } = await start([], { api: "responses", settings: { hostedTools: "native" } });
		const { body } = toChat(api).request(
			{ model: "qwen", input: convo, tools: [{ type: "file_search" }], context_management: manage(50) },
			{ hostedTools: "native" }
		);
		const reply = await api.send(body, { wire: "responses" });
		expect(reply.status).toBe(400);
		expect(reply.body.error).toMatchObject({ code: "unsupported_field", param: "context_management" });
		expect(transport.calls).toHaveLength(0);
	});
});

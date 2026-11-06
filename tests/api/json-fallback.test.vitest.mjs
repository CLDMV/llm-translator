/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/json-fallback.test.vitest.mjs
 *	@Date: 2026-10-26T06:00:20-07:00 (1793019620)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-26T15:38:55-07:00 (1793054335)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { anthropicSse } from "../helpers/streams.mjs";

afterEach(closeAll);

const INSTRUCTION = "Respond with a single valid JSON object and nothing else.";
const REFUSAL = "output_config.format: Extra inputs are not permitted";
const failure = (message) => ({ status: 400, body: { type: "error", error: { type: "invalid_request_error", message } } });
const answer = {
	id: "msg_1",
	type: "message",
	role: "assistant",
	model: "claude-sonnet-5-5",
	content: [{ type: "text", text: "{}" }],
	stop_reason: "end_turn",
	stop_sequence: null,
	usage: { input_tokens: 3, output_tokens: 2 }
};
const streamed = () =>
	new Response(
		anthropicSse([
			{ data: { type: "message_start", message: { ...answer, content: [], usage: { input_tokens: 3, output_tokens: 0 } } } },
			{ data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
			{ data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "{}" } } },
			{ data: { type: "content_block_stop", index: 0 } },
			{ data: { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } } },
			{ data: { type: "message_stop" } }
		]),
		{ status: 200, headers: { "content-type": "text/event-stream" } }
	);
const jsonObject = {
	model: "claude-sonnet-5-5",
	max_tokens: 64,
	messages: [{ role: "user", content: "hi" }],
	response_format: { type: "json_object" }
};
const ownSchema = { type: "json_schema", json_schema: { name: "x", schema: { type: "object", properties: { a: { type: "string" } } } } };

/** A transport for an Anthropic upstream that refuses `output_config.format` with `message` and answers everything else. */
const picky = (message = REFUSAL, status = 400) =>
	fakeTransport((_url, init) => {
		const body = JSON.parse(init.body);
		if (body.output_config?.format) return { ...failure(message), status };
		return body.stream ? streamed() : { body: answer };
	});
const upstreamOf = (transport, settings, extra = {}) =>
	make({
		front: "openai",
		upstreams: [{ name: "a", url: "http://a.test", backend: "anthropic", settings }],
		transport,
		detect: false,
		...extra
	});
const sent = (transport) => transport.calls.map((call) => JSON.parse(call.init.body));

describe("retrying json_object as an instruction", () => {
	it("retries a refused schema once, warns, and remembers the endpoint and model", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const transport = picky();
			const api = await upstreamOf(transport, undefined, { logs: true });
			const first = await api.send(jsonObject);
			expect(first.status).toBe(200);
			expect(first.body.choices[0].message.content).toBe("{}");
			const [tried, retried] = sent(transport);
			expect(tried.output_config.format).toEqual({ type: "json_schema", schema: { type: "object" } });
			expect(retried.output_config?.format).toBeUndefined();
			expect(retried.system).toBe(INSTRUCTION);
			expect(warn).toHaveBeenCalledTimes(1);
			expect(warn.mock.calls[0][0]).toMatch(
				/Upstream a: claude-sonnet-5-5 rejected the json_object schema emulation \(400: "output_config\.format: Extra inputs are not permitted"\); sent it as a system instruction instead\..*jsonObject: "instruction"/
			);
			const second = await api.send(jsonObject);
			expect(second.status).toBe(200);
			// The remembered model goes straight to the instruction: one more call, no second warning.
			expect(transport.calls).toHaveLength(3);
			expect(sent(transport)[2].system).toBe(INSTRUCTION);
			expect(sent(transport)[2].output_config?.format).toBeUndefined();
			expect(warn).toHaveBeenCalledTimes(1);
		} finally {
			warn.mockRestore();
		}
	});

	it("retries a streaming request", async () => {
		const transport = picky("structured outputs are not supported");
		const api = await upstreamOf(transport);
		const reply = await api.send({ ...jsonObject, stream: true });
		expect(reply.status).toBe(200);
		const chunks = await collect(reply.stream);
		expect(chunks.length).toBeGreaterThan(0);
		expect(transport.calls).toHaveLength(2);
		expect(sent(transport)[1].stream).toBe(true);
		expect(sent(transport)[1].system).toBe(INSTRUCTION);
	});

	it("retries on any message, and on a 422", async () => {
		const transport = picky("whatever this server says", 422);
		const api = await upstreamOf(transport);
		expect((await api.send(jsonObject)).status).toBe(200);
		expect(transport.calls).toHaveLength(2);
	});

	it.each([401, 403, 404, 429])("does not retry a %i", async (status) => {
		const transport = picky(REFUSAL, status);
		const api = await upstreamOf(transport);
		expect((await api.send(jsonObject)).status).toBe(status);
		expect(transport.calls).toHaveLength(1);
	});

	it("returns the original error and remembers nothing when the retry fails too", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const transport = fakeTransport((_url, init) =>
				JSON.parse(init.body).output_config?.format
					? failure("schema nope")
					: { status: 500, body: { type: "error", error: { type: "api_error", message: "boom" } } }
			);
			const api = await upstreamOf(transport, undefined, { logs: true });
			const reply = await api.send(jsonObject);
			expect(reply.status).toBe(400);
			expect(JSON.stringify(reply.body)).toContain("schema nope");
			expect(transport.calls).toHaveLength(2);
			await api.send(jsonObject);
			// Nothing was remembered: the next request tries the schema again.
			expect(sent(transport)[2].output_config.format).toBeDefined();
			expect(warn).not.toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});

	it("does not retry when jsonObjectFallback is off", async () => {
		const transport = picky();
		const api = await upstreamOf(transport, { jsonObjectFallback: false });
		const reply = await api.send(jsonObject);
		expect(reply.status).toBe(400);
		expect(transport.calls).toHaveLength(1);
	});

	it("never retries a json_schema the client sent", async () => {
		const transport = picky();
		const api = await upstreamOf(transport);
		const reply = await api.send({ ...jsonObject, response_format: ownSchema });
		expect(reply.status).toBe(400);
		expect(transport.calls).toHaveLength(1);
	});

	it("sends no schema at all with jsonObject set to instruction", async () => {
		const transport = picky();
		const api = await upstreamOf(transport, { jsonObject: "instruction" });
		expect((await api.send(jsonObject)).status).toBe(200);
		expect(transport.calls).toHaveLength(1);
	});

	it("describes the attempt to callers of request", async () => {
		const api = await upstreamOf(picky());
		const schema = await api.request(jsonObject);
		expect(schema.json).toEqual({ sent: true, retry: true, key: "a\nclaude-sonnet-5-5" });
		const instruction = await api.request(jsonObject, { jsonObject: "instruction" });
		expect(instruction.json.sent).toBe(false);
		expect(instruction.body.system).toBe(INSTRUCTION);
		expect((await api.request({ ...jsonObject, response_format: ownSchema })).json.sent).toBe(false);
	});
});

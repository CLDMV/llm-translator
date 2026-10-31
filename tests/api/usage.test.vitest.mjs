/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/usage.test.vitest.mjs
 *	@Date: 2026-10-31T14:00:00-07:00 (1793480400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-31T14:00:00-07:00 (1793480400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Usage reporting from `send` (onUsage and reply.usage) and the `route` leaf.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { openaiSse } from "../helpers/streams.mjs";
import { meter, normalize } from "../../src/lib/usage.mjs";

afterEach(closeAll);

const base = { id: "chatcmpl-1", object: "chat.completion.chunk", created: 1, model: "qwen3-coder" };
const chunk = (delta, finish = null) => ({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] });
const openaiFrames = (usage) => [
	chunk({ role: "assistant", content: "" }),
	chunk({ content: "Hi" }),
	chunk({}, "stop"),
	...(usage ? [{ ...base, choices: [], usage }] : []),
	"[DONE]"
];
const usage = { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25, prompt_tokens_details: { cached_tokens: 8 } };
const completion = (withUsage = true) => ({
	id: "chatcmpl-1",
	object: "chat.completion",
	created: 1,
	model: "qwen3-coder",
	choices: [{ index: 0, message: { role: "assistant", content: "Hi" }, finish_reason: "stop" }],
	...(withUsage ? { usage } : {})
});
const sseReply = (text) => new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
const anthropicSse = (events) => events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
const message = {
	id: "msg_1",
	type: "message",
	role: "assistant",
	model: "claude-sonnet-5",
	content: [{ type: "text", text: "Hi" }],
	stop_reason: "end_turn",
	stop_sequence: null,
	usage: { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 4, cache_creation_input_tokens: 2 }
};
const nativeAnthropicStream = () =>
	anthropicSse([
		[
			"message_start",
			{
				type: "message_start",
				message: {
					...message,
					content: [],
					usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 4, cache_creation_input_tokens: 2 }
				}
			}
		],
		["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
		["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hi" } }],
		["content_block_stop", { type: "content_block_stop", index: 0 }],
		["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } }],
		["message_stop", { type: "message_stop" }]
	]);

const ask = { model: "qwen3-coder", max_tokens: 64, messages: [{ role: "user", content: "hi" }] };
const vllm = { url: "http://vllm.test", backend: "vllm", models: ["qwen3-coder"] };
const claude = { url: "https://api.anthropic.com", backend: "anthropic" };

describe("send usage reporting, Anthropic front", () => {
	it("reports a converted JSON reply through onUsage and reply.usage", async () => {
		const transport = fakeTransport(() => ({ body: completion() }));
		const api = await make({ upstreams: [vllm], transport, detect: false, aliases: { opus: "qwen3-coder" } });
		const onUsage = vi.fn();
		const reply = await api.send({ ...ask, model: "opus" }, { onUsage });
		expect(reply.body.type).toBe("message");
		const expected = {
			input_tokens: 12,
			output_tokens: 5,
			cache_read_input_tokens: 8,
			cache_creation_input_tokens: 0,
			reported: true,
			complete: true,
			reason: "done",
			model: "qwen3-coder",
			requested: "opus",
			upstream: "upstream-0",
			front: "anthropic",
			stream: false
		};
		expect(await reply.usage).toEqual(expected);
		expect(onUsage).toHaveBeenCalledTimes(1);
		expect(onUsage).toHaveBeenCalledWith(expected);
		expect(Object.keys(reply)).toEqual(["status", "headers", "body"]);
	});

	it("reports a converted stream once it ends, and passes every event through", async () => {
		const transport = fakeTransport(() => sseReply(openaiSse(openaiFrames(usage))));
		const api = await make({ upstreams: [vllm], transport, detect: false });
		const onUsage = vi.fn();
		const reply = await api.send({ ...ask, stream: true }, { onUsage });
		expect(onUsage).not.toHaveBeenCalled();
		const events = await collect(reply.stream);
		expect(events[0].event).toBe("message_start");
		expect(events.at(-1).event).toBe("message_stop");
		const report = await reply.usage;
		expect(report).toMatchObject({
			input_tokens: 12,
			output_tokens: 5,
			cache_read_input_tokens: 8,
			reported: true,
			complete: true,
			reason: "done",
			stream: true
		});
		expect(onUsage).toHaveBeenCalledTimes(1);
	});

	it("reports a native pass-through JSON reply and stream", async () => {
		const json = await make({ upstreams: [claude], transport: fakeTransport(() => ({ body: message })), detect: false });
		const reply = await json.send({ model: "claude-sonnet-5", max_tokens: 8, messages: [{ role: "user", content: "hi" }] });
		expect(await reply.usage).toMatchObject({
			input_tokens: 10,
			output_tokens: 3,
			cache_read_input_tokens: 4,
			cache_creation_input_tokens: 2,
			reported: true,
			complete: true,
			upstream: "upstream-0"
		});
		const live = await make({ upstreams: [claude], transport: fakeTransport(() => sseReply(nativeAnthropicStream())), detect: false });
		const streamed = await live.send({
			model: "claude-sonnet-5",
			max_tokens: 8,
			stream: true,
			messages: [{ role: "user", content: "hi" }]
		});
		const events = await collect(streamed.stream);
		expect(events.map((event) => event.event)).toContain("message_delta");
		// message_start carries input and cache; message_delta carries the cumulative output.
		expect(await streamed.usage).toMatchObject({
			input_tokens: 10,
			output_tokens: 3,
			cache_read_input_tokens: 4,
			cache_creation_input_tokens: 2,
			complete: true
		});
	});

	it("reports the usage seen so far when the stream is aborted", async () => {
		const controller = new AbortController();
		const transport = async (_url, init) =>
			new Response(
				new ReadableStream({
					start(stream) {
						const encoder = new TextEncoder();
						const head = nativeAnthropicStream().split("event: content_block_stop")[0];
						stream.enqueue(encoder.encode(head));
						init.signal.addEventListener("abort", () => stream.error(Object.assign(new Error("aborted"), { name: "AbortError" })));
					}
				}),
				{ status: 200, headers: { "content-type": "text/event-stream" } }
			);
		const api = await make({ upstreams: [claude], transport, detect: false });
		const reply = await api.send(
			{ model: "claude-sonnet-5", max_tokens: 8, stream: true, messages: [{ role: "user", content: "hi" }] },
			{ signal: controller.signal }
		);
		const seen = [];
		const reading = (async () => {
			for await (const event of reply.stream) {
				seen.push(event.event);
				if (event.event === "content_block_delta") setTimeout(() => controller.abort(), 0);
			}
		})();
		await expect(reading).rejects.toMatchObject({ name: "AbortError" });
		expect(await reply.usage).toMatchObject({ input_tokens: 10, output_tokens: 1, reported: true, complete: false, reason: "aborted" });
	});

	it("reports reason error when the stream breaks, in-band or by throwing", async () => {
		const broken = () =>
			new Response(
				new ReadableStream({
					start(stream) {
						stream.enqueue(new TextEncoder().encode(openaiSse(openaiFrames(null).slice(0, 2))));
						stream.error(new Error("socket hang up"));
					}
				}),
				{ status: 200, headers: { "content-type": "text/event-stream" } }
			);
		// The converter ends the client stream with an in-band error event.
		const converted = await make({ upstreams: [vllm], transport: broken, detect: false });
		const reply = await converted.send({ ...ask, stream: true });
		expect((await collect(reply.stream)).at(-1).event).toBe("error");
		expect(await reply.usage).toMatchObject({ reported: false, complete: false, reason: "error", input_tokens: null, output_tokens: null });
		// A native pass-through stream throws.
		const native = await make({ front: "openai", upstreams: [vllm], transport: broken, detect: false });
		const thrown = await native.send({ ...ask, stream: true });
		await expect(collect(thrown.stream)).rejects.toThrow();
		expect(await thrown.usage).toMatchObject({ complete: false, reason: "error" });
	});

	it("reports reason aborted when the consumer stops iterating early", async () => {
		const transport = fakeTransport(() => sseReply(nativeAnthropicStream()));
		const api = await make({ upstreams: [claude], transport, detect: false });
		const onUsage = vi.fn();
		const reply = await api.send(
			{ model: "claude-sonnet-5", max_tokens: 8, stream: true, messages: [{ role: "user", content: "hi" }] },
			{ onUsage }
		);
		for await (const event of reply.stream) if (event.event === "message_start") break;
		expect(await reply.usage).toMatchObject({ input_tokens: 10, output_tokens: 1, complete: false, reason: "aborted" });
		expect(onUsage).toHaveBeenCalledTimes(1);
	});

	it("settles a stream returned before it was read", async () => {
		const api = await make({ upstreams: [claude], transport: fakeTransport(() => sseReply(nativeAnthropicStream())), detect: false });
		const reply = await api.send({ model: "claude-sonnet-5", max_tokens: 8, stream: true, messages: [{ role: "user", content: "hi" }] });
		await reply.stream.return();
		expect(await reply.usage).toMatchObject({ reported: false, complete: false, reason: "aborted" });
	});

	it("reports an upstream error status", async () => {
		const transport = fakeTransport(() => ({ status: 429, body: { error: { message: "slow down", type: "x", code: 429 } } }));
		const api = await make({ upstreams: [vllm], transport, detect: false });
		const onUsage = vi.fn();
		const reply = await api.send(ask, { onUsage });
		expect(reply.status).toBe(429);
		expect(await reply.usage).toMatchObject({
			reported: false,
			complete: false,
			reason: "upstream_error",
			model: "qwen3-coder",
			upstream: "upstream-0"
		});
		expect(onUsage).toHaveBeenCalledTimes(1);
	});

	it("reports a connection failure, a non-JSON body and an invalid body as errors", async () => {
		const down = await make({ upstreams: [vllm], transport: async () => Promise.reject(new Error("ECONNREFUSED")), detect: false });
		const failed = await down.send(ask);
		expect(failed.status).toBe(502);
		expect(await failed.usage).toMatchObject({ reason: "error", reported: false, complete: false });
		const text = await make({ upstreams: [vllm], transport: fakeTransport(() => ({ body: "oops" })), detect: false });
		const odd = await text.send(ask);
		expect(odd.status).toBe(502);
		expect(await odd.usage).toMatchObject({ reason: "error", upstream: "upstream-0" });
		const invalid = await text.send([]);
		expect(invalid.status).toBe(400);
		expect(await invalid.usage).toMatchObject({ reason: "error", model: null, requested: null, upstream: null, stream: false });
	});

	it("rethrows and reports an abort before any reply", async () => {
		const controller = new AbortController();
		const transport = async (_url, init) =>
			new Promise((_resolve, reject) =>
				init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))
			);
		const api = await make({ upstreams: [vllm], transport, detect: false });
		const onUsage = vi.fn();
		const pending = api.send(ask, { signal: controller.signal, onUsage });
		setTimeout(() => controller.abort(), 20);
		await expect(pending).rejects.toMatchObject({ name: "AbortError" });
		expect(onUsage).toHaveBeenCalledWith(expect.objectContaining({ reason: "aborted", complete: false }));
		const other = await make({
			upstreams: [vllm],
			transport: async () => Promise.reject(Object.assign(new Error("boom"), { name: "Boom" })),
			detect: false
		});
		const crashed = vi.fn();
		await expect(other.send(ask, { onUsage: crashed })).resolves.toMatchObject({ status: 502 });
		expect(crashed).toHaveBeenCalledWith(expect.objectContaining({ reason: "error" }));
	});

	it("says reported: false with null tokens when the upstream sent no usage", async () => {
		const json = await make({ upstreams: [vllm], transport: fakeTransport(() => ({ body: completion(false) })), detect: false });
		const reply = await json.send(ask);
		expect(await reply.usage).toMatchObject({
			reported: false,
			complete: true,
			reason: "done",
			input_tokens: null,
			output_tokens: null,
			cache_read_input_tokens: null,
			cache_creation_input_tokens: null
		});
		const live = await make({ upstreams: [vllm], transport: fakeTransport(() => sseReply(openaiSse(openaiFrames(null)))), detect: false });
		const stream = await live.send({ ...ask, stream: true });
		await collect(stream.stream);
		expect(await stream.usage).toMatchObject({ reported: false, complete: true, input_tokens: null });
	});

	it("keeps the reply intact and warns when onUsage throws or rejects", async () => {
		const transport = fakeTransport(() => ({ body: completion() }));
		const api = await make({ upstreams: [vllm], transport, detect: false, silent: false });
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			const thrown = await api.send(ask, {
				onUsage: () => {
					throw new Error("meter down");
				}
			});
			expect(thrown.status).toBe(200);
			expect((await thrown.usage).reported).toBe(true);
			const rejected = await api.send(ask, { onUsage: async () => Promise.reject(new Error("db down")) });
			expect(rejected.status).toBe(200);
			await new Promise((resolve) => setTimeout(resolve, 10));
			const lines = warn.mock.calls.map((call) => call[0]);
			expect(lines).toContain("[llm-translator] onUsage threw: meter down");
			expect(lines).toContain("[llm-translator] onUsage rejected: db down");
		} finally {
			warn.mockRestore();
		}
	});
});

describe("send usage reporting, OpenAI front", () => {
	it("reports JSON, converted streams and native streams", async () => {
		const json = await make({
			front: "openai",
			upstreams: [vllm],
			transport: fakeTransport(() => ({ body: completion() })),
			detect: false
		});
		const reply = await json.send(ask);
		expect(await reply.usage).toMatchObject({
			input_tokens: 12,
			output_tokens: 5,
			cache_read_input_tokens: 8,
			front: "openai",
			reported: true
		});

		const native = await make({
			front: "openai",
			upstreams: [vllm],
			transport: fakeTransport(() => sseReply(openaiSse(openaiFrames(usage)))),
			detect: false
		});
		const stream = await native.send({ ...ask, stream: true, stream_options: { include_usage: true } });
		const events = await collect(stream.stream);
		expect(events.at(-1).data).toBe("[DONE]");
		expect(await stream.usage).toMatchObject({ input_tokens: 12, output_tokens: 5, complete: true, stream: true, front: "openai" });

		const converted = await make({
			front: "openai",
			upstreams: [claude],
			transport: fakeTransport(() => sseReply(nativeAnthropicStream())),
			detect: false
		});
		const viaAnthropic = await converted.send({
			model: "claude-sonnet-5",
			max_tokens: 8,
			stream: true,
			stream_options: { include_usage: true },
			messages: [{ role: "user", content: "hi" }]
		});
		await collect(viaAnthropic.stream);
		expect(await viaAnthropic.usage).toMatchObject({ reported: true, complete: true, output_tokens: 3 });
	});

	it("a stream without a usage chunk is unreported", async () => {
		const api = await make({
			front: "openai",
			upstreams: [vllm],
			transport: fakeTransport(() => sseReply(openaiSse(openaiFrames(null)))),
			detect: false
		});
		const stream = await api.send({ ...ask, stream: true });
		await collect(stream.stream);
		expect(await stream.usage).toMatchObject({ reported: false, complete: true, output_tokens: null });
	});
});

describe("usage helpers", () => {
	it("normalize ignores missing and all-zero usage", () => {
		expect(normalize("anthropic", undefined)).toBeNull();
		expect(normalize("anthropic", { input_tokens: 0, output_tokens: 0 })).toBeNull();
		expect(normalize("openai", { prompt_tokens: 0, completion_tokens: 0 })).toBeNull();
		expect(normalize("anthropic", { input_tokens: 3 })).toEqual({
			input_tokens: 3,
			output_tokens: null,
			cache_read_input_tokens: null,
			cache_creation_input_tokens: null
		});
	});

	it("warns with the value itself when onUsage throws something that is not an Error", async () => {
		const lines = [];
		const m = meter(
			{ front: "anthropic", requested: null, model: null, upstream: null, stream: false },
			() => {
				throw "plain string";
			},
			(line) => lines.push(line)
		);
		m.finish("done");
		const rejecting = meter(
			{ front: "anthropic", requested: null, model: null, upstream: null, stream: false },
			async () => Promise.reject("rejected string"),
			(line) => lines.push(line)
		);
		rejecting.finish("done");
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(lines).toEqual(["onUsage threw: plain string", "onUsage rejected: rejected string"]);
	});

	it("the tracker forwards next/throw to the source and ignores non-object events", async () => {
		const m = meter({ front: "anthropic", requested: null, model: null, upstream: null, stream: true }, undefined, () => {});
		m.event("text");
		m.event(null);
		const thrown = [];
		const source = {
			[Symbol.asyncIterator]() {
				return this;
			},
			next: async () => ({ done: true }),
			throw: async (cause) => {
				thrown.push(cause);
				return { done: true };
			}
		};
		const wrapped = m.track(source);
		await wrapped.throw(new Error("x"));
		expect(thrown).toHaveLength(1);
		expect((await m.usage).reason).toBe("error");
		const plain = meter({ front: "anthropic", requested: null, model: null, upstream: null, stream: true }, undefined, () => {});
		const bare = plain.track({ [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true }) }) });
		await expect(bare.throw(new Error("y"))).rejects.toThrow("y");
		await expect(bare.return(1)).resolves.toEqual({ done: true, value: 1 });
	});
});

describe("route", () => {
	it("resolves aliases and routing without I/O", async () => {
		const transport = fakeTransport(() => {
			throw new Error("no I/O expected");
		});
		const api = await make({
			upstreams: [
				{ ...vllm, models: ["qwen3-coder", "other"] },
				{ ...claude, name: "claude" }
			],
			transport,
			detect: false,
			aliases: { opus: "qwen3-coder" }
		});
		expect(api.route({ model: "opus" })).toEqual({
			upstream: "upstream-0",
			model: "qwen3-coder",
			requested: "opus",
			protocol: "openai.chat",
			backend: "vllm",
			native: false,
			unserved: false
		});
		expect(api.route({ model: "claude-sonnet-5" })).toMatchObject({ upstream: "claude", protocol: "anthropic.messages", native: true });
		expect(api.route({ model: "nonexistent" })).toMatchObject({ unserved: true });
		expect(api.route({ model: "qwen3-coder" }, { front: "openai" })).toMatchObject({ upstream: "upstream-0", native: true });
		expect(transport.calls).toHaveLength(0);
	});

	it("rejects an invalid body like request does", async () => {
		const api = await make({ upstreams: [vllm], detect: false });
		for (const bad of [null, [], "text"]) {
			expect(() => api.route(bad)).toThrow(expect.objectContaining({ code: "invalid_body", status: 400 }));
			await expect(api.request(bad)).rejects.toMatchObject({ code: "invalid_body", status: 400 });
		}
	});
});

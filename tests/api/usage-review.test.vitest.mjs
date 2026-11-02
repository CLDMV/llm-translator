/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/usage-review.test.vitest.mjs
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

/**
 * @fileoverview Usage reporting details: terminal markers, unknown counts, forced OpenAI-front usage and route().backend.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { openaiSse } from "../helpers/streams.mjs";
import { fakeVllm } from "../helpers/fake-server.mjs";
import { normalize } from "../../src/lib/usage.mjs";
import { late } from "../../src/lib/routes.mjs";

afterEach(closeAll);

const base = { id: "chatcmpl-1", object: "chat.completion.chunk", created: 1, model: "qwen3-coder" };
const chunk = (delta, finish = null) => ({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] });
const sse = (text) => new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
const events = (list) => list.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join("");
const ask = { model: "qwen3-coder", max_tokens: 64, messages: [{ role: "user", content: "hi" }] };
const vllm = { url: "http://vllm.test", backend: "vllm", models: ["qwen3-coder"] };
const claude = { url: "https://api.anthropic.com", backend: "anthropic" };
const claudeAsk = { model: "claude-sonnet-5", max_tokens: 8, stream: true, messages: [{ role: "user", content: "hi" }] };
const start = [
	"message_start",
	{
		type: "message_start",
		message: {
			id: "msg_1",
			type: "message",
			role: "assistant",
			model: "claude-sonnet-5",
			content: [],
			usage: { input_tokens: 10, output_tokens: 1 }
		}
	}
];
const block = ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }];
const delta = [
	"message_delta",
	{ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } }
];
const stop = ["message_stop", { type: "message_stop" }];

describe("a stream is complete only after its terminal marker", () => {
	it("reports a truncated native Anthropic stream as an error", async () => {
		const api = await make({ upstreams: [claude], transport: fakeTransport(() => sse(events([start, block]))), detect: false });
		const reply = await api.send(claudeAsk);
		const seen = await collect(reply.stream);
		expect(seen.map((event) => event.event)).toEqual(["message_start", "content_block_start"]);
		expect(await reply.usage).toMatchObject({ complete: false, reason: "error", input_tokens: 10, output_tokens: 1 });
	});

	it("reports a complete native Anthropic stream as done", async () => {
		const api = await make({
			upstreams: [claude],
			transport: fakeTransport(() => sse(events([start, block, delta, stop]))),
			detect: false
		});
		const reply = await api.send(claudeAsk);
		await collect(reply.stream);
		expect(await reply.usage).toMatchObject({ complete: true, reason: "done" });
	});

	it("OpenAI front: only the [DONE] sentinel completes a stream", async () => {
		const run = async (frames) => {
			const api = await make({ front: "openai", upstreams: [vllm], transport: fakeTransport(() => sse(openaiSse(frames))), detect: false });
			const reply = await api.send({ ...ask, stream: true });
			await collect(reply.stream);
			return reply.usage;
		};
		const open = [chunk({ role: "assistant", content: "" }), chunk({ content: "Hi" })];
		expect(await run(open)).toMatchObject({ complete: false, reason: "error" });
		expect(await run([...open, "[DONE]"])).toMatchObject({ complete: true, reason: "done" });
		// A finish_reason chunk alone is not enough.
		expect(await run([...open, chunk({}, "stop")])).toMatchObject({ complete: false, reason: "error" });
	});

	it("a converted Anthropic-front stream that ends normally is done", async () => {
		const frames = [chunk({ role: "assistant", content: "" }), chunk({ content: "Hi" }), chunk({}, "stop"), "[DONE]"];
		const api = await make({ upstreams: [vllm], transport: fakeTransport(() => sse(openaiSse(frames))), detect: false });
		const reply = await api.send({ ...ask, stream: true });
		await collect(reply.stream);
		expect(await reply.usage).toMatchObject({ complete: true, reason: "done" });
	});
});

describe("unknown counts stay null", () => {
	const plain = {
		id: "c",
		object: "chat.completion",
		created: 1,
		model: "qwen3-coder",
		choices: [{ index: 0, message: { role: "assistant", content: "Hi" }, finish_reason: "stop" }]
	};

	it("Anthropic front over an OpenAI upstream without prompt details: cache fields are null", async () => {
		const json = await make({
			upstreams: [vllm],
			transport: fakeTransport(() => ({ body: { ...plain, usage: { prompt_tokens: 20, completion_tokens: 5 } } })),
			detect: false
		});
		const reply = await json.send(ask);
		// The client still receives numbers.
		expect(reply.body.usage).toEqual({ input_tokens: 20, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 });
		expect(await reply.usage).toMatchObject({
			input_tokens: 20,
			output_tokens: 5,
			cache_read_input_tokens: null,
			cache_creation_input_tokens: null,
			reported: true
		});
		const frames = [
			chunk({ role: "assistant", content: "" }),
			chunk({ content: "Hi" }),
			chunk({}, "stop"),
			{ ...base, choices: [], usage: { prompt_tokens: 20, completion_tokens: 5 } },
			"[DONE]"
		];
		const live = await make({ upstreams: [vllm], transport: fakeTransport(() => sse(openaiSse(frames))), detect: false });
		const stream = await live.send({ ...ask, stream: true });
		await collect(stream.stream);
		expect(await stream.usage).toMatchObject({
			input_tokens: 20,
			output_tokens: 5,
			cache_read_input_tokens: null,
			cache_creation_input_tokens: null,
			complete: true
		});
	});

	it("keeps real cache counts, and creation stays null", async () => {
		const json = await make({
			upstreams: [vllm],
			transport: fakeTransport(() => ({
				body: { ...plain, usage: { prompt_tokens: 20, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 8 } } }
			})),
			detect: false
		});
		expect(await (await json.send(ask)).usage).toMatchObject({
			input_tokens: 12,
			cache_read_input_tokens: 8,
			cache_creation_input_tokens: null
		});
	});

	it("an upstream without usage over the converter is still unreported", async () => {
		const json = await make({ upstreams: [vllm], transport: fakeTransport(() => ({ body: plain })), detect: false });
		expect(await (await json.send(ask)).usage).toMatchObject({ reported: false, input_tokens: null, cache_read_input_tokens: null });
	});

	it("OpenAI front: partial usage fields are null, not 0", async () => {
		const json = await make({
			front: "openai",
			upstreams: [vllm],
			transport: fakeTransport(() => ({ body: { ...plain, usage: { completion_tokens: 5 } } })),
			detect: false
		});
		expect(await (await json.send(ask)).usage).toMatchObject({
			input_tokens: null,
			output_tokens: 5,
			cache_read_input_tokens: null,
			cache_creation_input_tokens: null
		});
	});
});

describe("OpenAI-front streams are always metered", () => {
	const frames = [
		chunk({ role: "assistant", content: "" }),
		chunk({ content: "Hi" }),
		chunk({}, "stop"),
		{ ...base, choices: [], usage: { prompt_tokens: 20, completion_tokens: 5 } },
		"[DONE]"
	];
	const usageChunks = (list) => list.filter((event) => Array.isArray(event.data?.choices) && event.data.choices.length === 0);

	it("native pass-through: include_usage is forced upstream and hidden from a client that did not ask", async () => {
		const transport = fakeTransport(() => sse(openaiSse(frames)));
		const api = await make({ front: "openai", upstreams: [vllm], transport, detect: false });
		const quiet = await api.send({ ...ask, stream: true });
		const seen = await collect(quiet.stream);
		expect(JSON.parse(transport.calls[0].init.body).stream_options).toEqual({ include_usage: true });
		expect(usageChunks(seen)).toHaveLength(0);
		expect(seen.at(-1).data).toBe("[DONE]");
		expect(await quiet.usage).toMatchObject({ reported: true, input_tokens: 20, output_tokens: 5, complete: true });
		const asked = await api.send({ ...ask, stream: true, stream_options: { include_usage: true, continuous_usage_stats: false } });
		expect(usageChunks(await collect(asked.stream))).toHaveLength(1);
		expect(JSON.parse(transport.calls[1].init.body).stream_options).toEqual({ include_usage: true, continuous_usage_stats: false });
		const declined = await api.send({ ...ask, stream: true, stream_options: { include_usage: false } });
		expect(usageChunks(await collect(declined.stream))).toHaveLength(0);
		expect(JSON.parse(transport.calls[2].init.body).stream_options.include_usage).toBe(true);
		expect((await declined.usage).reported).toBe(true);
	});

	it("converted from an Anthropic upstream: the usage chunk is metered and hidden unless asked for", async () => {
		const reply = () => sse(events([start, block, delta, stop]));
		const api = await make({ front: "openai", upstreams: [claude], transport: fakeTransport(reply), detect: false });
		const body = { model: "claude-sonnet-5", max_tokens: 8, stream: true, messages: [{ role: "user", content: "hi" }] };
		const quiet = await api.send(body);
		expect(usageChunks(await collect(quiet.stream))).toHaveLength(0);
		expect(await quiet.usage).toMatchObject({ reported: true, output_tokens: 3, complete: true });
		const asked = await api.send({ ...body, stream_options: { include_usage: true } });
		expect(usageChunks(await collect(asked.stream))).toHaveLength(1);
	});

	it("does not force include_usage when streamUsage is off, and leaves the client's own stream_options alone", async () => {
		const transport = fakeTransport(() => sse(openaiSse(frames)));
		const api = await make({
			front: "openai",
			upstreams: [{ url: "https://api.openai.com", backend: "openai", models: ["qwen3-coder"] }],
			settings: { streamUsage: false },
			transport,
			detect: false
		});
		const quiet = await api.send({ ...ask, stream: true });
		await collect(quiet.stream);
		expect(JSON.parse(transport.calls[0].init.body).stream_options).toBeUndefined();
		const own = await api.send({ ...ask, stream: true, stream_options: { include_usage: true } });
		await collect(own.stream);
		expect(JSON.parse(transport.calls[1].init.body).stream_options).toEqual({ include_usage: true });
		const none = await make({
			front: "openai",
			upstreams: [{ url: "https://api.openai.com", backend: "openai", models: ["qwen3-coder"] }],
			settings: { streamUsage: false },
			transport: fakeTransport(() => sse(openaiSse([chunk({ content: "Hi" }), chunk({}, "stop"), "[DONE]"]))),
			detect: false
		});
		const bare = await none.send({ ...ask, stream: true });
		await collect(bare.stream);
		expect(await bare.usage).toMatchObject({ reported: false, complete: true, reason: "done" });
	});

	it("every OpenAI-front stream ends with [DONE]: pass-through from a vLLM fake and the Anthropic converter", async () => {
		const upstream = await fakeVllm();
		try {
			const api = await make({ front: "openai", upstreams: [upstream.url] });
			const reply = await api.send({ ...ask, stream: true });
			const seen = await collect(reply.stream);
			expect(seen.at(-1).data).toBe("[DONE]");
			expect(await reply.usage).toMatchObject({ complete: true, reason: "done", reported: true });
		} finally {
			await upstream.close();
		}
		const converted = await make({
			front: "openai",
			upstreams: [claude],
			transport: fakeTransport(() => sse(events([start, block, delta, stop]))),
			detect: false
		});
		const reply = await converted.send({
			model: "claude-sonnet-5",
			max_tokens: 8,
			stream: true,
			messages: [{ role: "user", content: "hi" }]
		});
		expect((await collect(reply.stream)).at(-1).data).toBe("[DONE]");
		expect(await reply.usage).toMatchObject({ complete: true, reason: "done" });
	});

	it("api.request leaves stream_options alone unless send asks for usage", async () => {
		const api = await make({ front: "openai", upstreams: [vllm], detect: false });
		const plain = await api.request({ ...ask, stream: true });
		expect(plain.body.stream_options).toBeUndefined();
		const metered = await api.request({ ...ask, stream: true }, { usage: true });
		expect(metered.body.stream_options).toEqual({ include_usage: true });
		const odd = await api.request({ ...ask, stream: true, stream_options: "nope" }, { usage: true });
		expect(odd.body.stream_options).toEqual({ include_usage: true });
	});
});

describe("OpenAI front over an Anthropic upstream keeps partial counts", () => {
	const body = { model: "claude-sonnet-5", max_tokens: 8, stream: true, messages: [{ role: "user", content: "hi" }] };
	const startWithCache = [
		"message_start",
		{
			type: "message_start",
			message: {
				id: "msg_1",
				type: "message",
				role: "assistant",
				model: "claude-sonnet-5",
				content: [],
				usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 4, cache_creation_input_tokens: 2 }
			}
		}
	];
	const broken = () => {
		let sent = false;
		return new Response(
			new ReadableStream({
				pull(stream) {
					if (sent) return stream.error(new Error("socket hang up"));
					sent = true;
					stream.enqueue(new TextEncoder().encode(events([startWithCache, block])));
				}
			}),
			{ status: 200, headers: { "content-type": "text/event-stream" } }
		);
	};

	it("a stream that fails partway still reports what message_start carried", async () => {
		const api = await make({ front: "openai", upstreams: [claude], transport: broken, detect: false });
		const reply = await api.send(body);
		await collect(reply.stream);
		expect(await reply.usage).toMatchObject({
			reported: true,
			complete: false,
			reason: "error",
			input_tokens: 12,
			output_tokens: 1,
			cache_read_input_tokens: 4,
			cache_creation_input_tokens: null
		});
	});

	it("normal completion reports the same numbers as before: delta output, creation folded into input", async () => {
		const api = await make({
			front: "openai",
			upstreams: [claude],
			transport: fakeTransport(() => sse(events([startWithCache, block, delta, stop]))),
			detect: false
		});
		const reply = await api.send(body);
		await collect(reply.stream);
		expect(await reply.usage).toMatchObject({
			complete: true,
			reason: "done",
			input_tokens: 12,
			output_tokens: 3,
			cache_read_input_tokens: 4,
			cache_creation_input_tokens: null
		});
	});

	it("a JSON reply is metered from the upstream's usage too", async () => {
		const message = {
			id: "msg_1",
			type: "message",
			role: "assistant",
			model: "claude-sonnet-5",
			content: [{ type: "text", text: "Hi" }],
			stop_reason: "end_turn",
			stop_sequence: null,
			usage: { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
		};
		const api = await make({ front: "openai", upstreams: [claude], transport: fakeTransport(() => ({ body: message })), detect: false });
		const reply = await api.send({ ...body, stream: false });
		expect(await reply.usage).toMatchObject({
			input_tokens: 10,
			output_tokens: 3,
			cache_read_input_tokens: null,
			cache_creation_input_tokens: null,
			complete: true
		});
	});

	it("normalize folds Anthropic usage and keeps missing fields null", () => {
		expect(normalize("folded", { output_tokens: 2 })).toEqual({
			input_tokens: null,
			output_tokens: 2,
			cache_read_input_tokens: null,
			cache_creation_input_tokens: null
		});
		expect(normalize("folded", { input_tokens: 5, cache_creation_input_tokens: 1, cache_read_input_tokens: 3 })).toMatchObject({
			input_tokens: 6,
			cache_read_input_tokens: 3
		});
	});
});

describe("route().backend", () => {
	it("is the detected driver, as status() reports, for an auto-detected endpoint", async () => {
		const upstream = await fakeVllm();
		try {
			const api = await make({ upstreams: [upstream.url] });
			const status = api.status().upstreams[0];
			expect(status.backend).toBe("auto");
			expect(status.driver).toBe("vllm");
			expect(api.route({ model: "qwen3-coder" }).backend).toBe("vllm");
		} finally {
			await upstream.close();
		}
	});
});

describe("late stream", () => {
	it("closes a stream that arrives after the consumer left", async () => {
		let release;
		const sending = new Promise((resolve) => {
			release = resolve;
		});
		const generator = late(sending, { front: "anthropic" }, "m");
		expect((await generator.next()).value.event).toBe("message_start");
		await generator.return();
		let closed = 0;
		release({ stream: { return: async () => closed++ } });
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(closed).toBe(1);
	});

	it("ignores a rejected upstream and a reply that is not a stream", async () => {
		const failing = Promise.reject(new Error("down"));
		failing.catch(() => {});
		const generator = late(failing, { front: "openai" }, "m");
		const pending = generator.next();
		await expect(pending).rejects.toThrow("down");
		const other = late(Promise.resolve({ body: { error: {} } }), { front: "openai" }, "m");
		const first = await other.next();
		expect(first.value.data).toEqual({ error: {} });
		await other.return();
		const early = late(Promise.resolve({ body: {} }), { front: "anthropic" }, "m");
		await early.next();
		await early.return();
	});
});

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/fanout.test.vitest.mjs
 *	@Date: 2026-11-08T12:00:00-08:00 (1794254400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-08T12:00:00-08:00 (1794254400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview `n` above 1 on the OpenAI front, answered by parallel upstream requests when the upstream speaks the Anthropic protocol.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { anthropicSse, openaiSse } from "../helpers/streams.mjs";
import { add, join, weave } from "../../src/lib/fanout.mjs";
import { combine } from "../../src/lib/usage.mjs";

afterEach(closeAll);

const claude = { url: "https://api.anthropic.com", backend: "anthropic" };
const vllm = { url: "http://vllm.test", backend: "vllm", models: ["qwen3-coder"] };
const ask = { model: "claude-sonnet-5", max_tokens: 64, messages: [{ role: "user", content: "hi" }] };

const message = (text, usage = { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 4, cache_creation_input_tokens: 2 }) => ({
	id: `msg_${text}`,
	type: "message",
	role: "assistant",
	model: "claude-sonnet-5",
	content: [{ type: "text", text }],
	stop_reason: "end_turn",
	stop_sequence: null,
	usage
});
const events = (text, usage = { input_tokens: 10, output_tokens: 3 }) =>
	anthropicSse([
		{ data: { type: "message_start", message: { ...message(text), content: [], usage: { ...usage, output_tokens: 1 } } } },
		{ data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } },
		{ data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } },
		{ data: { type: "content_block_stop", index: 0 } },
		{
			data: {
				type: "message_delta",
				delta: { stop_reason: "end_turn", stop_sequence: null },
				usage: { output_tokens: usage.output_tokens }
			}
		},
		{ data: { type: "message_stop" } }
	]);
const sse = (text) => new Response(text, { status: 200, headers: { "content-type": "text/event-stream" } });
/** A reply that never comes until the request is aborted. */
const hang = (init) =>
	new Promise((_, reject) =>
		init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })
	);
const letters = ["A", "B", "C"];
const texts = (body) => body.choices.map((choice) => choice.message.content);

describe("n above 1 against an Anthropic upstream, not streaming", () => {
	it("sends n requests without n, numbers the choices and sums the usage", async () => {
		let turn = 0;
		const transport = fakeTransport(() => ({ body: message(letters[turn++]) }));
		const reports = [];
		const api = await make({ front: "openai", upstreams: [claude], transport, detect: false });
		const reply = await api.send({ ...ask, n: 3 }, { onUsage: (report) => reports.push(report) });
		expect(reply.status).toBe(200);
		expect(transport.calls).toHaveLength(3);
		for (const call of transport.calls) expect(JSON.parse(call.init.body)).not.toHaveProperty("n");
		expect(reply.body.choices.map((choice) => choice.index)).toEqual([0, 1, 2]);
		expect(texts(reply.body).sort()).toEqual(letters);
		expect(reply.body.usage).toMatchObject({ prompt_tokens: 48, completion_tokens: 9, total_tokens: 57 });
		expect(reports).toHaveLength(1);
		expect(reports[0]).toMatchObject({
			input_tokens: 36,
			output_tokens: 9,
			cache_read_input_tokens: 12,
			complete: true,
			reason: "done",
			stream: false,
			front: "openai",
			requested: "claude-sonnet-5",
			upstream: expect.any(String)
		});
		expect(await reply.usage).toBe(reports[0]);
	});

	it("rejects an n above 128 and leaves other values to the converter", async () => {
		const transport = fakeTransport(() => ({ body: message("A") }));
		const api = await make({ front: "openai", upstreams: [claude], transport, detect: false });
		const big = await api.send({ ...ask, n: 129 });
		expect(big.status).toBe(400);
		expect(big.body.error.message).toMatch(/at most 128/);
		const odd = await api.send({ ...ask, n: 2.5 });
		expect(odd.status).toBe(400);
		expect(odd.body.error.message).toMatch(/single choice/);
		const ok = await api.send({ ...ask, n: 1 });
		expect(ok.status).toBe(200);
		expect(transport.calls).toHaveLength(1);
	});

	it("passes n through to an OpenAI-protocol upstream untouched", async () => {
		const transport = fakeTransport(() => ({
			body: { id: "c", object: "chat.completion", created: 1, model: "qwen3-coder", choices: [] }
		}));
		const api = await make({ front: "openai", upstreams: [vllm], transport, detect: false });
		await api.send({ model: "qwen3-coder", messages: [{ role: "user", content: "hi" }], n: 3 });
		expect(transport.calls).toHaveLength(1);
		expect(JSON.parse(transport.calls[0].init.body).n).toBe(3);
	});

	it("does not fan out on the Anthropic front", async () => {
		const transport = fakeTransport(() => ({ body: message("A") }));
		const api = await make({ front: "anthropic", upstreams: [claude], transport, detect: false });
		await api.send({ ...ask, n: 3 });
		expect(transport.calls).toHaveLength(1);
	});

	it("fails the whole request when one branch fails and aborts the others", async () => {
		let turn = 0;
		const aborted = [];
		const transport = fakeTransport(async (_url, init) => {
			const mine = turn++;
			if (mine === 1) return { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "bad" } } };
			try {
				return await hang(init);
			} catch (cause) {
				aborted.push(mine);
				throw cause;
			}
		});
		const reports = [];
		const api = await make({ front: "openai", upstreams: [claude], transport, detect: false });
		const reply = await api.send({ ...ask, n: 3 }, { onUsage: (report) => reports.push(report) });
		expect(reply.status).toBe(400);
		expect(reply.body.error.message).toBe("bad");
		expect(aborted.sort()).toEqual([0, 2]);
		expect(reports).toHaveLength(1);
		expect(reports[0]).toMatchObject({ reason: "upstream_error", complete: false });
		expect(await reply.usage).toBe(reports[0]);
	});

	it("rethrows a thrown failure after reporting once", async () => {
		let turn = 0;
		const transport = fakeTransport((_url, init) => {
			if (turn++ === 0) throw new Error("socket exploded");
			return hang(init);
		});
		const reports = [];
		const api = await make({ front: "openai", upstreams: [claude], transport, detect: false });
		await expect(api.send({ ...ask, n: 2 }, { onUsage: (report) => reports.push(report) })).resolves.toMatchObject({ status: 502 });
		expect(reports).toHaveLength(1);
	});

	it("aborts every branch when the caller aborts", async () => {
		const signals = [];
		const transport = fakeTransport((_url, init) => {
			signals.push(init.signal);
			return hang(init);
		});
		const reports = [];
		const controller = new AbortController();
		const api = await make({ front: "openai", upstreams: [claude], transport, detect: false });
		const sending = api.send({ ...ask, n: 3 }, { signal: controller.signal, onUsage: (report) => reports.push(report) });
		await vi.waitFor(() => expect(signals).toHaveLength(3));
		controller.abort();
		await expect(sending).rejects.toThrow();
		expect(signals.every((signal) => signal.aborted)).toBe(true);
		expect(reports).toHaveLength(1);
		expect(reports[0]).toMatchObject({ reason: "aborted", complete: false });
	});
});

describe("n above 1 against an Anthropic upstream, streaming", () => {
	const chat = { ...ask, n: 3, stream: true };
	const ids = (list) => list.map((item) => item.data?.id).filter(Boolean);

	it("interleaves the choices, sums the usage in one final chunk and ends once", async () => {
		let turn = 0;
		const transport = fakeTransport(() => sse(events(letters[turn++])));
		const reports = [];
		const api = await make({ front: "openai", upstreams: [claude], transport, detect: false });
		const reply = await api.send({ ...chat, stream_options: { include_usage: true } }, { onUsage: (report) => reports.push(report) });
		expect(reply.status).toBe(200);
		const out = await collect(reply.stream);
		const chunks = out.map((item) => item.data).filter((data) => data !== "[DONE]");
		expect(out.filter((item) => item.data === "[DONE]")).toHaveLength(1);
		expect(out.at(-1).data).toBe("[DONE]");
		const last = chunks.at(-1);
		expect(last.choices).toEqual([]);
		expect(last.usage).toMatchObject({ prompt_tokens: 30, completion_tokens: 9, total_tokens: 39 });
		expect(chunks.filter((chunk) => chunk.choices.length === 0)).toHaveLength(1);
		const body = chunks.filter((chunk) => chunk.choices.length > 0);
		expect(new Set(body.map((chunk) => chunk.choices[0].index))).toEqual(new Set([0, 1, 2]));
		expect(new Set(ids(out.map((item) => item)))).toHaveProperty("size", 1);
		const content = [0, 1, 2].map((index) =>
			body
				.filter((chunk) => chunk.choices[0].index === index)
				.map((chunk) => chunk.choices[0].delta.content ?? "")
				.join("")
		);
		expect(content.sort()).toEqual(letters);
		for (const index of [0, 1, 2]) {
			expect(body.filter((chunk) => chunk.choices[0].index === index && chunk.choices[0].finish_reason === "stop")).toHaveLength(1);
		}
		expect(reports).toHaveLength(1);
		expect(reports[0]).toMatchObject({ input_tokens: 30, output_tokens: 9, complete: true, reason: "done", stream: true });
		expect(await reply.usage).toBe(reports[0]);
	});

	it("sends no usage chunk unless the client asked for one", async () => {
		let turn = 0;
		const transport = fakeTransport(() => sse(events(letters[turn++])));
		const reports = [];
		const api = await make({ front: "openai", upstreams: [claude], transport, detect: false });
		const reply = await api.send(chat, { onUsage: (report) => reports.push(report) });
		const out = await collect(reply.stream);
		expect(out.filter((item) => item.data !== "[DONE]" && item.data.choices.length === 0)).toHaveLength(0);
		expect(out.filter((item) => item.data === "[DONE]")).toHaveLength(1);
		expect(reports[0]).toMatchObject({ output_tokens: 9, reason: "done" });
	});

	it("aborts every branch when the consumer stops reading", async () => {
		const signals = [];
		const transport = fakeTransport((_url, init) => {
			signals.push(init.signal);
			return sse(events("A"));
		});
		const reports = [];
		const api = await make({ front: "openai", upstreams: [claude], transport, detect: false });
		const reply = await api.send(chat, { onUsage: (report) => reports.push(report) });
		const iterator = reply.stream[Symbol.asyncIterator]();
		await iterator.next();
		await iterator.return();
		expect(signals.every((signal) => signal.aborted)).toBe(true);
		expect(await reply.usage).toMatchObject({ reason: "aborted", complete: false });
		expect(reports).toHaveLength(1);
	});

	it("fails the request when a branch fails before any byte was sent", async () => {
		let turn = 0;
		const transport = fakeTransport(() => {
			if (turn++ === 1) return { status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "bad" } } };
			return sse(events("A"));
		});
		const reports = [];
		const api = await make({ front: "openai", upstreams: [claude], transport, detect: false });
		const reply = await api.send(chat, { onUsage: (report) => reports.push(report) });
		expect(reply.status).toBe(400);
		expect(reply.stream).toBeUndefined();
		expect(reports).toHaveLength(1);
		expect(reports[0]).toMatchObject({ reason: "upstream_error" });
	});

	it("ends the stream with an error chunk when a branch fails after it started", async () => {
		let turn = 0;
		const failing = anthropicSse([
			{ data: { type: "message_start", message: { ...message("B"), content: [], usage: { input_tokens: 10, output_tokens: 1 } } } },
			{ data: { type: "error", error: { type: "overloaded_error", message: "overloaded" } } }
		]);
		const transport = fakeTransport(() => sse(turn++ === 1 ? failing : events("A")));
		const reports = [];
		const api = await make({ front: "openai", upstreams: [claude], transport, detect: false });
		const reply = await api.send(chat, { onUsage: (report) => reports.push(report) });
		const out = await collect(reply.stream);
		expect(out.at(-1).data).toBe("[DONE]");
		expect(out.at(-2).data.error.message).toBe("overloaded");
		expect(out.filter((item) => item.data === "[DONE]")).toHaveLength(1);
		expect(reports).toHaveLength(1);
		expect(reports[0]).toMatchObject({ reason: "error", complete: false });
	});
});

describe("fan-out helpers", () => {
	it("combines reports, summing estimates and keeping unknown fields null", () => {
		const report = (extra) => ({
			input_tokens: null,
			output_tokens: null,
			cache_read_input_tokens: null,
			cache_creation_input_tokens: null,
			reported: false,
			estimated: null,
			complete: true,
			reason: "done",
			model: null,
			requested: "m",
			upstream: null,
			front: "openai",
			stream: false,
			...extra
		});
		const out = combine([
			report({ estimated: { input_tokens: 4, output_tokens: null } }),
			report({ estimated: { input_tokens: 6, output_tokens: 2 }, model: "x", upstream: "u", input_tokens: 1, reported: true })
		]);
		expect(out).toMatchObject({
			input_tokens: 1,
			output_tokens: null,
			reported: true,
			estimated: { input_tokens: 10, output_tokens: 2 },
			complete: true,
			reason: "done",
			model: "x",
			upstream: "u"
		});
		expect(combine([report(), report({ reason: "aborted", complete: false })]).reason).toBe("aborted");
		expect(combine([report(), report({ reason: "error", complete: false })], 0).reason).toBe("done");
		expect(combine([report()]).estimated).toBeNull();
	});

	it("adds usage objects field by field", () => {
		expect(add({ a: 1, d: { x: 1 } }, { a: 2, b: 3, d: { x: 4 } })).toEqual({ a: 3, b: 3, d: { x: 5 } });
		expect(add(undefined, 2)).toBe(2);
		expect(add(1, undefined)).toBe(1);
	});

	it("joins bodies without usage", () => {
		const body = (text) => ({ id: "c", choices: [{ index: 0, message: { content: text } }] });
		expect(join([body("a"), body("b")])).toEqual({
			id: "c",
			choices: [
				{ index: 0, message: { content: "a" } },
				{ index: 1, message: { content: "b" } }
			]
		});
		expect(join([{ id: "c" }])).toEqual({ id: "c", choices: [] });
	});

	it("ends the merged stream with an error chunk when a branch throws, and cancels the rest", async () => {
		const closed = [];
		const throwing = {
			[Symbol.asyncIterator]: () => ({
				next: async () => {
					throw Object.assign(new Error("boom"), { type: "api_error" });
				},
				return: async () => closed.push("throwing")
			})
		};
		const slow = {
			[Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}), return: async () => closed.push("slow") })
		};
		const tripped = [];
		const aborted = vi.fn();
		const out = await collect(weave([slow, throwing], aborted, (index) => tripped.push(index)));
		expect(out).toHaveLength(2);
		expect(out[0].data.error).toMatchObject({ message: "boom", type: "api_error" });
		expect(out[1].data).toBe("[DONE]");
		expect(tripped).toEqual([1]);
		expect(aborted).toHaveBeenCalledOnce();
		expect(closed.sort()).toEqual(["slow", "throwing"]);
	});

	it("copes with a branch that fails while it is being finished after an error chunk", async () => {
		let step = 0;
		const failing = {
			[Symbol.asyncIterator]: () => ({
				next: async () => {
					if (step++ === 0) return { done: false, value: { data: { error: { message: "bad" } } } };
					throw new Error("again");
				}
			})
		};
		const out = await collect(
			weave(
				[failing],
				() => {},
				() => {}
			)
		);
		expect(out.map((item) => item.data.error?.message ?? item.data)).toEqual(["bad", "[DONE]"]);
	});

	it("reports a thrown value that is not an Error", async () => {
		const throwing = { [Symbol.asyncIterator]: () => ({ next: async () => Promise.reject("plain") }) };
		const out = await collect(
			weave(
				[throwing],
				() => {},
				() => {}
			)
		);
		expect(out[0].data.error).toMatchObject({ message: "plain", type: "server_error" });
	});

	it("can be thrown into and closed before it starts", async () => {
		const mk = () => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}), return: async () => ({ done: true }) }) });
		const first = weave(
			[mk()],
			() => {},
			() => {}
		);
		expect(await first.return("x")).toEqual({ done: true, value: "x" });
		const second = weave(
			[mk()],
			() => {},
			() => {}
		);
		await expect(second.throw(new Error("stop"))).rejects.toThrow("stop");
	});

	it("keeps events of other shapes in order", async () => {
		const chunk = { id: "c1", choices: [{ index: 0, delta: { content: "x" } }] };
		const source = {
			[Symbol.asyncIterator]: () => ({
				next: (() => {
					let i = 0;
					return async () => (i++ === 0 ? { done: false, value: { event: "message", data: chunk } } : { done: true });
				})()
			})
		};
		const out = await collect(
			weave(
				[source],
				() => {},
				() => {}
			)
		);
		expect(out[0]).toEqual({ event: "message", data: { id: "c1", choices: [{ index: 0, delta: { content: "x" } }] } });
		expect(openaiSse(["[DONE]"])).toContain("DONE");
	});
});

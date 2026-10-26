/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/sse.test.vitest.mjs
 *	@Date: 2026-10-25T12:21:17-07:00 (1792956077)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T13:31:31-07:00 (1792960291)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, make } from "../helpers/translator.mjs";

afterEach(closeAll);

const config = { upstreams: [{ url: "http://a.test", backend: "vllm" }], detect: false };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {number} gap - Delay before each event.
 * @param {number} count - Event count.
 * @returns {AsyncGenerator<object>} Slow event source.
 */
async function* slow(gap, count) {
	for (let index = 0; index < count; index++) {
		await pause(gap);
		yield { event: "content_block_delta", data: { index } };
	}
}

describe("sse.encode / sse.parse", () => {
	it("encodes events, [DONE] and comment frames", async () => {
		const api = await make(config);
		expect(api.sse.encode({ event: "ping", data: { type: "ping" } })).toBe('event: ping\ndata: {"type":"ping"}\n\n');
		expect(api.sse.encode({ data: "[DONE]" })).toBe("data: [DONE]\n\n");
		expect(api.sse.encode({ comment: "ping" })).toBe(": ping\n\n");
	});

	it("parses SSE text into messages with decoded data", async () => {
		const api = await make(config);
		const out = await collect(api.sse.parse('event: a\ndata: {"x":1}\n\ndata: [DONE]\n\n'));
		expect(out).toEqual([{ event: "a", data: { x: 1 } }, { data: "[DONE]" }]);
	});
});

describe("sse.ping", () => {
	it("yields Anthropic ping events while the source is silent", async () => {
		const api = await make({ ...config, settings: { pingInterval: 20 } });
		const out = await collect(api.sse.ping(slow(70, 1)));
		const pings = out.filter((event) => event.event === "ping");
		expect(pings.length).toBeGreaterThanOrEqual(2);
		expect(pings[0]).toEqual({ event: "ping", data: { type: "ping" } });
		expect(out.at(-1).event).toBe("content_block_delta");
	});

	it("sends empty deltas on the open content block, because Claude Code ignores ping events", async () => {
		const api = await make({ ...config, settings: { pingInterval: 15 } });
		const block = (index, type) => ({
			event: "content_block_start",
			data: { type: "content_block_start", index, content_block: { type } }
		});
		const stop = (index) => ({ event: "content_block_stop", data: { type: "content_block_stop", index } });
		const events = (async function* () {
			for (const [index, type] of [
				[0, "thinking"],
				[1, "text"],
				[2, "tool_use"],
				[3, "server_tool_use"]
			]) {
				yield block(index, type);
				await pause(60);
				yield stop(index);
			}
			await pause(60);
			yield { event: "message_stop", data: {} };
		})();
		const out = await collect(api.sse.ping(events));
		const during = (index) =>
			out.filter((event) => event.event === "content_block_delta" && event.data.index === index).map((event) => event.data.delta);
		expect(during(0).length).toBeGreaterThanOrEqual(1);
		expect(during(0).every((delta) => delta.type === "thinking_delta" && delta.thinking === "")).toBe(true);
		expect(during(1).every((delta) => delta.type === "text_delta" && delta.text === "")).toBe(true);
		expect(during(1).length).toBeGreaterThanOrEqual(1);
		expect(during(2).every((delta) => delta.type === "input_json_delta" && delta.partial_json === "")).toBe(true);
		expect(during(2).length).toBeGreaterThanOrEqual(1);
		// A block type without a no-op delta, and silence between blocks, fall back to a plain ping.
		expect(during(3)).toEqual([]);
		expect(out.filter((event) => event.event === "ping").length).toBeGreaterThanOrEqual(2);
	});

	it("yields comment frames for an OpenAI front", async () => {
		const api = await make({ ...config, front: "openai", settings: { pingInterval: 20 } });
		const out = await collect(api.sse.ping(slow(70, 1)));
		expect(out[0]).toEqual({ comment: "ping" });
	});

	it("honors explicit options and a disabled interval", async () => {
		const api = await make(config);
		const out = await collect(api.sse.ping(slow(30, 1), { interval: 0, front: "anthropic" }));
		expect(out).toHaveLength(1);
		const chatty = await collect(api.sse.ping(slow(70, 1), { interval: 20, front: "openai" }));
		expect(chatty[0]).toEqual({ comment: "ping" });
	});

	it("defaults to 10 seconds when no interval is configured", async () => {
		const api = await make(config);
		const out = await collect(api.sse.ping(slow(5, 2)));
		expect(out.map((event) => event.event)).toEqual(["content_block_delta", "content_block_delta"]);
	});
});

describe("ping timing", () => {
	it("measures silence since the last event handed to the client, not since the last upstream chunk", async () => {
		const api = await make({ ...config, settings: { pingInterval: 40 } });
		// A converter that is busy (many upstream chunks) but emits nothing for a long time.
		const buffering = (async function* () {
			yield { event: "message_start", data: {} };
			for (let chunk = 0; chunk < 10; chunk++) await pause(30);
			yield { event: "content_block_start", data: {} };
		})();
		const out = await collect(api.sse.ping(buffering));
		const names = out.map((event) => event.event);
		expect(names[0]).toBe("message_start");
		expect(names.at(-1)).toBe("content_block_start");
		expect(names.filter((name) => name === "ping").length).toBeGreaterThanOrEqual(5);
	});
});

describe("sse.write", () => {
	it("writes frames, pings included, to a writable", async () => {
		const api = await make(config);
		const target = new PassThrough();
		const chunks = [];
		target.on("data", (chunk) => chunks.push(chunk.toString()));
		const done = await api.sse.write(target, slow(60, 1), { interval: 20 });
		expect(done).toBe(true);
		const text = chunks.join("");
		expect(text).toContain("event: ping\n");
		expect(text).toContain("event: content_block_delta\n");
	});

	it("waits for drain under backpressure", async () => {
		const api = await make(config);
		const target = new PassThrough({ highWaterMark: 1 });
		const seen = [];
		target.pause();
		const writing = api.sse.write(target, slow(1, 3), { interval: 0 });
		await pause(30);
		target.on("data", (chunk) => seen.push(chunk.toString()));
		target.resume();
		expect(await writing).toBe(true);
		expect(seen.join("").match(/content_block_delta/g)).toHaveLength(3);
	});

	it("stops and closes the source when the writable is destroyed mid-stream", async () => {
		const api = await make(config);
		const target = new PassThrough();
		let closed = false;
		const source = (async function* () {
			try {
				yield { event: "a", data: {} };
				await pause(10);
				yield { event: "b", data: {} };
				yield { event: "c", data: {} };
			} finally {
				closed = true;
			}
		})();
		target.on("data", () => target.destroy());
		expect(await api.sse.write(target, source, { interval: 0 })).toBe(false);
		expect(closed).toBe(true);
	});

	it("returns false when the writable closes while waiting for drain", async () => {
		const api = await make(config);
		const target = new PassThrough({ highWaterMark: 1 });
		target.pause();
		const writing = api.sse.write(target, slow(1, 3), { interval: 0 });
		await pause(30);
		target.destroy();
		expect(await writing).toBe(false);
	});

	it("returns false when the writable has already ended", async () => {
		const api = await make(config);
		const target = new PassThrough();
		target.end();
		expect(await api.sse.write(target, slow(1, 1), { interval: 0 })).toBe(false);
	});
});

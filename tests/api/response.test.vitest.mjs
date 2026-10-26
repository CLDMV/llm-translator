/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/response.test.vitest.mjs
 *	@Date: 2026-10-25T12:19:55-07:00 (1792955995)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:02-07:00 (1792958342)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { completion, textChunks } from "../helpers/fake-server.mjs";

afterEach(closeAll);

const hello = { model: "qwen3-coder", max_tokens: 64, messages: [{ role: "user", content: "hi" }] };
const down = () => fakeTransport(() => ({ status: 500 }));
const sseText = (frames) => frames.map((frame) => `data: ${typeof frame === "string" ? frame : JSON.stringify(frame)}\n\n`).join("");
const hooks = new URL("../fixtures/driver/hooks", import.meta.url).pathname;

describe("response", () => {
	it("converts a Chat Completions body to an Anthropic message", async () => {
		const api = await make({ upstreams: [{ url: "http://vllm.test", backend: "vllm" }], detect: false });
		const { state } = await api.request(hello);
		const message = await api.response(completion("Hello world"), state);
		expect(message).toMatchObject({ type: "message", role: "assistant", model: "qwen3-coder", stop_reason: "end_turn" });
		expect(message.content).toEqual([{ type: "text", text: "Hello world" }]);
	});

	it("restores the client's model name on a native passthrough", async () => {
		const api = await make({
			front: "openai",
			upstreams: [{ url: "http://vllm.test", backend: "vllm" }],
			aliases: { "gpt-4o": "qwen3-coder" },
			detect: false
		});
		const { state } = await api.request({ model: "gpt-4o", messages: hello.messages });
		expect(await api.response(completion("x"), state)).toMatchObject({ model: "gpt-4o" });
		const bare = { id: "x" };
		expect(await api.response(bare, state)).toBe(bare);
		expect((await api.response(completion("x"), { ...state, model: undefined })).model).toBe("qwen3-coder");
	});

	it("runs the driver's response normalizer first", async () => {
		const api = await make({ front: "openai", upstreams: ["http://hooks.test"], transport: down() });
		await api.slothlet.api.add(["driver", "hooks"], hooks);
		await api.detect();
		const { state } = await api.request({ model: "m", messages: hello.messages });
		expect(await api.response(completion("x"), state)).toMatchObject({ hookedResponse: true });
	});

	it("converts an OpenAI front's reply from an Anthropic upstream", async () => {
		const api = await make({ front: "openai", upstreams: [{ url: "https://api.anthropic.com", backend: "anthropic" }], detect: false });
		const { state } = await api.request({ model: "claude-sonnet-5-5", messages: hello.messages });
		const reply = await api.response(
			{
				id: "msg_1",
				type: "message",
				role: "assistant",
				model: "claude-sonnet-5-5",
				content: [{ type: "text", text: "hey" }],
				stop_reason: "end_turn",
				usage: { input_tokens: 3, output_tokens: 2 }
			},
			state
		);
		expect(reply.choices[0].message.content).toBe("hey");
	});
});

describe("stream", () => {
	it("converts a vLLM chunk stream to Anthropic events ending in message_stop", async () => {
		const api = await make({ upstreams: [{ url: "http://vllm.test", backend: "vllm" }], detect: false });
		const { state } = await api.request({ ...hello, stream: true });
		const events = await collect(api.stream(sseText(textChunks(["Hello", " world"], { reasoning: ["hmm"] })), state));
		const names = events.map((event) => event.event);
		expect(names[0]).toBe("message_start");
		expect(names.at(-2)).toBe("message_delta");
		expect(names.at(-1)).toBe("message_stop");
		const text = events.filter((event) => event.data.delta?.type === "text_delta").map((event) => event.data.delta.text);
		expect(text.join("")).toBe("Hello world");
		expect(events.some((event) => event.data.delta?.type === "thinking_delta")).toBe(true);
	});

	it("passes the chunk stream through for a native OpenAI front, restoring the model and keeping [DONE]", async () => {
		const api = await make({
			front: "openai",
			upstreams: [{ url: "http://vllm.test", backend: "vllm" }],
			aliases: { "gpt-4o": "qwen3-coder" },
			detect: false
		});
		const { state } = await api.request({ model: "gpt-4o", messages: hello.messages, stream: true });
		const events = await collect(api.stream(sseText(textChunks(["a"])), state));
		expect(events.at(-1)).toEqual({ data: "[DONE]" });
		expect(events[0].data).toMatchObject({ object: "chat.completion.chunk", model: "gpt-4o" });
		expect(events.some((event) => event.data.usage)).toBe(true);
	});

	it("restores the model inside message_start on a native Anthropic stream and leaves other events alone", async () => {
		const api = await make({
			upstreams: [{ url: "https://api.anthropic.com", backend: "anthropic" }],
			aliases: { mine: "claude-sonnet-5-5" },
			detect: false
		});
		const { state } = await api.request({ ...hello, model: "mine", stream: true });
		const wire =
			'event: message_start\ndata: {"type":"message_start","message":{"id":"m","model":"claude-sonnet-5-5","content":[]}}\n\n' +
			'event: ping\ndata: {"type":"ping"}\n\n' +
			'event: message_stop\ndata: {"type":"message_stop"}\n\n';
		const events = await collect(api.stream(wire, state));
		expect(events.map((event) => event.event)).toEqual(["message_start", "ping", "message_stop"]);
		expect(events[0].data.message.model).toBe("mine");
		expect(events[1].data).toEqual({ type: "ping" });
	});

	it("applies the driver's chunk normalizer on both the converting and the native path", async () => {
		const converting = await make({ upstreams: ["http://hooks.test"], transport: down() });
		await converting.slothlet.api.add(["driver", "hooks"], hooks);
		await converting.detect();
		const first = await converting.request({ ...hello, stream: true });
		const events = await collect(converting.stream(sseText(textChunks(["x"])), first.state));
		expect(events.at(-1).event).toBe("message_stop");

		const native = await make({ front: "openai", upstreams: ["http://hooks.test"], transport: down() });
		await native.slothlet.api.add(["driver", "hooks"], hooks);
		await native.detect();
		const second = await native.request({ model: "m", messages: hello.messages, stream: true });
		const chunks = await collect(native.stream(sseText(textChunks(["x"])), second.state));
		expect(chunks[0].data.hookedChunk).toBe(true);
		expect(chunks.at(-1).data).toBe("[DONE]");
	});

	it("turns a mid-stream upstream error into an Anthropic error event", async () => {
		const api = await make({ upstreams: [{ url: "http://vllm.test", backend: "vllm" }], detect: false });
		const { state } = await api.request({ ...hello, stream: true });
		const events = await collect(
			api.stream(
				sseText(
					textChunks(["a"])
						.slice(0, 2)
						.concat([{ error: { message: "engine died", type: "InternalServerError", code: 500 } }, "[DONE]"])
				),
				state
			)
		);
		expect(events.at(-1).event).toBe("error");
	});

	it("closes the upstream source when the consumer stops early", async () => {
		const api = await make({ upstreams: [{ url: "http://vllm.test", backend: "vllm" }], detect: false });
		const { state } = await api.request({ ...hello, stream: true });
		let closed = false;
		const source = (async function* () {
			try {
				for (const frame of textChunks(["a", "b", "c"])) yield `data: ${typeof frame === "string" ? frame : JSON.stringify(frame)}\n\n`;
			} finally {
				closed = true;
			}
		})();
		for await (const event of api.stream(source, state)) {
			if (event.event === "content_block_start") break;
		}
		expect(closed).toBe(true);
	});
});

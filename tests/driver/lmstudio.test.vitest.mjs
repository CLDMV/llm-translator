/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/driver/lmstudio.test.vitest.mjs
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
 * @fileoverview LM Studio driver: strict detection through `/api/v0/models`, and streamed tool calls whose later chunks carry `id: null`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { openaiSse } from "../helpers/streams.mjs";
import { isLmstudioModels } from "../../src/lib/backends.mjs";

afterEach(closeAll);

const entry = (extra = {}) => ({
	id: "qwen/qwen3-4b",
	object: "model",
	type: "llm",
	publisher: "qwen",
	arch: "qwen3",
	compatibility_type: "gguf",
	quantization: "Q4_K_M",
	state: "loaded",
	max_context_length: 40960,
	...extra
});
const listing = (...data) => ({ object: "list", data });
const server = (paths) =>
	fakeTransport((url) => {
		const path = new URL(url).pathname;
		return path in paths ? { body: paths[path] } : { status: 404, body: { error: "not found" } };
	});

describe("lmstudio detection", () => {
	it("is bound through /api/v0/models, with chat models and the loaded ones as facts", async () => {
		const api = await make({
			upstreams: ["http://lms.test"],
			transport: server({
				"/api/v0/models": listing(
					entry(),
					entry({ id: "meta/llama", state: "not-loaded", type: "vlm" }),
					entry({ id: "nomic", type: "embeddings", state: "not-loaded" })
				)
			})
		});
		expect(api.status().upstreams[0]).toMatchObject({ driver: "lmstudio", protocol: "openai.chat" });
		expect(api.driver.lmstudio.info()).toMatchObject({ order: 55, probes: ["/api/v0/models"] });
		expect(api.driver.lmstudio.settings()).toMatchObject({ topK: false, prefill: "none" });
		const facts = await api.driver.lmstudio.detect({
			endpoint: { url: "http://lms.test" },
			transport: server({
				"/api/v0/models": listing(entry(), entry({ id: "b", state: "not-loaded" }), entry({ id: "e", type: "embeddings" }))
			})
		});
		expect(facts).toEqual({ models: ["qwen/qwen3-4b", "b"], loaded: ["qwen/qwen3-4b"] });
	});

	it("never binds another server: the listing must be LM Studio's exactly", async () => {
		const generic = { object: "list", data: [{ id: "m", object: "model", owned_by: "x" }] };
		const other = await make({ upstreams: ["http://x.test"], transport: server({ "/api/v0/models": generic, "/v1/models": generic }) });
		expect(other.status().upstreams[0].driver).toBe("compatible");
		const missing = await make({ upstreams: ["http://y.test"], transport: server({}) });
		expect(missing.status().upstreams[0].driver).toBe("compatible");
	});

	it("isLmstudioModels rejects partial shapes", () => {
		expect(isLmstudioModels(listing(entry()))).toBe(true);
		expect(isLmstudioModels({})).toBe(false);
		expect(isLmstudioModels({ object: "list", data: "x" })).toBe(false);
		expect(isLmstudioModels(listing())).toBe(false);
		expect(isLmstudioModels(listing(null))).toBe(false);
		expect(isLmstudioModels(listing(entry({ object: "x" })))).toBe(false);
		expect(isLmstudioModels(listing(entry({ id: 1 })))).toBe(false);
		expect(isLmstudioModels(listing(entry({ arch: undefined })))).toBe(false);
		expect(isLmstudioModels(listing(entry({ compatibility_type: undefined })))).toBe(false);
		expect(isLmstudioModels(listing(entry({ state: undefined })))).toBe(false);
		expect(isLmstudioModels(listing(entry({ type: "image" })))).toBe(false);
	});

	it("an explicit backend wins, and empty tool fields are dropped", async () => {
		const api = await make({ upstreams: [{ url: "http://x.test", backend: "compatible" }], transport: server({}) });
		expect(api.status().upstreams[0].driver).toBe("compatible");
		expect(api.driver.lmstudio.request({ model: "m", messages: [], tools: [], tool_choice: "auto" })).toEqual({ model: "m", messages: [] });
	});
});

describe("lmstudio streamed tool calls with null ids on later chunks", () => {
	const base = { id: "c", object: "chat.completion.chunk", model: "qwen/qwen3-4b" };
	const frame = (delta, finish = null) => ({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] });
	const run = async (calls) => {
		const frames = [
			frame({ role: "assistant", content: "" }),
			...calls.map((call) => frame({ tool_calls: [call] })),
			frame({}, "tool_calls"),
			"[DONE]"
		];
		const transport = fakeTransport(
			() => new Response(openaiSse(frames), { status: 200, headers: { "content-type": "text/event-stream" } })
		);
		const api = await make({ upstreams: [{ url: "http://lms.test", backend: "lmstudio" }], transport });
		const reply = await api.send({
			model: "qwen/qwen3-4b",
			max_tokens: 32,
			stream: true,
			tools: [{ name: "Read", description: "read", input_schema: { type: "object", properties: { path: { type: "string" } } } }],
			messages: [{ role: "user", content: "read it" }]
		});
		return collect(reply.stream);
	};
	const summarize = (events) => ({
		starts: events.filter((event) => event.event === "content_block_start" && event.data.content_block.type === "tool_use").length,
		json: events
			.filter((event) => event.data?.delta?.type === "input_json_delta")
			.map((event) => event.data.delta.partial_json)
			.join("")
	});

	it("keeps one tool_use block when later chunks carry index and id: null", async () => {
		const events = await run([
			{ index: 0, id: "call_1", type: "function", function: { name: "Read", arguments: "" } },
			{ index: 0, id: null, function: { arguments: '{"path":' } },
			{ index: 0, id: null, function: { arguments: '"/a"}' } }
		]);
		expect(summarize(events)).toEqual({ starts: 1, json: '{"path":"/a"}' });
	});

	it("keeps one tool_use block when later chunks carry no index and id: null", async () => {
		const events = await run([
			{ id: "call_1", type: "function", function: { name: "Read", arguments: "" } },
			{ id: null, function: { arguments: '{"path":' } },
			{ function: { arguments: '"/a"}' } }
		]);
		expect(summarize(events)).toEqual({ starts: 1, json: '{"path":"/a"}' });
	});
});

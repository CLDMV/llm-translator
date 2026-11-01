/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/driver/sglang.test.vitest.mjs
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
 * @fileoverview SGLang driver: detection against a fake `/get_server_info`, separate reasoning, and reasoning and tool streaming.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { openaiSse } from "../helpers/streams.mjs";
import { filterChatBody } from "../../src/lib/passthrough.mjs";

afterEach(closeAll);

const server = (paths, chat = () => ({ status: 500, body: {} })) =>
	fakeTransport((url, init) => {
		const path = new URL(url).pathname;
		if (path === "/v1/chat/completions") return chat(init);
		return path in paths ? { body: paths[path] } : { status: 404, body: { error: "not found" } };
	});
const models = (owner) => ({ object: "list", data: [{ id: "qwen3", object: "model", owned_by: owner }] });
const INFO = {
	model_path: "Qwen/Qwen3-8B",
	version: "0.5.2",
	reasoning_parser: "qwen3",
	tool_call_parser: "qwen25",
	tokenizer_path: "Qwen/Qwen3-8B"
};
const endpoint = { url: "http://sg.test", headers: {}, apiKey: undefined };

describe("sglang detection", () => {
	it("is bound through /get_server_info and reads the parsers", async () => {
		const api = await make({
			upstreams: ["http://sg.test"],
			transport: server({ "/get_server_info": INFO, "/v1/models": models("sglang") })
		});
		const [upstream] = api.status().upstreams;
		expect(upstream).toMatchObject({ driver: "sglang", version: "0.5.2", models: ["qwen3"] });
		expect(upstream.facts).toEqual({
			version: "0.5.2",
			models: ["qwen3"],
			modelPath: "Qwen/Qwen3-8B",
			reasoningParser: "qwen3",
			toolCallParser: "qwen25"
		});
	});

	it("is bound through owned_by alone, and through server info alone", async () => {
		const owned = await make({ upstreams: ["http://sg.test"], transport: server({ "/v1/models": models("sglang") }) });
		expect(owned.status().upstreams[0]).toMatchObject({
			driver: "sglang",
			facts: { models: ["qwen3"], version: undefined, reasoningParser: undefined }
		});
		const info = await make({
			upstreams: ["http://sg.test"],
			transport: server({ "/get_server_info": { tokenizer_path: "t", reasoning_parser: "" } })
		});
		expect(info.status().upstreams[0]).toMatchObject({ driver: "sglang", facts: { models: [], reasoningParser: undefined } });
	});

	it("wins over vLLM when the server also answers /version", async () => {
		const transport = server({ "/version": { version: "0.5.2" }, "/get_server_info": INFO, "/v1/models": models("sglang") });
		const api = await make({ upstreams: ["http://sg.test"], transport });
		expect(api.status().upstreams[0].driver).toBe("sglang");
	});

	it("does not take other servers for SGLang, and an explicit backend skips detection", async () => {
		const other = await make({
			upstreams: ["http://x.test"],
			transport: server({ "/get_server_info": "oops", "/v1/models": models("library") })
		});
		expect(other.status().upstreams[0].driver).toBe("compatible");
		expect(await other.driver.sglang.detect({ endpoint, transport: server({ "/get_server_info": null }) })).toBeNull();
		const transport = server({});
		const pinned = await make({ upstreams: [{ url: "http://x.test", backend: "sglang" }], transport });
		expect(pinned.status().upstreams[0].driver).toBe("sglang");
		expect(transport.calls).toHaveLength(0);
	});

	it("is detected after vLLM and llama.cpp without extra sequential waits (each path once)", async () => {
		const transport = server({ "/get_server_info": INFO, "/v1/models": models("sglang") });
		await make({ upstreams: ["http://sg.test"], transport });
		const paths = transport.calls.map((call) => new URL(call.url).pathname).sort();
		expect(paths).toEqual(["/api/version", "/get_server_info", "/props", "/v1/models", "/version"]);
	});
});

describe("sglang.request", () => {
	const messages = [{ role: "user", content: "hi" }];

	it("asks for separate reasoning when a reasoning parser is running, unless the client decided", async () => {
		const api = await make({ upstreams: ["http://x.test"], detect: false });
		const { request } = api.driver.sglang;
		const parsed = { endpoint: { facts: { reasoningParser: "qwen3" } } };
		expect(request({ model: "m", messages }, parsed).separate_reasoning).toBe(true);
		expect(request({ model: "m", messages, separate_reasoning: false }, parsed).separate_reasoning).toBe(false);
		expect(request({ model: "m", messages }, { endpoint: { facts: {} } })).toEqual({ model: "m", messages });
		expect(request({ model: "m", messages })).toEqual({ model: "m", messages });
		expect(request({ model: "m", messages, tools: [], tool_choice: "auto" })).toEqual({ model: "m", messages });
	});

	it("sends separate_reasoning through send when the parser was detected", async () => {
		const transport = server({ "/get_server_info": INFO, "/v1/models": models("sglang") }, () => ({
			body: {
				id: "c",
				object: "chat.completion",
				model: "qwen3",
				choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }]
			}
		}));
		const api = await make({ upstreams: ["http://sg.test"], transport });
		await api.send({ model: "qwen3", max_tokens: 8, messages });
		const sent = JSON.parse(transport.calls.find((call) => call.url.endsWith("/chat/completions")).init.body);
		expect(sent).toMatchObject({ separate_reasoning: true, max_completion_tokens: 8 });
		expect(sent.top_k).toBeUndefined();
	});
});

describe("sglang reasoning and tool streaming", () => {
	const base = { id: "c", object: "chat.completion.chunk", model: "qwen3" };
	const frame = (delta, finish = null) => ({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] });
	const call = (index, name, id) => ({ index, ...(id ? { id } : {}), type: "function", function: { name, arguments: "" } });

	it("turns reasoning_content deltas and a streamed tool call into thinking and tool_use blocks", async () => {
		const frames = [
			frame({ role: "assistant", content: null }),
			frame({ reasoning_content: "Need " }),
			frame({ reasoning_content: "the file." }),
			frame({ content: "Reading it." }),
			frame({ tool_calls: [call(0, "Read", "call_1")] }),
			frame({ tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] }),
			frame({ tool_calls: [{ index: 0, function: { arguments: '"/a"}' } }] }),
			frame({}, "tool_calls"),
			{ ...base, choices: [], usage: { prompt_tokens: 9, completion_tokens: 5, total_tokens: 14 } },
			"[DONE]"
		];
		const transport = server(
			{ "/get_server_info": INFO, "/v1/models": models("sglang") },
			() => new Response(openaiSse(frames), { status: 200, headers: { "content-type": "text/event-stream" } })
		);
		const api = await make({ upstreams: ["http://sg.test"], transport });
		const reply = await api.send({ model: "qwen3", max_tokens: 64, stream: true, messages: [{ role: "user", content: "read /a" }] });
		const events = await collect(reply.stream);
		const kinds = events.filter((event) => event.event === "content_block_start").map((event) => event.data.content_block.type);
		expect(kinds).toEqual(["thinking", "text", "tool_use"]);
		const thinking = events.filter((event) => event.data?.delta?.type === "thinking_delta").map((event) => event.data.delta.thinking);
		expect(thinking.join("")).toBe("Need the file.");
		const args = events.filter((event) => event.data?.delta?.type === "input_json_delta").map((event) => event.data.delta.partial_json);
		expect(JSON.parse(args.join(""))).toEqual({ path: "/a" });
		expect(await reply.usage).toMatchObject({ input_tokens: 9, output_tokens: 5, reported: true, complete: true });
	});

	it("reads a non-streaming reply with reasoning_content and a tool call", async () => {
		const message = {
			role: "assistant",
			content: "ok",
			reasoning_content: "think",
			tool_calls: [{ id: "call_1", type: "function", function: { name: "Read", arguments: '{"path":"/a"}' } }]
		};
		const transport = server({ "/get_server_info": INFO }, () => ({
			body: { id: "c", object: "chat.completion", model: "qwen3", choices: [{ index: 0, message, finish_reason: "tool_calls" }] }
		}));
		const api = await make({ upstreams: [{ url: "http://sg.test", backend: "sglang" }], transport });
		const reply = await api.send({ model: "qwen3", max_tokens: 8, messages: [{ role: "user", content: "hi" }] });
		expect(reply.body.content.map((block) => block.type)).toEqual(["thinking", "text", "tool_use"]);
		expect(reply.body.stop_reason).toBe("tool_use");
	});
});

describe("passthroughFilter and backend extensions", () => {
	it("allows the documented SGLang and llama.cpp constraint fields and still drops server controls", () => {
		const body = {
			model: "m",
			messages: [],
			regex: "a+",
			ebnf: "root ::= x",
			separate_reasoning: false,
			repeat_penalty: 1.1,
			grammar: "root ::= x",
			cache_salt: "s"
		};
		expect(filterChatBody(body)).toEqual({
			model: "m",
			messages: [],
			regex: "a+",
			ebnf: "root ::= x",
			separate_reasoning: false,
			repeat_penalty: 1.1,
			grammar: "root ::= x"
		});
	});
});

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/convert/client-tools.test.vitest.mjs
 *	@Date: 2026-11-22T12:00:00-08:00 (1795464000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T12:00:00-08:00 (1795464000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { describe, expect, it } from "vitest";
import { request } from "../../src/api/convert/anthropic/messages/to/openai/chat/request.mjs";
import { request as toCohere } from "../../src/api/convert/anthropic/messages/to/cohere/chat/request.mjs";
import { request as toOllama } from "../../src/api/convert/anthropic/messages/to/ollama/chat/request.mjs";
import { request as toConverse } from "../../src/api/convert/anthropic/messages/to/bedrock/converse/request.mjs";
import { request as toResponses } from "../../src/api/convert/anthropic/messages/to/openai/responses/request.mjs";
import { request as toGemini } from "../../src/api/convert/anthropic/messages/to/google/gemini/request.mjs";
import { response } from "../../src/api/convert/openai/chat/to/anthropic/messages/response.mjs";
import { stream } from "../../src/api/convert/openai/chat/to/anthropic/messages/stream.mjs";
import { asyncOf, collect } from "../helpers/streams.mjs";

const base = (extra = {}) => ({ model: "qwen3-coder", max_tokens: 100, messages: [{ role: "user", content: "hi" }], ...extra });
const BASH = { type: "bash_20250124", name: "bash" };
const EDITOR = { type: "text_editor_20250728", name: "str_replace_based_edit_tool", max_characters: 2000 };
const COMPUTER = { type: "computer_20250124", name: "computer", display_width_px: 1024, display_height_px: 768 };
const MEMORY = { type: "memory_20250818", name: "memory" };
const TOOLSET = { type: "computer_toolset_20260801", configs: { zoom: { enabled: false } } };
const custom = { name: "Read", description: "read", input_schema: { type: "object", properties: { p: { type: "string" } } } };

const completion = (calls) => ({
	id: "chatcmpl-1",
	object: "chat.completion",
	model: "m",
	choices: [{ index: 0, message: { role: "assistant", content: null, tool_calls: calls }, finish_reason: "tool_calls" }],
	usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
});
const call = (name, args, id = "call_1") => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });

describe("typed client tools become function tools (Anthropic client, Chat Completions upstream)", () => {
	it("each typed tool is offered as a function with the client's tool name and the documented input fields", async () => {
		const { body, state } = await request(base({ tools: [custom, BASH, EDITOR, COMPUTER, MEMORY] }));
		expect(body.tools.map((tool) => tool.function.name)).toEqual(["Read", "bash", "str_replace_based_edit_tool", "computer", "memory"]);
		expect(body.tools.every((tool) => tool.type === "function")).toBe(true);
		const [, bash, editor, computer, memory] = body.tools.map((tool) => tool.function);
		expect(Object.keys(bash.parameters.properties)).toEqual(["command", "restart"]);
		expect(editor.parameters.required).toEqual(["command", "path"]);
		expect(editor.description).toContain("truncated to 2000 characters");
		expect(computer.description).toContain("1024 by 768");
		expect(computer.parameters.properties.action.enum).toContain("scroll");
		expect(memory.parameters.properties.command.enum).toContain("rename");
		expect(state.dropped).toEqual([]);
		expect(state).not.toHaveProperty("toolsets");
	});

	it("tool_choice that names a typed tool forces that function, and a typed tool can be required by any", async () => {
		const forced = await request(base({ tools: [custom, BASH], tool_choice: { type: "tool", name: "bash" } }));
		expect(forced.body.tool_choice).toEqual({ type: "function", function: { name: "bash" } });
		const any = await request(base({ tools: [BASH], tool_choice: { type: "any" } }));
		expect(any.body.tool_choice).toBe("required");
		const alone = await request(base({ tools: [BASH] }));
		expect(alone.body.tools).toHaveLength(1);
	});

	it("a typed tool the translator has no schema for is still dropped with the warning, and the rest are sent", async () => {
		const { body, state } = await request(
			base({ tools: [{ type: "bash_29990101", name: "bash" }, { type: "web_search_20250305", name: "web_search" }, MEMORY] })
		);
		expect(body.tools.map((tool) => tool.function.name)).toEqual(["memory"]);
		expect(state.dropped).toEqual(["tool:bash", "tool:web_search"]);
		const none = await request(base({ tools: [{ type: "bash_29990101", name: "bash" }] }));
		expect(none.body).not.toHaveProperty("tools");
	});

	it("names that need fitting map back, and toolSchema sanitize applies to the substituted schemas", async () => {
		const { body, state } = await request(base({ tools: [{ type: "bash_20250124", name: "my shell!" }] }), { toolSchema: "sanitize" });
		expect(body.tools[0].function.name).toBe("my_shell_");
		expect(state.toolNames).toEqual({ my_shell_: "my shell!" });
		expect(body.tools[0].function.parameters.properties.command.type).toBe("string");
		const out = response(completion([call("my_shell_", { command: "ls" })]), state);
		expect(out.content[0]).toMatchObject({ type: "tool_use", name: "my shell!", input: { command: "ls" } });
	});

	it("history keeps working: an earlier call of the typed tool and its result map to the function", async () => {
		const messages = [
			{ role: "user", content: "go" },
			{ role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "bash", input: { command: "ls" } }] },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "a.txt" }] }
		];
		const { body } = await request(base({ tools: [BASH], messages }));
		expect(body.messages[1].tool_calls[0].function).toEqual({ name: "bash", arguments: '{"command":"ls"}' });
		expect(body.messages[2]).toMatchObject({ role: "tool", content: "a.txt" });
	});
});

describe("calls come back under the client's tool name", () => {
	it("non-streaming", async () => {
		const { state } = await request(base({ tools: [BASH, EDITOR] }));
		const out = response(
			completion([call("bash", { command: "ls" }), call("str_replace_based_edit_tool", { command: "view", path: "a" }, "call_2")]),
			state
		);
		expect(out.content.map((block) => [block.type, block.name, block.toolset_name])).toEqual([
			["tool_use", "bash", undefined],
			["tool_use", "str_replace_based_edit_tool", undefined]
		]);
		expect(out.stop_reason).toBe("tool_use");
	});

	it("streaming", async () => {
		const { state } = await request(base({ tools: [BASH] }));
		const chunk = (delta, finish = null) => ({
			id: "c",
			object: "chat.completion.chunk",
			model: "m",
			choices: [{ index: 0, delta, finish_reason: finish }]
		});
		const events = await collect(
			stream(
				asyncOf([
					chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "bash", arguments: '{"command":' } }] }),
					chunk({ tool_calls: [{ index: 0, function: { arguments: '"ls"}' } }] }),
					chunk({}, "tool_calls")
				]),
				state
			)
		);
		const start = events.find((event) => event.event === "content_block_start").data.content_block;
		expect(start).toMatchObject({ type: "tool_use", name: "bash" });
		expect(start).not.toHaveProperty("toolset_name");
		const json = events.filter((event) => event.data?.delta?.type === "input_json_delta").map((event) => event.data.delta.partial_json);
		expect(JSON.parse(json.join(""))).toEqual({ command: "ls" });
	});
});

describe("computer_toolset_20260801", () => {
	it("each member is a function; a call of one is returned with toolset_name, whole and streamed", async () => {
		const { body, state } = await request(base({ tools: [custom, TOOLSET], tool_choice: { type: "tool", name: "left_click" } }));
		const names = body.tools.map((tool) => tool.function.name);
		expect(names).toHaveLength(17);
		expect(names).toContain("left_click");
		expect(names).not.toContain("zoom");
		expect(body.tool_choice).toEqual({ type: "function", function: { name: "left_click" } });
		expect(state.toolsets.left_click).toBe("computer");
		expect(state.toolsets).not.toHaveProperty("Read");

		const out = response(completion([call("left_click", { coordinate: [5, 6] }), call("Read", { p: "x" }, "call_2")]), state);
		expect(out.content[0]).toMatchObject({ type: "tool_use", name: "left_click", toolset_name: "computer", input: { coordinate: [5, 6] } });
		expect(out.content[1]).not.toHaveProperty("toolset_name");

		const chunk = (delta, finish = null) => ({
			id: "c",
			object: "chat.completion.chunk",
			model: "m",
			choices: [{ index: 0, delta, finish_reason: finish }]
		});
		const events = await collect(
			stream(
				asyncOf([
					chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "key", arguments: '{"text":"ctrl+s"}' } }] }),
					chunk({}, "tool_calls")
				]),
				state
			)
		);
		expect(events.find((event) => event.event === "content_block_start").data.content_block).toMatchObject({
			type: "tool_use",
			name: "key",
			toolset_name: "computer"
		});
	});

	it("history of a member call (with toolset_name) converts", async () => {
		const messages = [
			{ role: "user", content: "go" },
			{ role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "screenshot", toolset_name: "computer", input: {} }] },
			{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", toolset_name: "computer", content: "ok" }] }
		];
		const { body } = await request(base({ tools: [TOOLSET], messages }));
		expect(body.messages[1].tool_calls[0].function.name).toBe("screenshot");
	});
});

describe("every Anthropic-front upstream converter gets the substitution", () => {
	const tools = [BASH, MEMORY];

	it("Cohere", async () => {
		const { body } = await toCohere(base({ tools }));
		expect(body.tools.map((tool) => tool.function.name)).toEqual(["bash", "memory"]);
	});

	it("Ollama", async () => {
		const { body } = await toOllama(base({ tools }));
		expect(body.tools.map((tool) => tool.function.name)).toEqual(["bash", "memory"]);
	});

	it("Bedrock Converse", async () => {
		const { body } = await toConverse(base({ tools }));
		expect(body.toolConfig.tools.map((tool) => tool.toolSpec.name)).toEqual(["bash", "memory"]);
	});

	it("the Responses API", async () => {
		const { body } = await toResponses(base({ tools }));
		expect(body.tools.map((tool) => tool.name)).toEqual(["bash", "memory"]);
	});

	it("Gemini, where the computer tool stays Gemini's own built-in tool", async () => {
		const { body } = await toGemini(base({ tools: [BASH, COMPUTER] }));
		expect(body.tools.some((tool) => tool.functionDeclarations?.some((fn) => fn.name === "bash"))).toBe(true);
		expect(JSON.stringify(body.tools)).not.toContain('"computer"');
	});
});

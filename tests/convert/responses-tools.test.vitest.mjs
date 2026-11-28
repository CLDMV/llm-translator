/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/convert/responses-tools.test.vitest.mjs
 *	@Date: 2026-11-27T12:00:00-08:00 (1795809600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-27T12:00:00-08:00 (1795809600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The Responses tool table and what the converters do with every tool type: the request side (tools, tool choices, input items), the reply side
 * (shell, apply_patch and custom tool calls as items and events) and the compaction carrier.
 */
import { describe, expect, it } from "vitest";
import { request } from "../../src/api/convert/openai/responses/to/openai/chat/request.mjs";
import { response } from "../../src/api/convert/openai/chat/to/openai/responses/response.mjs";
import { stream } from "../../src/api/convert/openai/chat/to/openai/responses/stream.mjs";
import { COMPACTED, summarize, unsummarize } from "../../src/lib/responses.mjs";
import {
	TOOLS,
	argumentsOf,
	clientItem,
	clientKind,
	functionOf,
	hostedMark,
	parsed,
	replayMark,
	rowOf,
	shellText
} from "../../src/lib/responses-tools.mjs";
import { collect } from "../helpers/streams.mjs";

const refused = (body, code, param) => {
	try {
		request(body);
	} catch (error) {
		expect(error).toMatchObject({ name: "TranslatorError", status: 400, code, param });
		return error;
	}
	throw new Error("expected the request to be refused");
};

describe("the tool table", () => {
	it("classifies every documented type, with the dated and preview web_search names", () => {
		const kinds = Object.fromEntries(
			[
				"function",
				"custom",
				"web_search",
				"web_search_preview",
				"web_search_2025_08_26",
				"web_search_preview_2025_03_11",
				"code_interpreter",
				"tool_search",
				"shell",
				"apply_patch",
				"file_search",
				"image_generation",
				"local_shell",
				"computer_use_preview",
				"mcp"
			].map((type) => [type, rowOf(type)?.handling])
		);
		expect(kinds).toEqual({
			function: "mapped",
			custom: "mapped",
			web_search: "emulated",
			web_search_preview: "emulated",
			web_search_2025_08_26: "emulated",
			web_search_preview_2025_03_11: "emulated",
			code_interpreter: "emulated",
			tool_search: "emulated",
			shell: "emulated",
			apply_patch: "emulated",
			file_search: "rejected",
			image_generation: "rejected",
			local_shell: "rejected",
			computer_use_preview: "rejected",
			mcp: "rejected"
		});
		expect(rowOf("web_searcher")).toBeUndefined();
		expect(rowOf(undefined)).toBeUndefined();
		expect(TOOLS.every((row) => typeof row.note === "string" && row.note !== "")).toBe(true);
		expect(TOOLS.filter((row) => row.via === "serverTools").every((row) => typeof row.executor === "string")).toBe(true);
	});
});

describe("tools", () => {
	it("marks web_search, code_interpreter and tool_search for the runner and keeps the original tool", () => {
		const search = { type: "web_search", filters: { allowed_domains: ["a.test"] } };
		const { body } = request({
			model: "m",
			input: "x",
			tools: [{ type: "function", name: "f" }, search, { type: "code_interpreter" }, { type: "tool_search" }]
		});
		expect(body.tools).toHaveLength(4);
		expect(body.tools[1]).toEqual({
			type: "function",
			function: { name: "web_search", parameters: { type: "object", properties: {} } },
			llmt_hosted: { kind: "web_search", at: "tools[1]", tool: search }
		});
		expect(body.tools.slice(2).map((tool) => tool.llmt_hosted.kind)).toEqual(["code_interpreter", "tool_search"]);
		expect(hostedMark(body.tools[1])).toBe(true);
		expect(hostedMark(body.tools[0])).toBe(false);
		expect(hostedMark(null)).toBe(false);
	});

	it("marks deferred functions only when the request has a tool_search tool", () => {
		const deferred = { type: "function", name: "later", defer_loading: true };
		expect(request({ model: "m", input: "x", tools: [deferred] }).body.tools).toEqual([{ type: "function", function: { name: "later" } }]);
		const withSearch = request({ model: "m", input: "x", tools: [{ type: "tool_search" }, deferred] }).body.tools;
		expect(withSearch[1]).toEqual({ type: "function", function: { name: "later" }, llmt_deferred: true });
	});

	it("maps custom tools to Chat custom tools", () => {
		const format = { type: "grammar", syntax: "lark", definition: "start: WORD" };
		const { body } = request({ model: "m", input: "x", tools: [{ type: "custom", name: "words", description: "d", format }] });
		expect(body.tools).toEqual([{ type: "custom", custom: { name: "words", description: "d", format } }]);
	});

	it("offers shell and apply_patch as functions and records their names for the reply", () => {
		const { body, state } = request({ model: "m", input: "x", tools: [{ type: "shell" }, { type: "apply_patch" }] });
		expect(body.tools).toEqual([functionOf("shell"), functionOf("apply_patch")]);
		expect(body.tools[0].function.parameters.required).toEqual(["commands"]);
		expect(body.tools[1].function.parameters.required).toEqual(["type", "path"]);
		expect(state.clientTools).toEqual({ shell: "shell", apply_patch: "apply_patch" });
		expect(clientKind(state, "shell")).toBe("shell");
		expect(clientKind(state, "weather")).toBeUndefined();
		expect(clientKind({}, "shell")).toBeUndefined();
		expect(request({ model: "m", input: "x", tools: [{ type: "shell", environment: { type: "local" } }] }).body.tools).toHaveLength(1);
	});

	it("refuses a hosted shell environment", () => {
		for (const type of ["container_auto", "container_reference"]) {
			const error = refused({ model: "m", input: "x", tools: [{ type: "shell", environment: { type } }] }, "unsupported_tool", "tools[0]");
			expect(error.message).toContain(type);
		}
	});

	it("refuses an emulated tool whose function name the request already uses, and a type given twice", () => {
		for (const [type, name] of [
			["shell", "shell"],
			["apply_patch", "apply_patch"],
			["web_search", "web_search"],
			["code_interpreter", "code_interpreter"],
			["tool_search", "tool_search"]
		]) {
			const error = refused(
				{ model: "m", input: "x", tools: [{ type: "function", name, parameters: {} }, { type }] },
				"unsupported_tool",
				"tools[1]"
			);
			expect(error.message).toContain(name);
		}
		refused({ model: "m", input: "x", tools: [{ type: "web_search" }, { type: "web_search_preview" }] }, "unsupported_tool", "tools[1]");
		refused({ model: "m", input: "x", tools: [{ type: "custom", name: "shell" }, { type: "shell" }] }, "unsupported_tool", "tools[1]");
	});
});

describe("tool_choice", () => {
	const tools = [{ type: "web_search" }, { type: "shell" }, { type: "function", name: "a" }, { type: "custom", name: "c" }];

	it("maps a hosted choice to the emulated function when the tool is offered", () => {
		for (const [choice, name] of [
			[{ type: "web_search" }, "web_search"],
			[{ type: "web_search_preview" }, "web_search"],
			[{ type: "shell" }, "shell"]
		]) {
			expect(request({ model: "m", input: "x", tools, tool_choice: choice }).body.tool_choice).toEqual({
				type: "function",
				function: { name }
			});
		}
		expect(request({ model: "m", input: "x", tools, tool_choice: { type: "function", name: "a" } }).body.tool_choice).toEqual({
			type: "function",
			function: { name: "a" }
		});
	});

	it("maps a custom choice and allowed_tools", () => {
		expect(request({ model: "m", input: "x", tools, tool_choice: { type: "custom", name: "c" } }).body.tool_choice).toEqual({
			type: "custom",
			custom: { name: "c" }
		});
		const allowed = {
			type: "allowed_tools",
			mode: "required",
			tools: [{ type: "function", name: "a" }, { type: "custom", name: "c" }, { type: "web_search" }]
		};
		expect(request({ model: "m", input: "x", tools, tool_choice: allowed }).body.tool_choice).toEqual({
			type: "allowed_tools",
			allowed_tools: {
				mode: "required",
				tools: [
					{ type: "function", function: { name: "a" } },
					{ type: "custom", custom: { name: "c" } },
					{ type: "function", function: { name: "web_search" } }
				]
			}
		});
	});

	it("refuses a hosted choice for a tool the request does not offer", () => {
		refused(
			{ model: "m", input: "x", tools: [{ type: "function", name: "a" }], tool_choice: { type: "code_interpreter" } },
			"unsupported_field",
			"tool_choice"
		);
	});
});

describe("input items", () => {
	it("turns shell_call, shell_call_output, apply_patch_call and apply_patch_call_output into tool calls and tool messages", () => {
		const { body } = request({
			model: "m",
			input: [
				{ role: "user", content: "go" },
				{ type: "shell_call", id: "sc_1", call_id: "c1", status: "completed", action: { commands: ["ls"], timeout_ms: 1000 } },
				{
					type: "shell_call_output",
					call_id: "c1",
					output: [
						{ stdout: "a\n", stderr: "", outcome: { type: "exit", exit_code: 0 } },
						{ stdout: "", stderr: "late", outcome: { type: "timeout" } }
					]
				},
				{
					type: "apply_patch_call",
					id: "apc_1",
					call_id: "c2",
					status: "completed",
					operation: { type: "create_file", path: "a.txt", diff: "+x" }
				},
				{ type: "apply_patch_call_output", call_id: "c2", status: "failed", output: "no such directory" },
				{ type: "apply_patch_call_output", call_id: "c2" }
			]
		});
		expect(body.messages[1]).toEqual({
			role: "assistant",
			content: null,
			tool_calls: [{ id: "c1", type: "function", function: { name: "shell", arguments: '{"commands":["ls"],"timeout_ms":1000}' } }]
		});
		expect(body.messages[2]).toEqual({
			role: "tool",
			tool_call_id: "c1",
			content: "stdout:\na\n\nexit code: 0\n\nstderr:\nlate\ntimed out"
		});
		expect(body.messages[3].tool_calls[0].function).toEqual({
			name: "apply_patch",
			arguments: '{"type":"create_file","path":"a.txt","diff":"+x"}'
		});
		expect(body.messages[4]).toEqual({ role: "tool", tool_call_id: "c2", content: "failed\nno such directory" });
		expect(body.messages[5]).toEqual({ role: "tool", tool_call_id: "c2", content: "completed" });
	});

	it("turns custom_tool_call and its output into a custom tool call and a tool message", () => {
		const { body } = request({
			model: "m",
			input: [
				{ type: "custom_tool_call", id: "ctc_1", call_id: "c1", name: "words", input: "hello" },
				{ type: "custom_tool_call", call_id: "c2", name: "words" },
				{ type: "custom_tool_call_output", call_id: "c1", output: "HELLO" }
			]
		});
		expect(body.messages[0].tool_calls).toEqual([
			{ id: "c1", type: "custom", custom: { name: "words", input: "hello" } },
			{ id: "c2", type: "custom", custom: { name: "words", input: "" } }
		]);
		expect(body.messages[1]).toEqual({ role: "tool", tool_call_id: "c1", content: "HELLO" });
	});

	it("marks the replayed hosted calls and gives each one a call and a result message", () => {
		const search = { type: "web_search_call", id: "ws_1", status: "completed", action: { type: "search", query: "q" } };
		const code = { type: "code_interpreter_call", id: "ci_1", status: "completed", code: "1+1", outputs: [] };
		const found = { type: "tool_search_call", id: "tsc_1", call_id: "k1", arguments: { query: "order" } };
		const loaded = { type: "tool_search_output", id: "tso_1", call_id: "k1", tools: [{ type: "function", name: "lookup" }] };
		const { body } = request({ model: "m", input: [{ role: "user", content: "x" }, search, code, found, loaded] });
		expect(body.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool", "assistant", "tool", "assistant", "tool"]);
		expect(body.messages[1].tool_calls[0]).toEqual({
			id: "ws_1",
			type: "function",
			function: { name: "web_search", arguments: '{"query":"q"}' },
			llmt_item: search
		});
		expect(body.messages[2]).toEqual({
			role: "tool",
			tool_call_id: "ws_1",
			content: "",
			llmt_hosted: { kind: "web_search", item: search, paired: true }
		});
		expect(body.messages[3].tool_calls[0].function).toEqual({ name: "code_interpreter", arguments: '{"code":"1+1"}' });
		expect(body.messages[5].tool_calls[0]).toMatchObject({ id: "k1", function: { name: "tool_search", arguments: '{"query":"order"}' } });
		expect(body.messages[6]).toMatchObject({ tool_call_id: "k1", llmt_hosted: { kind: "tool_search", item: loaded, paired: false } });
		expect(body.messages.filter(replayMark)).toHaveLength(3);
		expect(replayMark({ role: "user" })).toBe(false);
		expect(replayMark(null)).toBe(false);
	});

	it("replays a code_interpreter_call that has no code as an empty program", () => {
		const { body } = request({ model: "m", input: [{ type: "code_interpreter_call", id: "ci_1" }] });
		expect(body.messages[0].tool_calls[0].function.arguments).toBe('{"code":""}');
	});

	it("needs an id on a replayed hosted call", () => {
		refused({ model: "m", input: [{ type: "web_search_call", status: "completed" }] }, "invalid_request", "input[0].id");
	});
});

describe("compaction items", () => {
	it("carries the summary in encrypted_content and reads back only what it wrote", () => {
		const carrier = summarize("The user wants a loader.");
		expect(carrier).toMatch(/^llmt-cp1:/);
		expect(unsummarize(carrier)).toBe("The user wants a loader.");
		expect(unsummarize("llmt-rs1:abc")).toBeNull();
		expect(unsummarize("llmt-cp1:not-json")).toBeNull();
		expect(unsummarize(summarize(""))).toBeNull();
		expect(unsummarize(`llmt-cp1:${"a".repeat(3 * 1024 * 1024)}`)).toBeNull();
		expect(unsummarize(5)).toBeNull();
	});

	it("expands a compaction item the translator wrote into a user message with the summary", () => {
		const { body } = request({
			model: "m",
			input: [
				{ role: "user", content: "first" },
				{ type: "compaction", id: "cmp_1", encrypted_content: summarize("S") },
				{ role: "user", content: "next" }
			]
		});
		expect(body.messages).toEqual([
			{ role: "user", content: "first" },
			{ role: "user", content: `${COMPACTED}\n\nS` },
			{ role: "user", content: "next" }
		]);
	});

	it("refuses a compaction item it did not write", () => {
		refused({ model: "m", input: [{ type: "compaction", encrypted_content: "gAAAA" }] }, "unsupported_content", "input[0]");
		refused({ model: "m", input: [{ type: "compaction" }] }, "unsupported_content", "input[0]");
	});
});

describe("helpers", () => {
	it("reads shell output, arguments and parsed arguments defensively", () => {
		expect(shellText("plain")).toBe("plain");
		expect(shellText(7)).toBe("");
		expect(shellText([{ outcome: { type: "exit" } }])).toBe("exit code: 0");
		expect(shellText([{}])).toBe("");
		expect(argumentsOf(null)).toBe("{}");
		expect(argumentsOf([1])).toBe("{}");
		expect(parsed("not json")).toEqual({});
		expect(parsed("[1]")).toEqual({});
		expect(parsed("")).toEqual({});
		expect(parsed(undefined)).toEqual({});
		expect(parsed('{"a":1}')).toEqual({ a: 1 });
	});

	it("builds the shell and apply_patch items from function arguments, tolerating bad arguments", () => {
		expect(
			clientItem("shell", { id: "sc_1", call_id: "c", arguments: '{"commands":["ls",1],"timeout_ms":5}', status: "completed" })
		).toEqual({
			id: "sc_1",
			type: "shell_call",
			call_id: "c",
			status: "completed",
			action: { commands: ["ls", "1"], timeout_ms: 5, max_output_length: null }
		});
		expect(clientItem("shell", { id: "sc_1", call_id: "c", arguments: "{", status: "in_progress" }).action).toEqual({
			commands: [],
			timeout_ms: null,
			max_output_length: null
		});
		expect(
			clientItem("apply_patch", { id: "apc_1", call_id: "c", arguments: '{"type":"delete_file","path":"a"}', status: "completed" })
		).toEqual({
			id: "apc_1",
			type: "apply_patch_call",
			call_id: "c",
			status: "completed",
			operation: { type: "delete_file", path: "a" }
		});
	});
});

const wrap = (message, finish = "stop") => ({
	id: "chatcmpl-1",
	object: "chat.completion",
	created: 7,
	model: "m",
	choices: [{ index: 0, message: { role: "assistant", ...message }, finish_reason: finish }]
});
const state = { model: "m", echo: {}, clientTools: { shell: "shell", apply_patch: "apply_patch" } };

describe("reply items", () => {
	it("returns the function calls of emulated tools as shell_call and apply_patch_call, and custom calls as custom_tool_call", () => {
		const output = response(
			wrap(
				{
					content: null,
					tool_calls: [
						{ id: "c1", type: "function", function: { name: "shell", arguments: '{"commands":["ls"]}' } },
						{ id: "c2", type: "function", function: { name: "apply_patch", arguments: '{"type":"create_file","path":"a","diff":"+x"}' } },
						{ id: "c3", type: "custom", custom: { name: "words", input: "hello" } },
						{ id: "c4", type: "function", function: { name: "weather", arguments: "{}" } }
					]
				},
				"tool_calls"
			),
			state
		).output;
		expect(output.map((item) => item.type)).toEqual(["shell_call", "apply_patch_call", "custom_tool_call", "function_call"]);
		expect(output[0]).toMatchObject({ call_id: "c1", status: "completed", action: { commands: ["ls"] } });
		expect(output[1]).toMatchObject({ call_id: "c2", operation: { type: "create_file", path: "a", diff: "+x" } });
		expect(output[2]).toMatchObject({ call_id: "c3", name: "words", input: "hello", status: "completed" });
		expect(output[0].id).toMatch(/^sc_[0-9a-f]{24}$/);
		expect(output[1].id).toMatch(/^apc_[0-9a-f]{24}$/);
		expect(output[2].id).toMatch(/^ctc_[0-9a-f]{24}$/);
	});

	it("leaves a call of a function named shell alone when the request had no shell tool", () => {
		const output = response(
			wrap({ tool_calls: [{ id: "c1", type: "function", function: { name: "shell", arguments: "{}" } }] }, "tool_calls"),
			{ model: "m", echo: {} }
		).output;
		expect(output[0].type).toBe("function_call");
	});

	it("fills in a custom call that has no input", () => {
		const output = response(wrap({ tool_calls: [{ id: "c3", type: "custom" }] }, "tool_calls"), state).output;
		expect(output[0]).toMatchObject({ type: "custom_tool_call", name: "", input: "" });
	});

	it("builds the output from the runner's rounds and ends incomplete at its round limit", () => {
		const out = response(
			{
				...wrap({ content: "last" }, "tool_calls"),
				llmt_rounds: [
					{
						message: { content: "first" },
						hosted: [{ id: "ws_1", type: "web_search_call", status: "completed", action: { type: "search", query: "q" } }]
					},
					{ message: { content: "last" }, hosted: [] }
				],
				llmt_incomplete: "max_tool_calls"
			},
			state
		);
		expect(out.output.map((item) => item.type)).toEqual(["message", "web_search_call", "message"]);
		expect(out.status).toBe("incomplete");
		expect(out.incomplete_details).toEqual({ reason: "max_tool_calls" });
	});
});

/** The events of a chunk stream. */
async function events(chunks, settings) {
	return collect(
		stream(
			chunks.map((data) => ({ data })),
			state,
			settings
		)
	);
}
const chunk = (delta, finish = null) => ({ choices: [{ index: 0, delta, finish_reason: finish }] });

describe("reply events", () => {
	it("streams a shell_call whole when its call closes, with no argument deltas", async () => {
		const list = await events([
			chunk({ tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: "shell", arguments: '{"comm' } }] }),
			chunk({ tool_calls: [{ index: 0, function: { arguments: 'ands":["ls"]}' } }] }),
			chunk({}, "tool_calls")
		]);
		const names = list.map((event) => event.event);
		expect(names).toEqual([
			"response.created",
			"response.in_progress",
			"response.output_item.added",
			"response.output_item.done",
			"response.completed"
		]);
		expect(list[2].data.item).toMatchObject({ type: "shell_call", call_id: "c1", status: "in_progress", action: { commands: [] } });
		expect(list[3].data.item).toMatchObject({ type: "shell_call", call_id: "c1", status: "completed", action: { commands: ["ls"] } });
		expect(list.at(-1).data.response.output[0].type).toBe("shell_call");
	});

	it("streams an apply_patch_call", async () => {
		const list = await events([
			chunk({
				tool_calls: [
					{ index: 0, id: "c2", type: "function", function: { name: "apply_patch", arguments: '{"type":"delete_file","path":"a"}' } }
				]
			}),
			chunk({}, "tool_calls")
		]);
		expect(list.find((event) => event.event === "response.output_item.done").data.item).toMatchObject({
			type: "apply_patch_call",
			operation: { type: "delete_file", path: "a" }
		});
	});

	it("streams a custom tool call with its input deltas", async () => {
		const list = await events([
			chunk({ tool_calls: [{ index: 0, id: "c3", type: "custom", custom: { name: "words", input: "hel" } }] }),
			chunk({ tool_calls: [{ index: 0, custom: { input: "lo" } }] }),
			chunk({}, "tool_calls")
		]);
		const deltas = list.filter((event) => event.event === "response.custom_tool_call_input.delta").map((event) => event.data.delta);
		expect(deltas).toEqual(["hel", "lo"]);
		expect(list.find((event) => event.event === "response.custom_tool_call_input.done").data.input).toBe("hello");
		expect(list.find((event) => event.event === "response.output_item.added").data.item).toMatchObject({
			type: "custom_tool_call",
			name: "words",
			input: "",
			status: "in_progress"
		});
		expect(list.find((event) => event.event === "response.output_item.done").data.item).toMatchObject({
			input: "hello",
			status: "completed"
		});
	});

	it("fills in the name and id of a custom call, and the id of a shell call, that arrive after the first delta", async () => {
		const list = await events([
			chunk({ tool_calls: [{ index: 0, type: "custom", custom: { input: "a" } }] }),
			chunk({ tool_calls: [{ index: 0, id: "c1", custom: { name: "words", input: "b" } }] }),
			chunk({ tool_calls: [{ index: 1, type: "function", function: { name: "shell", arguments: '{"commands":[]}' } }] }),
			chunk({ tool_calls: [{ index: 1, id: "c2" }] }),
			chunk({}, "tool_calls")
		]);
		const done = list.filter((event) => event.event === "response.output_item.done").map((event) => event.data.item);
		expect(done[0]).toMatchObject({ type: "custom_tool_call", call_id: "c1", name: "words", input: "ab" });
		expect(done[1]).toMatchObject({ type: "shell_call", call_id: "c2" });
	});

	it("sends the runner's hosted items between the messages, and ends incomplete when it cut the turn off", async () => {
		const item = {
			id: "tsc_1",
			type: "tool_search_call",
			call_id: "k",
			status: "completed",
			execution: "server",
			arguments: { query: "q" }
		};
		const list = await events([
			chunk({ content: "before" }),
			{ choices: [], llmt_items: [item] },
			chunk({ content: "after" }),
			{ ...chunk({}, "tool_calls"), llmt_incomplete: "max_tool_calls" }
		]);
		const done = list.at(-1);
		expect(done.event).toBe("response.incomplete");
		expect(done.data.response.incomplete_details).toEqual({ reason: "max_tool_calls" });
		expect(done.data.response.output.map((entry) => entry.type)).toEqual(["message", "tool_search_call", "message"]);
		const kinds = list
			.filter((event) => event.event.startsWith("response.output_item"))
			.map((event) => `${event.event}:${event.data.item.type}`);
		expect(kinds).toEqual([
			"response.output_item.added:message",
			"response.output_item.done:message",
			"response.output_item.added:tool_search_call",
			"response.output_item.done:tool_search_call",
			"response.output_item.added:message",
			"response.output_item.done:message"
		]);
	});
});

/**
 * @fileoverview Responses request to Chat Completions request: input items, tools, text format, reasoning and the refusals of the stateless core.
 */
import { describe, expect, it } from "vitest";
import { request } from "../../src/api/convert/openai/responses/to/openai/chat/request.mjs";
import { pack } from "../../src/lib/responses.mjs";

const refused = (body, settings, code, param) => {
	try {
		request(body, settings);
	} catch (error) {
		expect(error).toMatchObject({
			name: "TranslatorError",
			status: 400,
			...(code ? { code } : {}),
			...(param === undefined ? {} : { param })
		});
		return error;
	}
	throw new Error("expected the request to be refused");
};

describe("input", () => {
	it("turns a string input and instructions into a user and a system message", () => {
		const { body, state } = request({ model: "m", input: "hi", instructions: "be brief" });
		expect(body).toEqual({
			model: "m",
			messages: [
				{ role: "system", content: "be brief" },
				{ role: "user", content: "hi" }
			]
		});
		expect(state).toMatchObject({ model: "m", stream: false, dropped: [] });
	});

	it("maps stored files: input_image with a file_id and input_file by id or data", () => {
		const { body } = request({
			model: "m",
			input: [
				{
					role: "user",
					content: [
						{ type: "input_image", file_id: "file-aaaaaaaaaaaa", detail: "low" },
						{ type: "input_file", file_id: "file-bbbbbbbbbbbb", filename: "a.pdf" },
						{ type: "input_file", file_data: "data:application/pdf;base64,AA", filename: "b.pdf", file_url: "https://x/ignored" }
					]
				}
			]
		});
		expect(body.messages[0].content).toEqual([
			{ type: "image_url", image_url: { url: "file-aaaaaaaaaaaa", detail: "low" } },
			{ type: "file", file: { file_id: "file-bbbbbbbbbbbb", filename: "a.pdf" } },
			{ type: "file", file: { file_data: "data:application/pdf;base64,AA", filename: "b.pdf" } }
		]);
		refused(
			{ model: "m", input: [{ role: "assistant", content: [{ type: "input_file", file_id: "file-aaaaaaaaaaaa" }] }] },
			undefined,
			"unsupported_content",
			"input[0].content[0]"
		);
	});

	it("maps messages with text and image parts, and the roles", () => {
		const { body } = request({
			model: "m",
			input: [
				{ role: "developer", content: "rules" },
				{
					type: "message",
					role: "user",
					content: [
						{ type: "input_text", text: "look" },
						{ type: "input_image", image_url: "data:image/png;base64,AA", detail: "high" },
						{ type: "input_image", image_url: "https://x/y.png", detail: "auto" }
					]
				},
				{ type: "message", role: "assistant", content: [{ type: "output_text", text: "seen" }] },
				{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "no" }] },
				{
					type: "message",
					role: "assistant",
					content: [
						{ type: "output_text", text: "a" },
						{ type: "refusal", refusal: "b" },
						{ type: "refusal", refusal: "c" }
					]
				},
				{ type: "message", role: "system", content: [{ type: "input_text", text: "s" }] }
			]
		});
		expect(body.messages).toEqual([
			{ role: "developer", content: "rules" },
			{
				role: "user",
				content: [
					{ type: "text", text: "look" },
					{ type: "image_url", image_url: { url: "data:image/png;base64,AA", detail: "high" } },
					{ type: "image_url", image_url: { url: "https://x/y.png" } }
				]
			},
			{ role: "assistant", content: "seen" },
			{ role: "assistant", content: null, refusal: "no" },
			{ role: "assistant", content: "a", refusal: "bc" },
			{ role: "system", content: "s" }
		]);
	});

	it("groups function calls under the assistant turn they follow and maps their outputs", () => {
		const { body } = request({
			model: "m",
			input: [
				{ role: "user", content: "weather?" },
				{ type: "message", role: "assistant", content: "checking" },
				{ type: "function_call", call_id: "c1", name: "weather", arguments: '{"city":"Oslo"}', status: "completed" },
				{ type: "function_call", call_id: "c2", name: "time" },
				{ type: "function_call_output", call_id: "c1", output: "rain" },
				{
					type: "function_call_output",
					call_id: "c2",
					output: [
						{ type: "input_text", text: "a" },
						{ type: "input_text", text: "b" }
					]
				}
			]
		});
		expect(body.messages.slice(1)).toEqual([
			{
				role: "assistant",
				content: "checking",
				tool_calls: [
					{ id: "c1", type: "function", function: { name: "weather", arguments: '{"city":"Oslo"}' } },
					{ id: "c2", type: "function", function: { name: "time", arguments: "{}" } }
				]
			},
			{ role: "tool", tool_call_id: "c1", content: "rain" },
			{ role: "tool", tool_call_id: "c2", content: "ab" }
		]);
	});

	it("starts an assistant turn for a function call that follows a user turn", () => {
		const { body } = request({
			model: "m",
			input: [
				{ role: "user", content: "x" },
				{ type: "function_call", call_id: "c", name: "f", arguments: "{}" }
			]
		});
		expect(body.messages.at(-1)).toEqual({
			role: "assistant",
			content: null,
			tool_calls: [{ id: "c", type: "function", function: { name: "f", arguments: "{}" } }]
		});
	});

	it("drops reasoning items unless reasoningRoundTrip is on, and lists them once", () => {
		const input = [
			{ type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "t" }] },
			{ type: "reasoning", id: "rs_2", summary: [] },
			{ type: "message", role: "assistant", content: "a" }
		];
		const { body, state } = request({ model: "m", input });
		expect(body.messages).toEqual([{ role: "assistant", content: "a" }]);
		expect(state.dropped).toEqual(["reasoning"]);
	});

	it("replays reasoning with reasoningRoundTrip onto the next assistant output", () => {
		const details = [{ type: "reasoning.text", text: "t", signature: "s", format: "anthropic-claude-v1", index: 0 }];
		const settings = { reasoningRoundTrip: true, reasoningField: "reasoning_content" };
		const items = [
			{
				type: "reasoning",
				summary: [
					{ type: "summary_text", text: "one" },
					{ type: "summary_text", text: "two" }
				],
				encrypted_content: pack(details)
			},
			{ type: "message", role: "assistant", content: "a" },
			{ type: "reasoning", content: [{ type: "reasoning_text", text: "raw" }] },
			{ type: "function_call", call_id: "c", name: "f", arguments: "{}" },
			{ type: "reasoning", summary: [{ type: "summary_text", text: "lost" }], encrypted_content: "foreign" },
			{ role: "user", content: "u" },
			{ type: "reasoning", summary: [], encrypted_content: pack(details) },
			{ type: "function_call", call_id: "d", name: "g", arguments: "{}" }
		];
		const { body, state } = request({ model: "m", input: items }, settings);
		expect(body.messages[0]).toMatchObject({
			role: "assistant",
			content: "a",
			reasoning_content: "one\n\ntwo\n\nraw",
			reasoning_details: details
		});
		expect(body.messages[0]).toHaveProperty("tool_calls");
		expect(body.messages[0].tool_calls.map((call) => call.id)).toEqual(["c"]);
		expect(body.messages[1]).toEqual({ role: "user", content: "u" });
		expect(body.messages[2]).toMatchObject({ role: "assistant", tool_calls: [{ id: "d" }], reasoning_details: details });
		expect(body.messages[2]).not.toHaveProperty("reasoning_content");
		expect(state.dropped).toEqual([]);
	});

	it("attaches reasoning to the assistant turn a function call continues", () => {
		const settings = { reasoningRoundTrip: true };
		const { body } = request(
			{
				model: "m",
				input: [
					{ type: "message", role: "assistant", content: "a" },
					{ type: "reasoning", summary: [{ type: "summary_text", text: "late" }] },
					{ type: "function_call", call_id: "c", name: "f", arguments: "{}" }
				]
			},
			settings
		);
		expect(body.messages).toHaveLength(1);
		expect(body.messages[0]).toMatchObject({ reasoning: "late", tool_calls: [{ id: "c" }] });
	});
});

describe("parameters", () => {
	it("maps sampling, limits, effort, user and stream", () => {
		const { body, state } = request({
			model: "m",
			input: "hi",
			stream: true,
			max_output_tokens: 99,
			temperature: 0.2,
			top_p: 0.9,
			safety_identifier: "u-1",
			metadata: { a: "b" },
			service_tier: "flex",
			prompt_cache_key: "k",
			reasoning: { effort: "high", summary: "auto" },
			text: { verbosity: "low" },
			store: false,
			background: false,
			include: ["reasoning.encrypted_content"],
			stream_options: { include_obfuscation: false },
			truncation: "disabled",
			previous_response_id: null,
			conversation: null,
			prompt: null
		});
		expect(body).toMatchObject({
			stream: true,
			stream_options: { include_usage: true },
			max_completion_tokens: 99,
			temperature: 0.2,
			top_p: 0.9,
			user: "u-1",
			metadata: { a: "b" },
			service_tier: "flex",
			prompt_cache_key: "k",
			reasoning_effort: "high",
			verbosity: "low"
		});
		expect(state.stream).toBe(true);
		expect(state.dropped).toEqual([]);
		expect(state.echo).toMatchObject({
			reasoning: { effort: "high", summary: "auto" },
			store: false,
			user: "u-1",
			previous_response_id: null
		});
	});

	it("prefers user over safety_identifier and echoes the defaults when nothing is set", () => {
		expect(request({ model: "m", input: "x", user: "a", safety_identifier: "b" }).body.user).toBe("a");
		const { body, state } = request({ model: "m", input: "x" });
		expect(body).not.toHaveProperty("user");
		expect(state.echo).toMatchObject({
			instructions: null,
			max_output_tokens: null,
			parallel_tool_calls: true,
			temperature: null,
			text: { format: { type: "text" } },
			tool_choice: "auto",
			tools: [],
			top_p: null,
			truncation: "disabled",
			user: null,
			metadata: {}
		});
	});

	it("maps function tools, tool_choice and parallel_tool_calls", () => {
		const tools = [
			{ type: "function", name: "a", description: "d", parameters: { type: "object" }, strict: true },
			{ type: "function", name: "b", parameters: null }
		];
		const named = request({ model: "m", input: "x", tools, tool_choice: { type: "function", name: "a" }, parallel_tool_calls: false }).body;
		expect(named.tools).toEqual([
			{ type: "function", function: { name: "a", description: "d", parameters: { type: "object" }, strict: true } },
			{ type: "function", function: { name: "b" } }
		]);
		expect(named.tool_choice).toEqual({ type: "function", function: { name: "a" } });
		expect(named.parallel_tool_calls).toBe(false);
		for (const choice of ["auto", "none", "required"])
			expect(request({ model: "m", input: "x", tools, tool_choice: choice }).body.tool_choice).toBe(choice);
		expect(request({ model: "m", input: "x", tools }).body).not.toHaveProperty("tool_choice");
		expect(request({ model: "m", input: "x", tool_choice: "required", parallel_tool_calls: false }).body).not.toHaveProperty("tool_choice");
	});

	it("maps text.format", () => {
		const schema = { type: "object", properties: { a: { type: "string" } } };
		const format = { type: "json_schema", name: "out", description: "d", schema, strict: true };
		expect(request({ model: "m", input: "x", text: { format } }).body.response_format).toEqual({
			type: "json_schema",
			json_schema: { name: "out", description: "d", strict: true, schema }
		});
		expect(request({ model: "m", input: "x", text: { format: { type: "json_object" } } }).body.response_format).toEqual({
			type: "json_object"
		});
		expect(request({ model: "m", input: "x", text: { format: { type: "text" } } }).body).not.toHaveProperty("response_format");
	});
});

describe("refusals", () => {
	it("refuses a body that is not an object, or has no usable input", () => {
		refused(null, undefined, "invalid_request");
		refused([], undefined, "invalid_request");
		refused({ model: "m" }, undefined, "invalid_request", "input");
		refused({ model: "m", input: 5 }, undefined, "invalid_request", "input");
		refused({ model: "m", input: [5] }, undefined, "invalid_request", "input[0]");
		refused({ model: "m", input: [null] }, undefined, "invalid_request", "input[0]");
	});

	it("refuses the stateful parameters with an explicit error", () => {
		refused({ model: "m", input: "x", previous_response_id: "resp_1" }, undefined, "unsupported_field", "previous_response_id");
		refused({ model: "m", input: "x", conversation: "conv_1" }, undefined, "unsupported_field", "conversation");
		refused({ model: "m", input: "x", prompt: { id: "p" } }, undefined, "unsupported_field", "prompt");
		refused({ model: "m", input: "x", store: true }, undefined, "unsupported_field", "store");
		refused({ model: "m", input: "x", background: true }, undefined, "unsupported_field", "background");
	});

	it("refuses hosted tools, custom tools and non-function tool choices", () => {
		for (const type of ["web_search", "file_search", "code_interpreter", "mcp", "computer_use_preview", "custom"]) {
			refused({ model: "m", input: "x", tools: [{ type }] }, undefined, "unsupported_tool", "tools[0]");
		}
		refused({ model: "m", input: "x", tools: [{}] }, undefined, "unsupported_tool", "tools[0]");
		refused({ model: "m", input: "x", tools: [{ type: "function" }] }, undefined, "invalid_request", "tools[0].name");
		const tools = [{ type: "function", name: "a" }];
		refused({ model: "m", input: "x", tools, tool_choice: { type: "web_search" } }, undefined, "unsupported_field", "tool_choice");
		refused(
			{ model: "m", input: "x", tools, tool_choice: { type: "allowed_tools", mode: "auto", tools } },
			undefined,
			"unsupported_field",
			"tool_choice"
		);
		refused({ model: "m", input: "x", tools, tool_choice: { type: "function" } }, undefined, "unsupported_field", "tool_choice");
		refused({ model: "m", input: "x", tools, tool_choice: 5 }, undefined, "unsupported_field", "tool_choice");
	});

	it("refuses input items and parts that have no counterpart", () => {
		for (const item of [
			{ type: "item_reference", id: "msg_1" },
			{ type: "web_search_call", id: "ws_1" },
			{ type: "computer_call", id: "cu_1" },
			{ type: "mcp_call", id: "m_1" },
			{ id: "no-type" }
		]) {
			refused({ model: "m", input: [item] }, undefined, "unsupported_content", "input[0]");
		}
		refused(
			{ model: "m", input: [{ role: "user", content: [{ type: "input_file", filename: "a.pdf" }] }] },
			undefined,
			"unsupported_content",
			"input[0].content[0]"
		);
		refused(
			{ model: "m", input: [{ role: "user", content: [{ type: "input_image" }] }] },
			undefined,
			"unsupported_content",
			"input[0].content[0]"
		);
		refused(
			{ model: "m", input: [{ role: "user", content: [{ type: "input_audio" }] }] },
			undefined,
			"unsupported_content",
			"input[0].content[0]"
		);
		refused({ model: "m", input: [{ role: "user", content: [null] }] }, undefined, "unsupported_content", "input[0].content[0]");
		refused(
			{ model: "m", input: [{ role: "user", content: [{ type: "refusal", refusal: "x" }] }] },
			undefined,
			"unsupported_content",
			"input[0].content[0]"
		);
		refused({ model: "m", input: [{ role: "user", content: 5 }] }, undefined, "invalid_request", "input[0].content");
		refused({ model: "m", input: [{ role: "tool", content: "x" }] }, undefined, "invalid_request", "input[0].role");
		refused({ model: "m", input: [{ type: "message", content: "x" }] }, undefined, "invalid_request", "input[0].role");
		refused(
			{ model: "m", input: [{ type: "function_call_output", call_id: "c", output: 5 }] },
			undefined,
			"invalid_request",
			"input[0].output"
		);
		refused(
			{ model: "m", input: [{ type: "function_call_output", call_id: "c", output: [{ type: "input_image" }] }] },
			undefined,
			"unsupported_content",
			"input[0].output"
		);
		refused(
			{ model: "m", input: [{ type: "function_call_output", call_id: "c", output: [null] }] },
			undefined,
			"unsupported_content",
			"input[0].output"
		);
		refused({ model: "m", input: [{ type: "function_call_output", output: "x" }] }, undefined, "invalid_request", "input[0].call_id");
		refused(
			{ model: "m", input: [{ type: "function_call", call_id: "c", arguments: "{}" }] },
			undefined,
			"invalid_request",
			"input[0].name"
		);
	});

	it("refuses an unusable text.format", () => {
		refused({ model: "m", input: "x", text: { format: { type: "json_schema", schema: {} } } }, undefined, "invalid_request", "text.format");
		refused({ model: "m", input: "x", text: { format: { type: "json_schema", name: "n" } } }, undefined, "invalid_request", "text.format");
		refused({ model: "m", input: "x", text: { format: { type: "grammar" } } }, undefined, "unsupported_field", "text.format");
		refused({ model: "m", input: "x", text: { format: {} } }, undefined, "unsupported_field", "text.format");
		refused({ model: "m", input: "x", text: { format: null } }, undefined, "unsupported_field", "text.format");
	});

	it("drops unmapped fields and lists them, or refuses them under unknownFields: error", () => {
		const body = { model: "m", input: "x", top_logprobs: 3, max_tool_calls: 2, truncation: "auto", context_management: [] };
		expect(request(body).state.dropped).toEqual(["top_logprobs", "max_tool_calls", "context_management", "truncation"]);
		expect(request(body).body).not.toHaveProperty("top_logprobs");
		refused(body, { unknownFields: "error" }, "unsupported_field", "top_logprobs");
		refused({ model: "m", input: "x", truncation: "auto" }, { unknownFields: "error" }, "unsupported_field", "truncation");
	});
});

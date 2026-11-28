/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/api/computer-use.test.vitest.mjs
 *	@Date: 2026-11-28T12:00:00-08:00 (1795896000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-28T12:00:00-08:00 (1795896000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The Responses `computer_use_preview` tool on an Anthropic-protocol upstream: the mapping to Anthropic's computer tool (display size, beta header),
 * `tool_use` to `computer_call` items and back, `computer_call_output` screenshots as tool result images, and the refusal everywhere else. Upstreams are mocks.
 */
import { afterEach, describe, expect, it } from "vitest";
import { closeAll, collect, fakeTransport, make } from "../helpers/translator.mjs";
import { anthropicSse } from "../helpers/streams.mjs";
import { computerAction, computerInput } from "../../src/lib/responses-tools.mjs";
import { strip } from "../../src/lib/hostedtools.mjs";

afterEach(closeAll);

const toChat = (api) => api.convert.openai.responses.to.openai.chat;
const fromChat = (api) => api.convert.openai.chat.to.openai.responses;
const tool = { type: "computer_use_preview", display_width: 1280, display_height: 800, environment: "browser" };
const claude = { url: "https://api.anthropic.com", backend: "anthropic", models: ["claude-x"] };
const message = (content) => ({
	id: "msg_1",
	type: "message",
	role: "assistant",
	model: "claude-x",
	content,
	stop_reason: content.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn",
	usage: { input_tokens: 10, output_tokens: 5 }
});
const use = (input, id = "toolu_1") => ({ type: "tool_use", id, name: "computer", input });
const png = "data:image/png;base64,iVBORw0KGgo=";

async function start(replies, upstream = claude, settings = {}) {
	let turn = 0;
	const transport = fakeTransport(() => replies[turn++]);
	const api = await make({ front: "openai", upstreams: [upstream], transport, detect: false, settings });
	return { api, transport };
}
const sent = (transport, at = 0) => JSON.parse(transport.calls[at].init.body);
const run = async (api, body, settings = {}) => {
	const { body: chat, state } = toChat(api).request(body, settings);
	const reply = await api.send(chat, { wire: "responses" });
	if (reply.status >= 400) return { reply };
	if (reply.stream) return { reply, events: await collect(fromChat(api).stream(reply.stream, state)) };
	return { reply, response: fromChat(api).response(reply.body, state) };
};

describe("the actions", () => {
	it("maps Anthropic's actions to Responses actions", () => {
		const at = [10, 20];
		const cases = [
			[{ action: "screenshot" }, { type: "screenshot" }],
			[
				{ action: "left_click", coordinate: at },
				{ type: "click", button: "left", x: 10, y: 20 }
			],
			[
				{ action: "right_click", coordinate: at },
				{ type: "click", button: "right", x: 10, y: 20 }
			],
			[
				{ action: "middle_click", coordinate: at },
				{ type: "click", button: "wheel", x: 10, y: 20 }
			],
			[
				{ action: "double_click", coordinate: at },
				{ type: "double_click", x: 10, y: 20 }
			],
			[
				{ action: "triple_click", coordinate: at },
				{ type: "double_click", x: 10, y: 20 }
			],
			[
				{ action: "mouse_move", coordinate: at },
				{ type: "move", x: 10, y: 20 }
			],
			[
				{ action: "left_click_drag", start_coordinate: [1, 2], coordinate: at },
				{
					type: "drag",
					path: [
						{ x: 1, y: 2 },
						{ x: 10, y: 20 }
					]
				}
			],
			[
				{ action: "scroll", coordinate: at, scroll_direction: "down", scroll_amount: 3 },
				{ type: "scroll", x: 10, y: 20, scroll_x: 0, scroll_y: 300 }
			],
			[
				{ action: "scroll", coordinate: at, scroll_direction: "up" },
				{ type: "scroll", x: 10, y: 20, scroll_x: 0, scroll_y: -100 }
			],
			[
				{ action: "scroll", coordinate: at, scroll_direction: "left", scroll_amount: 2 },
				{ type: "scroll", x: 10, y: 20, scroll_x: -200, scroll_y: 0 }
			],
			[
				{ action: "scroll", coordinate: at, scroll_direction: "right", scroll_amount: 2 },
				{ type: "scroll", x: 10, y: 20, scroll_x: 200, scroll_y: 0 }
			],
			[
				{ action: "type", text: "hello" },
				{ type: "type", text: "hello" }
			],
			[
				{ action: "key", text: "ctrl+s" },
				{ type: "keypress", keys: ["ctrl", "s"] }
			],
			[
				{ action: "hold_key", text: "shift", duration: 2 },
				{ type: "keypress", keys: ["shift"] }
			],
			[{ action: "wait", duration: 3 }, { type: "wait" }]
		];
		for (const [input, action] of cases) expect(computerAction(input), JSON.stringify(input)).toEqual(action);
	});

	it("turns what has no counterpart, or lacks what it needs, into a screenshot", () => {
		for (const input of [
			{ action: "cursor_position" },
			{ action: "left_mouse_down" },
			{ action: "zoom", region: [0, 0, 1, 1] },
			{ action: "nonsense" },
			{},
			{ action: "left_click" },
			{ action: "left_click", coordinate: ["a", 1] },
			{ action: "left_click_drag", coordinate: [1, 2] },
			{ action: "left_click_drag", start_coordinate: [1, 2] },
			{ action: "scroll", coordinate: [1, 2], scroll_direction: "sideways" },
			{ action: "scroll", scroll_direction: "up" },
			{ action: "type" },
			{ action: "key" }
		]) {
			expect(computerAction(input), JSON.stringify(input)).toEqual({ type: "screenshot" });
		}
	});

	it("maps Responses actions back to Anthropic's input", () => {
		const cases = [
			[{ type: "screenshot" }, { action: "screenshot" }],
			[
				{ type: "click", button: "left", x: 1, y: 2 },
				{ action: "left_click", coordinate: [1, 2] }
			],
			[
				{ type: "click", button: "right", x: 1, y: 2 },
				{ action: "right_click", coordinate: [1, 2] }
			],
			[
				{ type: "click", button: "wheel", x: 1, y: 2 },
				{ action: "middle_click", coordinate: [1, 2] }
			],
			[
				{ type: "click", button: "back", x: 1, y: 2 },
				{ action: "left_click", coordinate: [1, 2] }
			],
			[
				{ type: "double_click", x: 1, y: 2 },
				{ action: "double_click", coordinate: [1, 2] }
			],
			[
				{ type: "move", x: 1, y: 2 },
				{ action: "mouse_move", coordinate: [1, 2] }
			],
			[
				{
					type: "drag",
					path: [
						{ x: 1, y: 2 },
						{ x: 3, y: 4 },
						{ x: 5, y: 6 }
					]
				},
				{ action: "left_click_drag", start_coordinate: [1, 2], coordinate: [5, 6] }
			],
			[{ type: "drag" }, { action: "left_click_drag", start_coordinate: [undefined, undefined], coordinate: [undefined, undefined] }],
			[
				{ type: "scroll", x: 1, y: 2, scroll_x: 0, scroll_y: 250 },
				{ action: "scroll", coordinate: [1, 2], scroll_direction: "down", scroll_amount: 3 }
			],
			[
				{ type: "scroll", x: 1, y: 2, scroll_x: 0, scroll_y: -100 },
				{ action: "scroll", coordinate: [1, 2], scroll_direction: "up", scroll_amount: 1 }
			],
			[
				{ type: "scroll", x: 1, y: 2, scroll_x: -300, scroll_y: 0 },
				{ action: "scroll", coordinate: [1, 2], scroll_direction: "left", scroll_amount: 3 }
			],
			[
				{ type: "scroll", x: 1, y: 2, scroll_x: 300 },
				{ action: "scroll", coordinate: [1, 2], scroll_direction: "right", scroll_amount: 3 }
			],
			[
				{ type: "scroll", x: 1, y: 2 },
				{ action: "scroll", coordinate: [1, 2], scroll_direction: "down", scroll_amount: 1 }
			],
			[
				{ type: "type", text: "hi" },
				{ action: "type", text: "hi" }
			],
			[{ type: "type" }, { action: "type", text: "" }],
			[
				{ type: "keypress", keys: ["CTRL", "S"] },
				{ action: "key", text: "CTRL+S" }
			],
			[{ type: "keypress" }, { action: "key", text: "" }],
			[{ type: "wait" }, { action: "wait", duration: 2 }],
			[{ type: "other" }, { action: "screenshot" }]
		];
		for (const [action, input] of cases) expect(computerInput(action), JSON.stringify(action)).toEqual(input);
		expect(computerInput(undefined)).toEqual({ action: "screenshot" });
		expect(computerInput({ type: "click", button: "left" })).toEqual({ action: "left_click", coordinate: undefined });
	});
});

describe("the request converter", () => {
	it("keeps the tool with its display size (1024 by 768 when it has none), and refuses a bad size or a name clash", async () => {
		const { api } = await start([]);
		const request = (tools, extra = {}) => toChat(api).request({ model: "m", input: "x", tools, ...extra });
		const kept = request([tool]);
		expect(kept.body.tools[0].llmt_computer).toEqual({ at: "tools[0]", width: 1280, height: 800 });
		expect(kept.state.clientTools).toEqual({ computer: "computer" });
		expect(request([{ type: "computer" }]).body.tools[0].llmt_computer).toMatchObject({ width: 1024, height: 768 });
		for (const change of [{ display_width: 0 }, { display_height: 1.5 }, { display_width: "wide" }]) {
			expect(() => request([{ ...tool, ...change }])).toThrowError(
				expect.objectContaining({ code: "invalid_request", param: expect.stringMatching(/^tools\[0\]\.display_/) })
			);
		}
		expect(() => request([{ type: "function", name: "computer" }, tool])).toThrowError(
			expect.objectContaining({ code: "unsupported_tool", param: "tools[1]" })
		);
		expect(request([tool], { tool_choice: { type: "computer_use_preview" } }).body.tool_choice).toEqual({
			type: "function",
			function: { name: "computer" }
		});
	});

	it("passes the tool on as it is with native passthrough", async () => {
		const { api } = await start([]);
		const { body } = toChat(api).request(
			{ model: "m", input: [{ type: "computer_call", id: "c", call_id: "k", action: { type: "screenshot" } }], tools: [tool] },
			{ hostedTools: "native" }
		);
		expect(body.tools[0].llmt_hosted).toMatchObject({ kind: "computer_use_preview", native: true });
		expect(body.messages[0].llmt_native.item.type).toBe("computer_call");
	});

	it("turns computer_call and its output into a tool call and a tool message that carries the screenshot", async () => {
		const { api } = await start([]);
		const { body } = toChat(api).request({
			model: "m",
			input: [
				{ role: "user", content: "go" },
				{
					type: "computer_call",
					id: "cu_1",
					call_id: "k1",
					action: { type: "click", button: "left", x: 1, y: 2 },
					pending_safety_checks: []
				},
				{ type: "computer_call_output", call_id: "k1", output: { type: "computer_screenshot", image_url: png } }
			]
		});
		expect(body.messages[1].tool_calls[0]).toEqual({
			id: "k1",
			type: "function",
			function: { name: "computer", arguments: '{"action":"left_click","coordinate":[1,2]}' }
		});
		expect(body.messages[2]).toEqual({ role: "tool", tool_call_id: "k1", content: "", llmt_screenshot: { url: png, at: "input[2]" } });
		for (const output of [
			undefined,
			{ type: "other", image_url: png },
			{ type: "computer_screenshot" },
			{ type: "computer_screenshot", image_url: "" },
			{ type: "computer_screenshot", file_id: "f" }
		]) {
			expect(() => toChat(api).request({ model: "m", input: [{ type: "computer_call_output", call_id: "k", output }] })).toThrowError(
				expect.objectContaining({ code: "unsupported_content", param: "input[0].output" })
			);
		}
	});

	it("strips the markers for a token count", async () => {
		const { api } = await start([]);
		const { body } = toChat(api).request({
			model: "m",
			input: [{ type: "computer_call_output", call_id: "k", output: { type: "computer_screenshot", image_url: png } }],
			tools: [tool]
		});
		const plain = strip(body);
		expect(JSON.stringify(plain)).not.toContain("llmt_");
		expect(plain.messages[0].content).toBe("[screenshot]");
		expect(plain.tools[0].function.name).toBe("computer");
		expect((await api.token.count(body)).input_tokens).toBeGreaterThan(0);
	});
});

describe("an Anthropic upstream", () => {
	it("offers Anthropic's computer tool with the display size and its beta, and returns the tool_use as a computer_call", async () => {
		const { api, transport } = await start([
			{ body: message([{ type: "text", text: "Clicking." }, use({ action: "left_click", coordinate: [5, 6] })]) }
		]);
		const { response } = await run(api, { model: "claude-x", input: "open it", tools: [tool] });
		const body = sent(transport);
		expect(body.tools).toEqual([{ type: "computer_20251124", name: "computer", display_width_px: 1280, display_height_px: 800 }]);
		expect(transport.calls[0].init.headers["anthropic-beta"]).toBe("computer-use-2025-11-24");
		expect(response.output.map((item) => item.type)).toEqual(["message", "computer_call"]);
		expect(response.output[1]).toMatchObject({
			call_id: "toolu_1",
			status: "completed",
			action: { type: "click", button: "left", x: 5, y: 6 },
			pending_safety_checks: []
		});
		expect(response.output[1].id).toMatch(/^cu_[0-9a-f]{24}$/);
	});

	it("takes the other computer tool version from the computerTool setting, with its own beta", async () => {
		const { api, transport } = await start([{ body: message([{ type: "text", text: "ok" }]) }], {
			...claude,
			settings: { computerTool: "computer_20250124" }
		});
		await run(api, { model: "claude-x", input: "x", tools: [tool] });
		expect(sent(transport).tools[0].type).toBe("computer_20250124");
		expect(transport.calls[0].init.headers["anthropic-beta"]).toBe("computer-use-2025-01-24");
	});

	it("sends the call back with the screenshot as an image in the tool result", async () => {
		const { api, transport } = await start([
			{ body: message([{ type: "text", text: "Done." }]) },
			{ body: message([{ type: "text", text: "Again." }]) }
		]);
		const input = (url) => [
			{ role: "user", content: "go" },
			{ type: "computer_call", id: "cu_1", call_id: "toolu_1", action: { type: "type", text: "hi" } },
			{ type: "computer_call_output", call_id: "toolu_1", output: { type: "computer_screenshot", image_url: url } }
		];
		await run(api, { model: "claude-x", input: input(png), tools: [tool] });
		const [assistant, result] = sent(transport).messages.slice(1);
		expect(assistant.content[0]).toMatchObject({
			type: "tool_use",
			id: "toolu_1",
			name: "computer",
			input: { action: "type", text: "hi" }
		});
		expect(result.content[0]).toEqual({
			type: "tool_result",
			tool_use_id: "toolu_1",
			content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }]
		});
		await run(api, { model: "claude-x", input: input("https://shots.test/1.png"), tools: [tool] });
		expect(sent(transport, 1).messages[2].content[0].content[0]).toEqual({
			type: "image",
			source: { type: "url", url: "https://shots.test/1.png" }
		});
	});

	it("streams the computer_call when its call closes", async () => {
		const stream = anthropicSse([
			{
				data: {
					type: "message_start",
					message: {
						id: "m",
						type: "message",
						role: "assistant",
						model: "claude-x",
						content: [],
						usage: { input_tokens: 5, output_tokens: 0 }
					}
				}
			},
			{ data: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_9", name: "computer", input: {} } } },
			{
				data: {
					type: "content_block_delta",
					index: 0,
					delta: { type: "input_json_delta", partial_json: '{"action":"scroll","coordinate":[3,4],' }
				}
			},
			{
				data: {
					type: "content_block_delta",
					index: 0,
					delta: { type: "input_json_delta", partial_json: '"scroll_direction":"down","scroll_amount":2}' }
				}
			},
			{ data: { type: "content_block_stop", index: 0 } },
			{ data: { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 7 } } },
			{ data: { type: "message_stop" } }
		]);
		const { api } = await start([{ status: 200, body: stream, headers: { "content-type": "text/event-stream" } }]);
		const { events } = await run(api, { model: "claude-x", input: "go", stream: true, tools: [tool] });
		const done = events.find((event) => event.event === "response.output_item.done").data.item;
		expect(done).toMatchObject({
			type: "computer_call",
			call_id: "toolu_9",
			action: { type: "scroll", x: 3, y: 4, scroll_x: 0, scroll_y: 200 },
			pending_safety_checks: []
		});
		expect(events.find((event) => event.event === "response.output_item.added").data.item).toMatchObject({
			type: "computer_call",
			status: "in_progress"
		});
	});
});

describe("other upstreams", () => {
	const chat = { url: "http://vllm.test", backend: "vllm", api: "chat", models: ["qwen"] };

	it("refuses the tool and a screenshot with a clear message", async () => {
		const { api, transport } = await start([], chat);
		const first = await run(api, { model: "qwen", input: "go", tools: [tool] });
		expect(first.reply.status).toBe(400);
		expect(first.reply.body.error).toMatchObject({ code: "unsupported_tool", param: "tools[0]" });
		expect(first.reply.body.error.message).toContain("Anthropic Messages API");
		const second = await run(api, {
			model: "qwen",
			input: [
				{ role: "user", content: "go" },
				{ type: "computer_call", id: "c", call_id: "k", action: { type: "screenshot" } },
				{ type: "computer_call_output", call_id: "k", output: { type: "computer_screenshot", image_url: png } }
			]
		});
		expect(second.reply.body.error).toMatchObject({ code: "unsupported_content", param: "input[2]" });
		expect(second.reply.body.error.message).toContain("Anthropic Messages API");
		expect(transport.calls).toHaveLength(0);
	});

	it("is sent as it is to a Responses upstream with hostedTools native", async () => {
		const upstream = { url: "http://responses.test", backend: "compatible", api: "responses", models: ["gpt-x"] };
		const answer = {
			id: "resp_1",
			object: "response",
			created_at: 1,
			status: "completed",
			model: "gpt-x",
			output: [{ type: "computer_call", id: "cu_1", call_id: "k", action: { type: "screenshot" }, pending_safety_checks: [] }]
		};
		const { api, transport } = await start([{ body: answer }], upstream, { hostedTools: "native" });
		const { response } = await run(api, { model: "gpt-x", input: "go", tools: [tool] }, { hostedTools: "native" });
		expect(sent(transport).tools).toEqual([tool]);
		expect(response.output).toEqual(answer.output);
	});
});

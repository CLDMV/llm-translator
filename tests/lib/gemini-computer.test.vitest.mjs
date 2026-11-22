/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/gemini-computer.test.vitest.mjs
 *	@Date: 2026-11-22T10:00:00-08:00 (1795370400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T10:00:00-08:00 (1795370400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Computer use between Anthropic and Gemini: image sizes from headers, every Gemini action as Anthropic's calls and back, modifier clicks, scaling, key names, and the errors for what cannot be carried over.
 */
import { describe, expect, it } from "vitest";
import {
	ACTIONS,
	DESKTOP,
	EXCLUDED,
	PIXELS_PER_CLICK,
	converter,
	dimensions,
	gemini,
	ids,
	inverse,
	isTool,
	prepare,
	sizeOf,
	xdotool
} from "../../src/lib/gemini-computer.mjs";

/** A PNG header of a width and height (the rest is not read). */
const png = (width, height) => {
	const head = Buffer.alloc(33);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head);
	head.writeUInt32BE(13, 8);
	head.write("IHDR", 12);
	head.writeUInt32BE(width, 16);
	head.writeUInt32BE(height, 20);
	return head.toString("base64");
};

/** A JPEG with an APP0 segment, a DHT segment (marker 0xC4, which is not a frame) and a frame of a width and height. */
const jpeg = (width, height) => {
	const frame = Buffer.alloc(19);
	frame.writeUInt16BE(0xffc0, 0);
	frame.writeUInt16BE(17, 2);
	frame.writeUInt8(8, 4);
	frame.writeUInt16BE(height, 5);
	frame.writeUInt16BE(width, 7);
	return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 6, 0, 0, 0, 0]), Buffer.from([0xff, 0xc4, 0, 4, 0, 0]), frame]).toString(
		"base64"
	);
};

const SIZE = { width: 2000, height: 1000 };
const run = (calls, size = SIZE) => {
	const convert = converter(size);
	const out = calls.flatMap(([name, args]) => convert.push(name, args));
	convert.finish();
	return out;
};

describe("images and the tool", () => {
	it("reads the size of a PNG and of a JPEG from the header, and gives up on anything else", () => {
		expect(dimensions(png(1280, 800))).toEqual({ width: 1280, height: 800 });
		expect(dimensions(jpeg(1024, 768))).toEqual({ width: 1024, height: 768 });
		expect(dimensions("AAAA")).toBeNull();
		expect(dimensions(Buffer.from([0xff, 0xd8, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0]).toString("base64"))).toBeNull();
		expect(dimensions(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0, 0]).toString("base64"))).toBeNull();
		const notPng = Buffer.alloc(33);
		Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(notPng);
		expect(dimensions(notPng.toString("base64"))).toBeNull();
	});

	it("takes the size of the latest screenshot: the last image of a tool result, else one in a user message", () => {
		const shot = (width, height, kind = png) => ({
			type: "image",
			source: { type: "base64", media_type: "image/png", data: kind(width, height) }
		});
		const result = (content) => ({ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content }] });
		expect(sizeOf([])).toBeNull();
		expect(
			sizeOf([
				{ role: "user", content: "hi" },
				{ role: "assistant", content: [] }
			])
		).toBeNull();
		expect(
			sizeOf([
				result([shot(100, 50)]),
				{ role: "assistant", content: "x" },
				result([{ type: "text", text: "ok" }, shot(200, 100, jpeg), shot(300, 150)])
			])
		).toEqual({
			width: 300,
			height: 150
		});
		expect(sizeOf([result([shot(100, 50)]), result("OK")])).toEqual({ width: 100, height: 50 });
		expect(sizeOf([{ role: "user", content: [{ type: "text", text: "x" }, shot(640, 480)] }])).toEqual({ width: 640, height: 480 });
		expect(
			sizeOf([
				result([
					{ type: "image", source: { type: "url", url: "x" } },
					{ type: "image", source: { type: "base64", data: "AAAA" } }
				])
			])
		).toBeNull();
	});

	it("knows the computer tool by its type, and maps every desktop action", () => {
		for (const type of ["computer_20250124", "computer_20251124", "computer_toolset_20260801"])
			expect(isTool({ type, name: "computer" })).toBe(true);
		expect(isTool({ type: "custom", name: "computer" })).toBe(false);
		expect(isTool({ name: "computer" })).toBe(false);
		expect(isTool(null)).toBe(false);
		expect(DESKTOP).toHaveLength(17);
		expect(DESKTOP.every((name) => ACTIONS.has(name))).toBe(true);
		expect(EXCLUDED).toEqual([]);
		expect(ids("a", 1)).toEqual(["a"]);
		expect(ids("a", 3)).toEqual(["a__0of3", "a__1of3", "a__2of3"]);
	});
});

describe("key names", () => {
	it("maps Gemini's names to xdotool's and back", () => {
		expect(
			[
				"Control",
				"ctrl",
				"Enter",
				"Return",
				"Escape",
				"Backspace",
				"ArrowUp",
				"ArrowDown",
				"ArrowLeft",
				"ArrowRight",
				"Shift",
				"Alt",
				"Meta",
				"Command",
				"PageUp",
				"PageDown",
				"Home",
				"End",
				" ",
				"F5",
				"a"
			].map(xdotool)
		).toEqual([
			"ctrl",
			"ctrl",
			"Return",
			"Return",
			"Escape",
			"BackSpace",
			"Up",
			"Down",
			"Left",
			"Right",
			"shift",
			"alt",
			"super",
			"super",
			"Prior",
			"Next",
			"Home",
			"End",
			"space",
			"F5",
			"a"
		]);
		expect(xdotool("toString")).toBe("toString");
		expect(["ctrl", "Return", "BackSpace", "Up", "Prior", "Next", "space", "super", "F5", "q", "toString"].map(gemini)).toEqual([
			"Control",
			"Enter",
			"Backspace",
			"ArrowUp",
			"PageUp",
			"PageDown",
			" ",
			"Meta",
			"F5",
			"q",
			"toString"
		]);
	});
});

describe("Gemini actions as Anthropic's calls", () => {
	it("clicks, scaled from the 0-999 grid to pixels of the latest screenshot and kept inside it", () => {
		expect(run([["click", { x: 500, y: 250 }]])).toEqual([{ action: "left_click", coordinate: [1000, 250] }]);
		for (const [name, action] of [
			["double_click", "double_click"],
			["triple_click", "triple_click"],
			["middle_click", "middle_click"],
			["right_click", "right_click"]
		]) {
			expect(run([[name, { x: 0, y: 999 }]])).toEqual([{ action, coordinate: [0, 999] }]);
		}
		expect(run([["click", { x: 1500, y: -5 }]])).toEqual([{ action: "left_click", coordinate: [1999, 0] }]);
		expect(run([["move", { x: 100, y: 100 }]])).toEqual([{ action: "mouse_move", coordinate: [200, 100] }]);
	});

	it("screenshots, waits and typing", () => {
		expect(run([["take_screenshot", {}]], null)).toEqual([{ action: "screenshot" }]);
		expect(run([["wait", { seconds: 3 }]])).toEqual([{ action: "wait", duration: 3 }]);
		expect(run([["wait", {}]])).toEqual([{ action: "wait", duration: 1 }]);
		expect(run([["type", { text: "hello" }]])).toEqual([{ action: "type", text: "hello" }]);
		expect(run([["type", { text: "hello", press_enter: true }]])).toEqual([
			{ action: "type", text: "hello" },
			{ action: "key", text: "Return" }
		]);
		expect(run([["type", {}]])).toEqual([{ action: "type", text: "" }]);
	});

	it("buttons held and released are a move and the button, and a drag has both ends", () => {
		expect(run([["mouse_down", { x: 500, y: 500 }]])).toEqual([
			{ action: "mouse_move", coordinate: [1000, 500] },
			{ action: "left_mouse_down" }
		]);
		expect(run([["mouse_up", { x: 250, y: 500 }]])).toEqual([
			{ action: "mouse_move", coordinate: [500, 500] },
			{ action: "left_mouse_up" }
		]);
		expect(run([["drag_and_drop", { start_x: 100, start_y: 200, end_x: 300, end_y: 400 }]])).toEqual([
			{ action: "left_click_drag", start_coordinate: [200, 200], coordinate: [600, 400] }
		]);
	});

	it("keys: one key, several keys in xdotool names, and none", () => {
		expect(run([["press_key", { key: "Enter" }]])).toEqual([{ action: "key", text: "Return" }]);
		expect(run([["hotkey", { keys: ["Control", "Shift", "t"] }]])).toEqual([{ action: "key", text: "ctrl+shift+t" }]);
		expect(run([["hotkey", {}]])).toEqual([{ action: "key", text: "" }]);
	});

	it("scrolls by clicks of a fixed number of pixels, at least one", () => {
		expect(PIXELS_PER_CLICK).toBe(100);
		expect(run([["scroll", { x: 500, y: 500, direction: "down", magnitude_in_pixels: 300 }]])).toEqual([
			{ action: "scroll", coordinate: [1000, 500], scroll_direction: "down", scroll_amount: 3 }
		]);
		expect(run([["scroll", { x: 0, y: 0, direction: "left", magnitude_in_pixels: 10 }]])[0]).toMatchObject({
			scroll_direction: "left",
			scroll_amount: 1
		});
		expect(run([["scroll", { x: 0, y: 0 }]])[0]).toMatchObject({ scroll_direction: "down", scroll_amount: 3 });
		expect(run([["scroll", { x: 0, y: 0, direction: "up", magnitude_in_pixels: 950 }]])[0]).toMatchObject({ scroll_amount: 10 });
	});

	it("browser actions are keystrokes: the address bar and the history", () => {
		expect(run([["navigate", { url: "https://example.com" }]], null)).toEqual([
			{ action: "key", text: "ctrl+l" },
			{ action: "type", text: "https://example.com" },
			{ action: "key", text: "Return" }
		]);
		expect(run([["navigate", {}]], null)[1]).toEqual({ action: "type", text: "" });
		expect(run([["go_back", {}]], null)).toEqual([{ action: "key", text: "alt+Left" }]);
		expect(run([["go_forward", {}]], null)).toEqual([{ action: "key", text: "alt+Right" }]);
	});

	it("key_down and key_up around a click are the click's modifier, also with several keys", () => {
		expect(
			run([
				["key_down", { key: "Control" }],
				["click", { x: 500, y: 500 }],
				["key_up", { key: "Control" }]
			])
		).toEqual([{ action: "left_click", coordinate: [1000, 500], text: "ctrl" }]);
		expect(
			run([
				["key_down", { key: "Shift" }],
				["key_down", { key: "Alt" }],
				["right_click", { x: 0, y: 0 }],
				["key_up", { key: "Alt" }],
				["key_up", { key: "Shift" }]
			])
		).toEqual([{ action: "right_click", coordinate: [0, 0], text: "shift+alt" }]);
	});

	it("says so when the actions need a screenshot that does not exist, or cannot be carried over", () => {
		for (const [name, args] of [
			["click", { x: 1, y: 1 }],
			["drag_and_drop", {}],
			["scroll", { x: 1, y: 1 }]
		]) {
			expect(() => run([[name, args]], null)).toThrow(/no screenshot yet/);
		}
		const failing = (calls, pattern) => expect(() => run(calls)).toThrow(pattern);
		failing([["key_down", { key: "Control" }]], /holds ctrl with key_down and never closes it/);
		failing([["key_up", { key: "Control" }]], /key_up of Control does not close a key held/);
		failing(
			[
				["key_down", { key: "Control" }],
				["key_up", { key: "Control" }]
			],
			/key_up of Control does not close/
		);
		failing(
			[
				["key_down", { key: "Control" }],
				["type", { text: "x" }]
			],
			/type while a key is held/
		);
		failing(
			[
				["key_down", { key: "Control" }],
				["click", { x: 1, y: 1 }],
				["click", { x: 1, y: 1 }]
			],
			/click while a key is held/
		);
		failing(
			[
				["key_down", { key: "Control" }],
				["click", { x: 1, y: 1 }],
				["key_down", { key: "Shift" }]
			],
			/key_down after the click/
		);
		failing(
			[
				["key_down", { key: "Control" }],
				["click", { x: 1, y: 1 }],
				["key_up", { key: "Shift" }]
			],
			/key_up of Shift does not close/
		);
		expect(() => run([["key_down", { key: "Control" }]])).toThrowError(
			expect.objectContaining({ code: "unsupported_computer_action", status: 502 })
		);
	});
});

describe("Anthropic's calls as Gemini actions", () => {
	const turn = (inputs, size = SIZE, last = [500, 500]) => inverse(inputs, size, last);

	it("every Anthropic action, with pixels turned into grid positions", () => {
		const at = { coordinate: [1000, 250] };
		expect(turn([{ action: "screenshot" }], null)).toEqual([{ name: "take_screenshot", args: {} }]);
		for (const [action, name] of [
			["left_click", "click"],
			["double_click", "double_click"],
			["triple_click", "triple_click"],
			["middle_click", "middle_click"],
			["right_click", "right_click"]
		]) {
			expect(turn([{ action, ...at }])).toEqual([{ name, args: { x: 500, y: 250 } }]);
		}
		expect(turn([{ action: "mouse_move", ...at }])).toEqual([{ name: "move", args: { x: 500, y: 250 } }]);
		expect(turn([{ action: "left_click_drag", start_coordinate: [0, 0], coordinate: [2000, 1000] }])).toEqual([
			{ name: "drag_and_drop", args: { start_x: 0, start_y: 0, end_x: 999, end_y: 999 } }
		]);
		expect(turn([{ action: "type", text: "x" }])).toEqual([{ name: "type", args: { text: "x" } }]);
		expect(turn([{ action: "type" }])).toEqual([{ name: "type", args: { text: "" } }]);
		expect(turn([{ action: "key", text: "Return" }])).toEqual([{ name: "press_key", args: { key: "Enter" } }]);
		expect(turn([{ action: "key", text: "ctrl+c" }])).toEqual([{ name: "hotkey", args: { keys: ["Control", "c"] } }]);
		expect(turn([{ action: "key" }])).toEqual([{ name: "press_key", args: { key: "" } }]);
		expect(turn([{ action: "wait", duration: 2.4 }])).toEqual([{ name: "wait", args: { seconds: 2 } }]);
		expect(turn([{ action: "wait" }])).toEqual([{ name: "wait", args: { seconds: 1 } }]);
		expect(turn([{ action: "scroll", coordinate: [1000, 500], scroll_direction: "up", scroll_amount: 5 }])).toEqual([
			{ name: "scroll", args: { x: 500, y: 500, direction: "up", magnitude_in_pixels: 500 } }
		]);
		expect(turn([{ action: "scroll" }])).toEqual([
			{ name: "scroll", args: { x: 500, y: 500, direction: "down", magnitude_in_pixels: 300 } }
		]);
		expect(turn([{ action: "scroll", scroll_amount: 50, coordinate: [0, 0] }])[0].args.magnitude_in_pixels).toBe(999);
	});

	it("a modifier on a click is key_down, the click and key_up", () => {
		expect(turn([{ action: "left_click", coordinate: [1000, 500], text: "ctrl+shift" }])).toEqual([
			{ name: "key_down", args: { key: "Control" } },
			{ name: "key_down", args: { key: "Shift" } },
			{ name: "click", args: { x: 500, y: 500 } },
			{ name: "key_up", args: { key: "Shift" } },
			{ name: "key_up", args: { key: "Control" } }
		]);
		expect(turn([{ action: "left_click", coordinate: [0, 0], text: "" }])).toHaveLength(1);
	});

	it("the calls one Gemini action was split into are that action again", () => {
		expect(turn([{ action: "mouse_move", coordinate: [1000, 500] }, { action: "left_mouse_down" }])).toEqual([
			{ name: "mouse_down", args: { x: 500, y: 500 } }
		]);
		expect(turn([{ action: "mouse_move", coordinate: [1000, 500] }, { action: "left_mouse_up" }])).toEqual([
			{ name: "mouse_up", args: { x: 500, y: 500 } }
		]);
		expect(
			turn([
				{ action: "type", text: "hi" },
				{ action: "key", text: "Return" }
			])
		).toEqual([{ name: "type", args: { text: "hi", press_enter: true } }]);
		expect(
			turn(
				[
					{ action: "key", text: "ctrl+l" },
					{ action: "type", text: "https://a.example" },
					{ action: "key", text: "Return" }
				],
				null
			)
		).toEqual([{ name: "navigate", args: { url: "https://a.example" } }]);
		expect(turn([{ action: "key", text: "alt+Left" }], null)).toEqual([{ name: "go_back", args: {} }]);
		expect(turn([{ action: "key", text: "alt+Right" }], null)).toEqual([{ name: "go_forward", args: {} }]);
		expect(
			turn([
				{ action: "type", text: "a" },
				{ action: "wait", duration: 1 }
			]).map((call) => call.name)
		).toEqual(["type", "wait"]);
	});

	it("a button press with no position uses the last one", () => {
		const last = [10, 20];
		expect(turn([{ action: "left_mouse_down" }], SIZE, last)).toEqual([{ name: "mouse_down", args: { x: 10, y: 20 } }]);
		expect(turn([{ action: "left_mouse_up" }], SIZE, last)).toEqual([{ name: "mouse_up", args: { x: 10, y: 20 } }]);
		turn([{ action: "mouse_move", coordinate: [2000, 1000] }], SIZE, last);
		expect(last).toEqual([999, 999]);
		expect(turn([{ action: "scroll", scroll_direction: "left" }], SIZE, last)[0].args).toMatchObject({ x: 999, y: 999, direction: "left" });
	});

	it("refuses an action Gemini has no equivalent of, and coordinates with no screenshot", () => {
		for (const action of ["cursor_position", "hold_key", "zoom", undefined]) {
			expect(() => turn([{ action }])).toThrow(/has no Gemini equivalent/);
		}
		expect(() => turn([{ action: "left_click", coordinate: [1, 1] }], null)).toThrow(/no screenshot yet/);
	});
});

describe("prepare: a request that uses the computer tool", () => {
	const shot = (data) => ({ type: "image", source: { type: "base64", media_type: "image/png", data } });
	const tools = [
		{ type: "computer_20250124", name: "computer", display_width_px: 2000, display_height_px: 1000 },
		{ name: "Read", input_schema: { type: "object" } },
		{ type: "bash_20250124", name: "bash" }
	];

	it("is null without the tool", () => {
		expect(prepare({ model: "m", messages: [] })).toBeNull();
		expect(prepare({ model: "m", tools: [{ name: "x" }], messages: [] })).toBeNull();
		expect(prepare(null)).toBeNull();
		expect(prepare({ tools })).toMatchObject({ size: null });
	});

	it("rewrites the history into Gemini's actions and sets the screenshots apart for the function responses", () => {
		const body = {
			model: "m",
			tool_choice: { type: "tool", name: "computer" },
			tools,
			messages: [
				{ role: "user", content: "go" },
				{
					role: "assistant",
					content: [
						{ type: "text", text: "ok" },
						{ type: "tool_use", id: "a", name: "computer", input: { action: "screenshot" } }
					]
				},
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "a", content: [shot(png(2000, 1000))] }] },
				{
					role: "assistant",
					content: [
						{ type: "tool_use", id: "b__0of2", name: "computer", input: { action: "type", text: "hi" } },
						{ type: "tool_use", id: "r", name: "Read", input: {} },
						{ type: "tool_use", id: "b__1of2", name: "computer", input: { action: "key", text: "Return" } },
						{ type: "tool_use", id: "c", name: "computer", input: { action: "left_click", coordinate: [1000, 500], text: "ctrl" } }
					]
				},
				{
					role: "user",
					content: [
						{ type: "tool_result", tool_use_id: "b__0of2", content: "typed" },
						{ type: "tool_result", tool_use_id: "r", content: "file" },
						{ type: "tool_result", tool_use_id: "b__1of2", content: [{ type: "text", text: "done" }, shot(png(2000, 1000))] },
						{ type: "tool_result", tool_use_id: "c", content: [shot(png(2000, 1000))], is_error: true },
						{ type: "text", text: "next" }
					]
				}
			]
		};
		const out = prepare(body);
		expect(out.size).toEqual({ width: 2000, height: 1000 });
		expect(out.custom).toEqual(new Set(["Read"]));
		expect(out.body.tools.map((tool) => tool.name)).toEqual(["Read", "bash"]);
		expect(out.body.tool_choice).toEqual({ type: "any" });
		const calls = out.body.messages
			.filter((message) => message.role === "assistant")
			.flatMap((message) => message.content.filter((block) => block.type === "tool_use"));
		expect(calls.map((block) => [block.id, block.name])).toEqual([
			["a", "take_screenshot"],
			["b", "type"],
			["r", "Read"],
			["c__0of3", "key_down"],
			["c__1of3", "click"],
			["c__2of3", "key_up"]
		]);
		expect(calls[1].input).toEqual({ text: "hi", press_enter: true });
		const results = out.body.messages.flatMap((message) =>
			message.role === "user" && Array.isArray(message.content) ? message.content.filter((block) => block.type === "tool_result") : []
		);
		expect(results.map((block) => [block.tool_use_id, block.content, block.is_error])).toEqual([
			["a", "OK", undefined],
			["b", "typed\ndone", undefined],
			["r", "file", undefined],
			["c__0of3", "OK", undefined],
			["c__1of3", "OK", undefined],
			["c__2of3", "OK", true]
		]);
		expect([...out.images.keys()]).toEqual(["a", "b", "c__2of3"]);
		expect(out.images.get("a")).toEqual({ mimeType: "image/png", data: png(2000, 1000) });
		expect(out.body.messages.at(-1).content.at(-1)).toEqual({ type: "text", text: "next" });
		expect(out.body.messages[1].content[0]).toEqual({ type: "text", text: "ok" });
	});

	it("keeps other tool choices, tolerates plain-text messages and a result that was not asked for", () => {
		const out = prepare({
			tools,
			tool_choice: { type: "auto" },
			messages: [
				{ role: "assistant", content: "hello" },
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "z", content: "x" }] }
			]
		});
		expect(out.body.tool_choice).toEqual({ type: "auto" });
		expect(out.body.messages[1].content).toHaveLength(1);
		expect(prepare({ tools, tool_choice: { type: "tool", name: "Read" } }).body.tool_choice).toEqual({ type: "tool", name: "Read" });
		expect("tool_choice" in prepare({ tools }).body).toBe(false);
		expect(prepare({ tools }).body.messages).toEqual([]);
	});

	it("reads results of every shape, and a call with no input is an action Gemini does not have", () => {
		const body = {
			tools,
			messages: [
				{ role: "assistant", content: [{ type: "tool_use", id: "a", name: "computer", input: { action: "screenshot" } }] },
				{
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "a",
							content: [
								{ type: "text", text: "" },
								{ type: "image", source: { type: "url", url: "x" } },
								{ type: "text", text: "shown" },
								null
							]
						}
					]
				}
			]
		};
		const out = prepare(body);
		expect(out.body.messages[1].content[0].content).toBe("shown");
		expect(out.images.size).toBe(0);
		const bare = { tools, messages: [{ role: "assistant", content: [{ type: "tool_use", id: "a", name: "computer" }] }] };
		expect(() => prepare(bare)).toThrow(/no Gemini equivalent/);
	});

	it("says so when the history has an action Gemini does not have", () => {
		const body = {
			tools,
			messages: [{ role: "assistant", content: [{ type: "tool_use", id: "a", name: "computer", input: { action: "zoom" } }] }]
		};
		expect(() => prepare(body)).toThrow(/no Gemini equivalent/);
	});
});

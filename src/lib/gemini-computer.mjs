/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/gemini-computer.mjs
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
 * @fileoverview Computer use between an Anthropic client and a Gemini model. The client sends Anthropic's computer tool and gets `computer` tool calls (`left_click` with a pixel `coordinate`, `key`, `type`, ...); Gemini's `computer_use` tool speaks its own predefined actions (`click`, `press_key`, ...) on a 0-999 grid. This module turns the Anthropic history into Gemini's calls and results before a request, and each Gemini action into one or more Anthropic calls after it.
 * @module @cldmv/llm-translator/lib/gemini-computer
 */
import { TranslatorError } from "./errors.mjs";
import { MARK, resolve as resolveAsks, toolOf as confirmationTool } from "./gemini-confirm.mjs";

/** The actions Gemini's desktop environment offers (`ENVIRONMENT_DESKTOP`). */
export const DESKTOP = Object.freeze([
	"click",
	"double_click",
	"triple_click",
	"middle_click",
	"right_click",
	"mouse_down",
	"mouse_up",
	"move",
	"type",
	"drag_and_drop",
	"wait",
	"press_key",
	"key_down",
	"key_up",
	"hotkey",
	"take_screenshot",
	"scroll"
]);

/** The browser-only actions, which the desktop environment does not offer; they are mapped too, in case a model sends one. */
const BROWSER = ["navigate", "go_back", "go_forward"];

/** Every action that is mapped to Anthropic's tool. */
export const ACTIONS = new Set([...DESKTOP, ...BROWSER]);

/** The 17 members of Anthropic's computer toolset (`computer_toolset_20260801`); the older `computer` tool takes the same names as `input.action`. */
export const MEMBERS = Object.freeze([
	"screenshot",
	"zoom",
	"left_click",
	"right_click",
	"middle_click",
	"double_click",
	"triple_click",
	"left_click_drag",
	"mouse_move",
	"left_mouse_down",
	"left_mouse_up",
	"cursor_position",
	"scroll",
	"type",
	"key",
	"hold_key",
	"wait"
]);

/** The members Gemini has no action for: a past call of one is written into the history as text. */
export const UNMAPPED = Object.freeze(["cursor_position", "hold_key", "zoom"]);

/** The toolset members each Gemini action is carried out with; an action is not offered when one of them is switched off. */
const REQUIRES = {
	take_screenshot: ["screenshot"],
	click: ["left_click"],
	double_click: ["double_click"],
	triple_click: ["triple_click"],
	middle_click: ["middle_click"],
	right_click: ["right_click"],
	mouse_down: ["mouse_move", "left_mouse_down"],
	mouse_up: ["mouse_move", "left_mouse_up"],
	move: ["mouse_move"],
	type: ["type"],
	drag_and_drop: ["left_click_drag"],
	wait: ["wait"],
	press_key: ["key"],
	key_down: [],
	key_up: [],
	hotkey: ["key"],
	scroll: ["scroll"]
};

/**
 * The members of the computer tool the client left on: all of them for the older tools, and for the toolset all but the ones its `configs` switch off.
 * @param {any[]} tools - The request's `tools`.
 * @returns {Set<string>} Member names.
 */
export function enabledOf(tools) {
	const off = new Set();
	for (const tool of tools.filter(isToolset)) {
		for (const [name, config] of Object.entries(tool.configs ?? {})) if (config?.enabled === false) off.add(name);
	}
	return new Set(MEMBERS.filter((name) => !off.has(name)));
}

/**
 * The desktop actions that are left out of what the model is offered (`excludedPredefinedFunctions`): the ones that need a member the client switched off.
 * @param {Set<string>} enabled - The members that are on.
 * @returns {string[]} Gemini action names.
 */
export function excluded(enabled) {
	return DESKTOP.filter((name) => REQUIRES[name].some((member) => !enabled.has(member)));
}

/** Pixels one scroll click moves; Gemini scrolls by pixels and Anthropic by clicks. */
export const PIXELS_PER_CLICK = 100;

/** The clicks Gemini and Anthropic both have, by Gemini's name. */
const CLICKS = {
	click: "left_click",
	double_click: "double_click",
	triple_click: "triple_click",
	middle_click: "middle_click",
	right_click: "right_click"
};
const BACK = Object.fromEntries(Object.entries(CLICKS).map(([gemini, anthropic]) => [anthropic, gemini]));

/** Key names: Gemini's (browser style) to the xdotool names Anthropic's tool takes. */
const KEYS = {
	control: "ctrl",
	ctrl: "ctrl",
	enter: "Return",
	return: "Return",
	escape: "Escape",
	esc: "Escape",
	backspace: "BackSpace",
	delete: "Delete",
	tab: "Tab",
	arrowup: "Up",
	arrowdown: "Down",
	arrowleft: "Left",
	arrowright: "Right",
	up: "Up",
	down: "Down",
	left: "Left",
	right: "Right",
	shift: "shift",
	alt: "alt",
	option: "alt",
	meta: "super",
	command: "super",
	cmd: "super",
	super: "super",
	windows: "super",
	pageup: "Prior",
	pagedown: "Next",
	home: "Home",
	end: "End",
	insert: "Insert",
	space: "space",
	" ": "space"
};

/** The reverse: xdotool names to Gemini's. */
const NAMES = {
	ctrl: "Control",
	Return: "Enter",
	Escape: "Escape",
	BackSpace: "Backspace",
	Delete: "Delete",
	Tab: "Tab",
	Up: "ArrowUp",
	Down: "ArrowDown",
	Left: "ArrowLeft",
	Right: "ArrowRight",
	shift: "Shift",
	alt: "Alt",
	super: "Meta",
	Prior: "PageUp",
	Next: "PageDown",
	Home: "Home",
	End: "End",
	Insert: "Insert",
	space: " "
};

/**
 * Anthropic's (xdotool) name for a Gemini key; a name the table does not know (a letter, a digit, `F5`) is kept as it is.
 * @param {string} name - Gemini key name.
 * @returns {string} Key name.
 */
export function xdotool(name) {
	const key = String(name);
	return Object.hasOwn(KEYS, key.toLowerCase()) ? KEYS[key.toLowerCase()] : key;
}

/**
 * Gemini's name for an Anthropic (xdotool) key.
 * @param {string} name - Key name.
 * @returns {string} Gemini key name.
 */
export function gemini(name) {
	return Object.hasOwn(NAMES, name) ? NAMES[name] : name;
}

/**
 * The error for an action that cannot be carried over.
 * @param {string} message - What is wrong.
 * @returns {TranslatorError} Error with code `unsupported_computer_action` (502).
 */
function refused(message) {
	return new TranslatorError(`Computer use: ${message}`, { code: "unsupported_computer_action", status: 502 });
}

/**
 * Whether a tool of the request is Anthropic's computer tool (`computer_20250124`, `computer_20251124`, `computer_toolset_20260801`, ...).
 * @param {any} tool - Tool definition.
 * @returns {boolean} True for the computer tool.
 */
export function isTool(tool) {
	return typeof tool?.type === "string" && /^computer_/.test(tool.type);
}

/**
 * Whether a tool of the request is the computer toolset (`computer_toolset_20260801`), whose calls are named by the member and carry `toolset_name`.
 * @param {any} tool - Tool definition.
 * @returns {boolean} True for the toolset.
 */
export function isToolset(tool) {
	return typeof tool?.type === "string" && /^computer_toolset_/.test(tool.type);
}

/**
 * The size of a PNG or JPEG image, from its header.
 * @param {string} base64 - The image, base64.
 * @returns {{width: number, height: number} | null} The size, or null when it is neither or cannot be read.
 */
export function dimensions(base64) {
	const bytes = Buffer.from(String(base64), "base64");
	if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47 && bytes.toString("latin1", 12, 16) === "IHDR") {
		return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
	}
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
	for (let at = 2; at + 9 < bytes.length;) {
		if (bytes[at] !== 0xff) return null;
		const marker = bytes[at + 1];
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
			return { width: bytes.readUInt16BE(at + 7), height: bytes.readUInt16BE(at + 5) };
		}
		at += 2 + bytes.readUInt16BE(at + 2);
	}
	return null;
}

/**
 * The blocks of a message's content as a list.
 * @param {any} content - String or list of blocks.
 * @returns {any[]} Blocks.
 */
const blocks = (content) => (Array.isArray(content) ? content : []);

/**
 * The size of the most recent screenshot of the conversation: the last image in a `tool_result` (or, failing that, in a user message) whose header can be read.
 * @param {any[]} messages - Anthropic messages.
 * @param {Set<string>} [skip] - Ids of calls whose result image is not a screenshot (a zoom shows a part of the screen).
 * @returns {{width: number, height: number} | null} The size, or null when there is no screenshot yet.
 */
export function sizeOf(messages, skip = new Set()) {
	for (let at = messages.length - 1; at >= 0; at--) {
		if (messages[at]?.role !== "user") continue;
		const found = [];
		for (const block of blocks(messages[at].content)) {
			if (block?.type === "tool_result") {
				if (!skip.has(block.tool_use_id)) found.push(...blocks(block.content));
			} else found.push(block);
		}
		for (const block of found.reverse()) {
			if (block?.type !== "image" || block.source?.type !== "base64") continue;
			const size = dimensions(block.source.data);
			if (size !== null) return size;
		}
	}
	return null;
}

/**
 * A Gemini grid coordinate as pixels.
 * @param {number} value - 0 to 999.
 * @param {number} extent - Width or height in pixels.
 * @returns {number} Pixel, inside the image.
 */
const pixel = (value, extent) => Math.min(extent - 1, Math.max(0, Math.round((Number(value) / 1000) * extent)));

/**
 * Pixels as a Gemini grid coordinate.
 * @param {number} value - Pixel.
 * @param {number} extent - Width or height in pixels.
 * @returns {number} 0 to 999.
 */
const grid = (value, extent) => Math.min(999, Math.max(0, Math.round((Number(value) / extent) * 1000)));

/**
 * The converter of the actions of one Gemini reply into Anthropic's computer calls. One action can be several calls (a mouse button press is a move and a press, `type` with `press_enter` is the text and a `Return`, `navigate` is the address bar, the address and a `Return`) and `key_down` and `key_up` around a click are folded into the click's `text` modifier, so it keeps what it still holds between actions.
 * @param {{width: number, height: number} | null} size - The size of the latest screenshot, for the coordinates.
 * @param {Set<string>} [enabled] - The members of the tool that are on; an action that needs another is an error.
 * @returns {{ push: (name: string, args: any) => any[], finish: () => void }} `push` gives the Anthropic inputs of one action (none while a modifier is held), `finish` throws when the reply ends with a key held.
 */
export function converter(size, enabled = new Set(MEMBERS)) {
	let held = [];
	let clicked = false;
	const point = (args, x = "x", y = "y") => {
		if (size === null) throw refused("the conversation has no screenshot yet, so coordinates cannot be scaled; take a screenshot first");
		return [pixel(args?.[x], size.width), pixel(args?.[y], size.height)];
	};
	const press = (keys) => [{ action: "key", text: keys.map(xdotool).join("+") }];
	const map = (name, args = {}) => {
		if (name === "key_down") {
			if (clicked) throw refused("key_down after the click it should wrap");
			held.push(xdotool(args.key));
			return [];
		}
		if (name === "key_up") {
			const key = xdotool(args.key);
			if (!clicked || !held.includes(key))
				throw refused(
					`key_up of ${args.key} does not close a key held for a click; only key_down, a click and key_up together can be carried over`
				);
			held = held.filter((entry) => entry !== key);
			if (held.length === 0) clicked = false;
			return [];
		}
		if (held.length > 0) {
			if (clicked || !Object.hasOwn(CLICKS, name))
				throw refused(`${name} while a key is held; only a click can be wrapped in key_down and key_up`);
			clicked = true;
			return [{ action: CLICKS[name], coordinate: point(args), text: held.join("+") }];
		}
		if (Object.hasOwn(CLICKS, name)) return [{ action: CLICKS[name], coordinate: point(args) }];
		switch (name) {
			case "take_screenshot":
				return [{ action: "screenshot" }];
			case "move":
				return [{ action: "mouse_move", coordinate: point(args) }];
			case "mouse_down":
				return [{ action: "mouse_move", coordinate: point(args) }, { action: "left_mouse_down" }];
			case "mouse_up":
				return [{ action: "mouse_move", coordinate: point(args) }, { action: "left_mouse_up" }];
			case "drag_and_drop":
				return [
					{ action: "left_click_drag", start_coordinate: point(args, "start_x", "start_y"), coordinate: point(args, "end_x", "end_y") }
				];
			case "type":
				return [{ action: "type", text: String(args.text ?? "") }, ...(args.press_enter === true ? press(["Enter"]) : [])];
			case "press_key":
				return press([args.key]);
			case "hotkey":
				return press(Array.isArray(args.keys) ? args.keys : []);
			case "wait":
				return [{ action: "wait", duration: Number.isFinite(args.seconds) ? args.seconds : 1 }];
			case "scroll": {
				const amount = Number.isFinite(args.magnitude_in_pixels) ? args.magnitude_in_pixels : 300;
				return [
					{
						action: "scroll",
						coordinate: point(args),
						scroll_direction: String(args.direction ?? "down"),
						scroll_amount: Math.max(1, Math.round(amount / PIXELS_PER_CLICK))
					}
				];
			}
			case "navigate":
				return [...press(["Control", "l"]), { action: "type", text: String(args.url ?? "") }, ...press(["Enter"])];
			case "go_back":
				return press(["Alt", "ArrowLeft"]);
			default:
				return press(["Alt", "ArrowRight"]);
		}
	};
	return {
		push(name, args = {}) {
			const out = map(name, args);
			for (const input of out) {
				if (!enabled.has(input.action))
					throw refused(`${name} needs ${input.action}, which the client switched off in the computer toolset`);
			}
			return out;
		},
		finish() {
			if (held.length > 0) throw refused(`the reply holds ${held.join("+")} with key_down and never closes it around a click`);
		}
	};
}

/**
 * Gemini's calls for one Anthropic computer call (or, for the calls one Gemini action was split into, for the whole group).
 * @param {any[]} inputs - The `input` of each call of the group, in order.
 * @param {{width: number, height: number} | null} size - The size of the latest screenshot.
 * @param {number[]} last - The last grid position the pointer was given, which a button press without a position uses.
 * @returns {{name: string, args: any}[]} Gemini's calls.
 */
export function inverse(inputs, size, last) {
	const at = (coordinate) => {
		if (size === null) throw refused("the conversation has no screenshot yet, so coordinates cannot be scaled; take a screenshot first");
		const out = [grid(coordinate?.[0], size.width), grid(coordinate?.[1], size.height)];
		last[0] = out[0];
		last[1] = out[1];
		return out;
	};
	const first = inputs[0];
	// The calls of one Gemini action: a press (move, then button), text and Return, the address bar sequence.
	if (inputs.length === 2 && first.action === "mouse_move" && /^left_mouse_(down|up)$/.test(inputs[1].action)) {
		const [x, y] = at(first.coordinate);
		return [{ name: inputs[1].action === "left_mouse_down" ? "mouse_down" : "mouse_up", args: { x, y } }];
	}
	if (inputs.length === 2 && first.action === "type" && inputs[1].action === "key" && inputs[1].text === "Return") {
		return [{ name: "type", args: { text: first.text, press_enter: true } }];
	}
	if (
		inputs.length === 3 &&
		first.action === "key" &&
		first.text === "ctrl+l" &&
		inputs[1].action === "type" &&
		inputs[2].action === "key" &&
		inputs[2].text === "Return"
	) {
		return [{ name: "navigate", args: { url: inputs[1].text } }];
	}
	if (inputs.length === 1 && first.action === "key" && (first.text === "alt+Left" || first.text === "alt+Right")) {
		return [{ name: first.text === "alt+Left" ? "go_back" : "go_forward", args: {} }];
	}
	return inputs.flatMap((input) => single(input, size, last, at));
}

/**
 * Gemini's calls for one Anthropic computer call on its own.
 * @param {any} input - The call's `input`.
 * @param {{width: number, height: number} | null} size - The size of the latest screenshot.
 * @param {number[]} last - The last grid position of the pointer.
 * @param {(coordinate: number[]) => number[]} at - Pixel to grid, remembering the position.
 * @returns {{name: string, args: any}[]} Gemini's calls.
 */
function single(input, size, last, at) {
	const action = input?.action;
	// The toolset's `coordinate` is optional: a click without one is at the pointer.
	const where = (coordinate) => (Array.isArray(coordinate) ? at(coordinate) : [...last]);
	if (Object.hasOwn(BACK, action)) {
		const [x, y] = where(input.coordinate);
		const click = { name: BACK[action], args: { x, y } };
		const keys = typeof input.text === "string" && input.text !== "" ? input.text.split("+").map(gemini) : [];
		return [
			...keys.map((key) => ({ name: "key_down", args: { key } })),
			click,
			...keys.reverse().map((key) => ({ name: "key_up", args: { key } }))
		];
	}
	switch (action) {
		case "screenshot":
			return [{ name: "take_screenshot", args: {} }];
		case "mouse_move": {
			const [x, y] = where(input.coordinate);
			return [{ name: "move", args: { x, y } }];
		}
		case "left_mouse_down":
		case "left_mouse_up":
			return [{ name: action === "left_mouse_down" ? "mouse_down" : "mouse_up", args: { x: last[0], y: last[1] } }];
		case "left_click_drag": {
			const [start_x, start_y] = at(input.start_coordinate);
			const [end_x, end_y] = at(input.coordinate);
			return [{ name: "drag_and_drop", args: { start_x, start_y, end_x, end_y } }];
		}
		case "type":
			return [{ name: "type", args: { text: String(input.text ?? "") } }];
		case "key": {
			const keys = String(input.text ?? "")
				.split("+")
				.map(gemini);
			const call = keys.length > 1 ? { name: "hotkey", args: { keys } } : { name: "press_key", args: { key: keys[0] } };
			// The toolset's `key` can repeat the press.
			return Array.from({ length: Math.min(100, Math.max(1, Math.round(Number(input.repeat) || 1))) }, () => ({ ...call }));
		}
		case "wait":
			return [{ name: "wait", args: { seconds: Math.max(1, Math.round(Number(input.duration) || 1)) } }];
		case "scroll": {
			const [x, y] = Array.isArray(input.coordinate) ? at(input.coordinate) : last;
			const clicks = Number.isFinite(input.scroll_amount) ? input.scroll_amount : 3;
			return [
				{
					name: "scroll",
					args: {
						x,
						y,
						direction: String(input.scroll_direction ?? "down"),
						magnitude_in_pixels: Math.min(999, Math.max(0, clicks * PIXELS_PER_CLICK))
					}
				}
			];
		}
		default:
			throw refused(`the action ${JSON.stringify(action)} in the conversation has no Gemini equivalent`);
	}
}

/** Matches the id of a call that is one of several made from one Gemini action: `<id>__<n>of<count>`. */
const MEMBER = /^(.*)__(\d+)of(\d+)$/;

/**
 * The ids of the calls made from one Gemini action.
 * @param {string} base - The Gemini call id.
 * @param {number} count - How many Anthropic calls it became.
 * @returns {string[]} The ids: the id itself for one call, `<id>__<n>of<count>` for several.
 */
export function ids(base, count) {
	return count === 1 ? [base] : Array.from({ length: count }, (_, at) => `${base}__${at}of${count}`);
}

/**
 * The computer call a `tool_use` block of the history is, if it is one: the older tool's `computer` block (the action is `input.action`), or a
 * member of the toolset (the action is the block's `name`, and it carries `toolset_name`). Either shape is read in either kind of conversation.
 * @param {any} block - Content block.
 * @param {boolean} toolset - Whether the request declared the toolset (its members are then recognized by name even without `toolset_name`).
 * @param {Set<string>} custom - Names of the request's own tools, which are never computer calls.
 * @returns {{action: any, input: any} | null} The action and the input with `action` in it, or null for any other block.
 */
function callOf(block, toolset, custom) {
	if (block?.type !== "tool_use") return null;
	if (block.name === "computer") return { action: block.input?.action, input: block.input ?? {} };
	if (MEMBERS.includes(block.name) && !custom.has(block.name) && (toolset || block.toolset_name === "computer")) {
		return { action: block.name, input: { ...block.input, action: block.name } };
	}
	return null;
}

/**
 * Rewrite an Anthropic request that uses the computer tool into one Gemini can take: the tool is removed (the caller adds Gemini's `computer_use`
 * tool), the computer calls of the history become the Gemini actions they came from (`left_click` is `click` on the grid, the calls one Gemini
 * action was split into are one action again), and each result becomes the result of those calls, with its screenshot set apart to be sent as part of
 * the function response. A past call of an action Gemini has no equivalent of (`cursor_position`, `hold_key`, `zoom`) and its result become plain text.
 * The questions the translator asked the user about actions Gemini flagged (`lib/gemini-confirm`) are resolved first.
 * @param {any} body - Anthropic Messages body.
 * @param {{ confirmationTool?: string }} [options] - `confirmationTool`: `settings.gemini.confirmationTool`.
 * @returns {{ body: any, shape: "toolset" | "classic", enabled: Set<string>, size: {width: number, height: number} | null, custom: Set<string>, images: Map<string, {mimeType: string, data: string}>, acknowledged: Set<string>, confirm: { tool: {name: string} | null, pending: Set<string> }, local: { id: string, name: string, args: any } | null } | null} The rewritten body and what the conversion needs, or null when the request has no computer tool.
 * @throws {TranslatorError} `unsupported_computer_action` for an action of the history that Gemini has no equivalent of and that is not one of those.
 */
export function prepare(body, options = {}) {
	const tools = Array.isArray(body?.tools) ? body.tools : [];
	if (!tools.some(isTool)) return null;
	const toolset = tools.some(isToolset);
	const custom = new Set(
		tools.filter((tool) => !isTool(tool) && (tool.type === undefined || tool.type === "custom")).map((tool) => tool.name)
	);
	const asked = resolveAsks(Array.isArray(body.messages) ? body.messages : [], new Set(["computer", ...MEMBERS]));
	const messages = asked.messages;
	const acknowledged = new Set();
	const zooms = new Set();
	for (const message of messages) {
		for (const block of message?.role === "assistant" ? blocks(message.content) : []) {
			if (callOf(block, toolset, custom)?.action === "zoom") zooms.add(block.id);
		}
	}
	const size = sizeOf(messages, zooms);
	const images = new Map();
	const groups = new Map();
	const plain = new Map();
	const last = [500, 500];
	const rewritten = messages.map((message) => {
		if (!Array.isArray(message?.content)) return message;
		if (message.role === "assistant")
			return { ...message, content: assistant(message.content, { groups, plain, size, last, toolset, custom }) };
		const content = [];
		const done = new Set();
		for (const block of message.content) {
			const group = block?.type === "tool_result" ? groups.get(block.tool_use_id) : undefined;
			const action = block?.type === "tool_result" ? plain.get(block.tool_use_id) : undefined;
			if (action !== undefined) content.push(...described(block, action));
			else if (group === undefined) content.push(block);
			else if (!done.has(group)) {
				done.add(group);
				if (MARK.test(group.names.at(-1).replace(/__\d+of\d+$/, ""))) acknowledged.add(group.names.at(-1));
				content.push(...results(group, message.content, images));
			}
		}
		return { ...message, content };
	});
	const choice = body.tool_choice?.type === "tool" && body.tool_choice.name === "computer" ? { type: "any" } : body.tool_choice;
	return {
		body: {
			...body,
			tools: tools.filter((tool) => !isTool(tool)),
			messages: rewritten,
			...(choice === undefined ? {} : { tool_choice: choice })
		},
		shape: toolset ? "toolset" : "classic",
		enabled: enabledOf(tools),
		size,
		custom,
		images,
		acknowledged,
		confirm: { tool: confirmationTool(tools, options.confirmationTool), pending: asked.pending },
		local: asked.local
	};
}

/**
 * A past call of an action Gemini has no equivalent of, as the text that stands for it in the model turn.
 * @param {string} action - The action.
 * @param {any} input - The call's input.
 * @returns {string} For example `[Computer action zoom {"region":[0,0,10,10]}]`.
 */
function describe(action, input) {
	const { action: ___action, ...rest } = input;
	return `[Computer action ${action}${Object.keys(rest).length === 0 ? "" : ` ${JSON.stringify(rest)}`}]`;
}

/**
 * The result of such a call as blocks of the user turn: the text that stands for it, and the images it returned (a zoom).
 * @param {any} block - The `tool_result` block.
 * @param {string} action - The action.
 * @returns {any[]} Text and image blocks.
 */
function described(block, action) {
	const parts = typeof block.content === "string" ? [{ type: "text", text: block.content }] : blocks(block.content);
	const text = parts
		.filter((part) => part?.type === "text" && part.text !== "")
		.map((part) => part.text)
		.join("\n");
	const label =
		block.is_error === true
			? `[Computer action ${action} failed${text === "" ? "" : `: ${text}`}]`
			: `[Result of computer action ${action}${text === "" ? "" : `: ${text}`}]`;
	return [{ type: "text", text: label }, ...parts.filter((part) => part?.type === "image")];
}

/**
 * Rewrite the computer calls of an assistant message into the Gemini actions they stand for.
 * @param {any[]} content - The message's blocks.
 * @param {{groups: Map<string, any>, plain: Map<string, string>, size: {width: number, height: number} | null, last: number[], toolset: boolean, custom: Set<string>}} context - `groups` and `plain` record, by the id of each call, what became of it (filled here, read when the results come).
 * @returns {any[]} The blocks.
 */
function assistant(content, { groups, plain, size, last, toolset, custom }) {
	const out = [];
	const members = new Map();
	const keyOf = (block) => {
		const match = MEMBER.exec(block.id);
		return match === null ? block.id : match[1];
	};
	const mapped = (block) => {
		const call = callOf(block, toolset, custom);
		return call !== null && !UNMAPPED.includes(call.action) ? call : null;
	};
	for (const block of content) {
		if (mapped(block) === null) continue;
		const key = keyOf(block);
		if (!members.has(key)) members.set(key, []);
		members.get(key).push(block);
	}
	const placed = new Set();
	for (const block of content) {
		const call = callOf(block, toolset, custom);
		if (call !== null && UNMAPPED.includes(call.action)) {
			plain.set(block.id, call.action);
			out.push({ type: "text", text: describe(call.action, call.input) });
			continue;
		}
		if (call === null) {
			out.push(block);
			continue;
		}
		const key = keyOf(block);
		if (placed.has(key)) continue;
		placed.add(key);
		const list = members.get(key);
		const calls = inverse(
			list.map((entry) => callOf(entry, toolset, custom).input),
			size,
			last
		);
		const names = calls.map((_, at) => (calls.length === 1 ? key : `${key}__${at}of${calls.length}`));
		const group = { names, ids: list.map((entry) => entry.id) };
		for (const id of group.ids) groups.set(id, group);
		calls.forEach((made, at) => out.push({ type: "tool_use", id: names[at], name: made.name, input: made.args }));
	}
	return out;
}

/**
 * The tool results that stand for one group of calls: the results of its Anthropic calls become one result for each Gemini call, with the screenshot (the last one the results carry) and any error on the last call.
 * @param {{names: string[], ids: string[]}} group - The group.
 * @param {any[]} content - The user message's blocks, which hold the results.
 * @param {Map<string, {mimeType: string, data: string}>} images - Receives the screenshot of the last Gemini call.
 * @returns {any[]} `tool_result` blocks.
 */
function results(group, content, images) {
	const mine = content.filter((block) => block?.type === "tool_result" && group.ids.includes(block.tool_use_id));
	let text = "";
	let failed = false;
	let shot;
	for (const block of mine) {
		failed ||= block.is_error === true;
		for (const part of typeof block.content === "string" ? [{ type: "text", text: block.content }] : blocks(block.content)) {
			if (part?.type === "text" && part.text !== "") text += `${text === "" ? "" : "\n"}${part.text}`;
			else if (part?.type === "image" && part.source?.type === "base64")
				shot = { mimeType: part.source.media_type, data: part.source.data };
		}
	}
	const final = group.names.at(-1);
	if (shot !== undefined) images.set(final, shot);
	return group.names.map((name, at) => ({
		type: "tool_result",
		tool_use_id: name,
		content: at === group.names.length - 1 ? text || "OK" : "OK",
		...(failed && at === group.names.length - 1 ? { is_error: true } : {})
	}));
}

/**
 * A `tool_use` block of a reply, with `toolset_name: "computer"` when it is a member of the computer toolset (the client declared the toolset, and the
 * block is named by one of its members and is not one of the request's own tools).
 * @param {any} block - Content block.
 * @param {{shape?: string, custom: Set<string>} | undefined} computer - The conversion state of the request, if it used the computer tool.
 * @returns {any} The block, with `toolset_name` when it is a member.
 */
export function tagged(block, computer) {
	if (computer?.shape !== "toolset" || block?.type !== "tool_use") return block;
	return MEMBERS.includes(block.name) && !computer.custom.has(block.name) ? { ...block, toolset_name: "computer" } : block;
}

/** The environments Gemini's computer use tool takes. */
export const ENVIRONMENTS = Object.freeze(["ENVIRONMENT_UNSPECIFIED", "ENVIRONMENT_BROWSER", "ENVIRONMENT_MOBILE", "ENVIRONMENT_DESKTOP"]);

/** The safety policies that can be disabled for computer use. */
export const POLICIES = Object.freeze([
	"SAFETY_POLICY_UNSPECIFIED",
	"FINANCIAL_TRANSACTIONS",
	"SENSITIVE_DATA_MODIFICATION",
	"COMMUNICATION_TOOL",
	"ACCOUNT_CREATION",
	"DATA_MODIFICATION",
	"USER_CONSENT_MANAGEMENT",
	"LEGAL_TERMS_AND_AGREEMENTS"
]);

/** The fields of the `computerUse` tool an operator can set, with the spelling Google's REST examples use as well as the one its reference uses; the first is what is sent. */
const FIELDS = [
	["environment", "environment"],
	["excludedPredefinedFunctions", "excluded_predefined_functions"],
	["enablePromptInjectionDetection", "enable_prompt_injection_detection"],
	["disabledSafetyPolicies", "disabled_safety_policies"]
];

/** The check each field's value has to pass. */
const VALID = {
	environment: (value) => ENVIRONMENTS.includes(value),
	excludedPredefinedFunctions: (value) => Array.isArray(value) && value.every((name) => typeof name === "string" && name !== ""),
	enablePromptInjectionDetection: (value) => typeof value === "boolean",
	disabledSafetyPolicies: (value) => Array.isArray(value) && value.every((name) => POLICIES.includes(name))
};

/**
 * The fields set in a `settings.gemini.computerUse` block, under their camelCase names (the camelCase spelling wins when both are given).
 * @param {any} block - The block.
 * @returns {Record<string, any>} The fields that are set.
 */
function fieldsOf(block) {
	const out = {};
	for (const [camel, snake] of FIELDS) {
		const value = block[camel] ?? block[snake];
		if (value !== undefined) out[camel] = value;
	}
	return out;
}

/**
 * What is wrong with a `settings.gemini.computerUse` block.
 * @param {any} block - The block.
 * @returns {string | null} The problem, or null when it is fine.
 */
export function problemWith(block) {
	if (block === null || typeof block !== "object" || Array.isArray(block)) return "expected an object";
	const known = FIELDS.flat();
	const unknown = Object.keys(block).find((key) => !known.includes(key));
	if (unknown !== undefined) return `unknown field ${unknown}`;
	for (const [name, value] of Object.entries(fieldsOf(block))) {
		if (!VALID[name](value)) {
			return `${name} must be ${name === "environment" ? ENVIRONMENTS.join(", ") : name === "enablePromptInjectionDetection" ? "true or false" : name === "excludedPredefinedFunctions" ? "a list of action names" : `a list of ${POLICIES.join(", ")}`}`;
		}
	}
	return null;
}

/**
 * The `computerUse` tool sent to Gemini: the desktop environment and the actions the client's toolset leaves out, merged with what the operator set in
 * `settings.gemini.computerUse`. The operator's `environment` replaces the generated one, its `excludedPredefinedFunctions` are added to the
 * generated ones (a generated exclusion is never taken away), and `enablePromptInjectionDetection` and `disabledSafetyPolicies` are sent as given.
 * @param {Set<string>} enabled - The members of the client's tool that are on.
 * @param {any} [block] - The operator's block (already checked).
 * @returns {{computerUse: Record<string, any>}} The tool.
 */
export function toolOf(enabled, block = {}) {
	const set = fieldsOf(block);
	const out = {
		environment: set.environment ?? "ENVIRONMENT_DESKTOP",
		excludedPredefinedFunctions: [...new Set([...excluded(enabled), ...(set.excludedPredefinedFunctions ?? [])])]
	};
	if (set.enablePromptInjectionDetection !== undefined) out.enablePromptInjectionDetection = set.enablePromptInjectionDetection;
	if (set.disabledSafetyPolicies !== undefined) out.disabledSafetyPolicies = [...new Set(set.disabledSafetyPolicies)];
	return { computerUse: out };
}

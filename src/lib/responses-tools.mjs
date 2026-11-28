/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/responses-tools.mjs
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
 * @fileoverview The tool types of the Responses API and what the translator does with each, plus the shapes the Responses front shares between its
 * request converter, its reply converters and the hosted tool runner (`hostedtools.mjs`).
 *
 * Every tool type is in {@link TOOLS}, the one table the converter, the documentation and the tests read:
 * - `mapped`: becomes a Chat Completions tool of the same kind (`function`, `custom`).
 * - `emulated`, `via: "serverTools"`: the model is offered a function tool and the translator runs an executor of `serverTools` when the model
 *   calls it (`web_search`, `code_interpreter`, `tool_search`). The reply carries the Responses item of the hosted tool, not a function call.
 * - `emulated`, `via: "function"`: the model is offered a function tool and its call is returned as the client-executed item of the tool
 *   (`shell_call`, `apply_patch_call`); the client runs it and returns the matching `*_output` item.
 * - `rejected`: the translator has no counterpart; the request is refused with `unsupported_tool`.
 *
 * The item shapes follow OpenAI's documented Responses items as far as they are known here; the places where a field is a best reading of the
 * documentation are marked `UNSURE` in the comments.
 * @module @cldmv/llm-translator/lib/responses-tools
 */
import { TranslatorError } from "./errors.mjs";

/**
 * @typedef {object} ToolRow
 * @property {string} kind - The tool's name in this module.
 * @property {RegExp} match - Matches the tool's `type`.
 * @property {"mapped" | "emulated" | "rejected"} handling - What the translator does.
 * @property {"function" | "custom" | "serverTools" | "mcp" | "anthropic" | "none"} via - What carries it: a Chat function or custom tool, a `serverTools` executor, or nothing.
 * @property {string} [executor] - For `via: "serverTools"`: the tool type pattern an executor must serve.
 * @property {string} [offered] - The name of the function the model is offered (emulated tools).
 * @property {string} note - One line for the documentation and the error message.
 */

/** @type {readonly ToolRow[]} */
export const TOOLS = Object.freeze([
	{ kind: "function", match: /^function$/, handling: "mapped", via: "function", note: "A Chat Completions function tool." },
	{
		kind: "custom",
		match: /^custom$/,
		handling: "mapped",
		via: "custom",
		note: "A Chat Completions custom tool; only upstreams that carry custom tools (OpenAI Chat and Responses) can call it."
	},
	{
		kind: "web_search",
		match: /^web_search(_preview)?(_\d{4}_\d{2}_\d{2})?$/,
		handling: "emulated",
		via: "serverTools",
		executor: "web_search_*",
		offered: "web_search",
		note: "Run by the web search executor of `serverTools`."
	},
	{
		kind: "code_interpreter",
		match: /^code_interpreter$/,
		handling: "emulated",
		via: "serverTools",
		executor: "code_execution_*",
		offered: "code_interpreter",
		note: "Run by the code execution executor of `serverTools` (Python)."
	},
	{
		kind: "tool_search",
		match: /^tool_search$/,
		handling: "emulated",
		via: "serverTools",
		executor: "tool_search_tool_*",
		offered: "tool_search",
		note: "Run by the tool search executor of `serverTools` over the function tools marked `defer_loading`."
	},
	{
		kind: "shell",
		match: /^shell$/,
		handling: "emulated",
		via: "function",
		offered: "shell",
		note: "Offered as a function; the call is returned as a `shell_call` item for the client to run. A hosted container environment is refused."
	},
	{
		kind: "apply_patch",
		match: /^apply_patch$/,
		handling: "emulated",
		via: "function",
		offered: "apply_patch",
		note: "Offered as a function; the call is returned as an `apply_patch_call` item for the client to run."
	},
	{
		kind: "file_search",
		match: /^file_search$/,
		handling: "rejected",
		via: "none",
		note: "The translator has no vector stores to search."
	},
	{
		kind: "image_generation",
		match: /^image_generation$/,
		handling: "rejected",
		via: "none",
		note: "The translator has no image generation counterpart."
	},
	{
		kind: "local_shell",
		match: /^local_shell$/,
		handling: "rejected",
		via: "none",
		note: "The translator has no counterpart for the Codex local shell tool; use the `shell` tool."
	},
	{
		kind: "computer_use_preview",
		match: /^computer(_use_preview)?$/,
		handling: "emulated",
		via: "anthropic",
		offered: "computer",
		note: "Mapped to Anthropic's computer tool on an upstream that speaks the Anthropic Messages API (display_width and display_height are the display size); the call comes back as a computer_call item for the client to run. Any other upstream refuses it."
	},
	{
		kind: "mcp",
		match: /^mcp$/,
		handling: "emulated",
		via: "mcp",
		note: "The translator calls the MCP server itself (Streamable HTTP); it needs a serverTools.mcp host allowlist. A connector_id is refused."
	}
]);

/**
 * The row of a tool type.
 * @param {unknown} type - The tool's `type`.
 * @returns {ToolRow | undefined} The row, or undefined for an unknown type.
 */
export function rowOf(type) {
	return typeof type === "string" ? TOOLS.find((row) => row.match.test(type)) : undefined;
}

/**
 * The refusal for a tool the translator has no counterpart for.
 * @param {string} at - Path of the tool (`tools[2]`).
 * @param {string} message - What to say after the type.
 * @returns {TranslatorError} `unsupported_tool`, status 400, `param` the tool's path.
 */
export function refusal(at, message) {
	return new TranslatorError(`${at}: ${message}`, { code: "unsupported_tool", param: at });
}

/** The JSON schema of the function that stands for the `shell` tool: the `action` of a `shell_call` item. */
export const SHELL_SCHEMA = Object.freeze({
	type: "object",
	properties: {
		commands: { type: "array", items: { type: "string" }, description: "The shell commands to run, in order." },
		timeout_ms: { type: "integer", description: "How long the commands may run, in milliseconds." },
		max_output_length: { type: "integer", description: "The most characters of output to return." }
	},
	required: ["commands"]
});

/** The JSON schema of the function that stands for the `apply_patch` tool: the `operation` of an `apply_patch_call` item. */
export const PATCH_SCHEMA = Object.freeze({
	type: "object",
	properties: {
		type: { type: "string", enum: ["create_file", "update_file", "delete_file"], description: "What to do with the file." },
		path: { type: "string", description: "The file's path." },
		diff: { type: "string", description: "The diff to apply (a V4A diff for update_file, the whole file for create_file)." }
	},
	required: ["type", "path"]
});

/**
 * The Chat function tool that stands for a client-executed tool.
 * @param {"shell" | "apply_patch"} kind - The tool.
 * @returns {{type: "function", function: {name: string, description: string, parameters: any}}} The function tool.
 */
export function functionOf(kind) {
	return kind === "shell"
		? {
				type: "function",
				function: {
					name: "shell",
					description: "Run shell commands on the user's machine and get their output. The client runs the commands.",
					parameters: SHELL_SCHEMA
				}
			}
		: {
				type: "function",
				function: {
					name: "apply_patch",
					description: "Create, update or delete a file by a patch operation. The client applies the operation.",
					parameters: PATCH_SCHEMA
				}
			};
}

/**
 * Text of the output of a `shell_call_output` item, for the tool message the upstream reads.
 * UNSURE: the item is `{ call_id, output: [{ stdout, stderr, outcome: { type: "exit", exit_code } | { type: "timeout" } }], max_output_length? }`.
 * @param {any} output - The item's `output`.
 * @returns {string} Text.
 */
export function shellText(output) {
	if (typeof output === "string") return output;
	if (!Array.isArray(output)) return "";
	return output
		.map((entry) => {
			const parts = [];
			if (typeof entry?.stdout === "string" && entry.stdout !== "") parts.push(`stdout:\n${entry.stdout}`);
			if (typeof entry?.stderr === "string" && entry.stderr !== "") parts.push(`stderr:\n${entry.stderr}`);
			const outcome = entry?.outcome;
			if (outcome?.type === "timeout") parts.push("timed out");
			else if (outcome?.type === "exit") parts.push(`exit code: ${outcome.exit_code ?? 0}`);
			return parts.join("\n");
		})
		.join("\n\n");
}

/**
 * The input of a call as a JSON object string, for the arguments of a function call.
 * @param {unknown} value - The action or operation object.
 * @returns {string} JSON text (`{}` for anything that is not an object).
 */
export function argumentsOf(value) {
	return JSON.stringify(value !== null && typeof value === "object" && !Array.isArray(value) ? value : {});
}

/**
 * The parsed arguments of a function call.
 * @param {unknown} text - `function.arguments`.
 * @returns {Record<string, any>} The object, or an empty one when the text is not a JSON object.
 */
export function parsed(text) {
	try {
		const value = JSON.parse(typeof text === "string" && text !== "" ? text : "{}");
		return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
	} catch {
		return {};
	}
}

/**
 * The function name an MCP tool is offered to the model under: `mcp_<server_label>_<tool>` with every character outside `[A-Za-z0-9_-]` replaced by
 * `_`, and a hash suffix instead of the tail when it would be longer than 64 characters (the limit of function names).
 * @param {string} label - The `server_label`.
 * @param {string} name - The tool's name on the server.
 * @returns {string} The function name.
 */
export function mcpName(label, name) {
	const plain = `mcp_${label}_${name}`.replace(/[^A-Za-z0-9_-]/g, "_");
	if (plain.length <= 64) return plain;
	let hash = 0;
	for (const char of `${label}\u0000${name}`) hash = (Math.imul(hash, 31) + char.codePointAt(0)) >>> 0;
	return `${plain.slice(0, 55)}_${hash.toString(16).padStart(8, "0")}`;
}

/**
 * Whether a Responses input item is one of the MCP items (`mcp_list_tools`, `mcp_call`, `mcp_approval_request`, `mcp_approval_response`).
 * @param {any} item - Input item.
 * @returns {boolean} True for an MCP item.
 */
export function mcpItem(item) {
	return typeof item?.type === "string" && item.type.startsWith("mcp_");
}

/**
 * The Responses item of a client-executed tool call, from the function call the model made.
 * UNSURE: `shell_call` is `{ id, type, call_id, status, action: { commands, timeout_ms, max_output_length } }`, `apply_patch_call` is
 * `{ id, type, call_id, status, operation: { type, path, diff } }` and `computer_call` is `{ id, type, call_id, status, action, pending_safety_checks }`
 * (its action is converted from Anthropic's by {@link computerAction}; `pending_safety_checks` is always empty: nothing here judges a safety check).
 * @param {"shell" | "apply_patch" | "computer"} kind - The tool.
 * @param {{id: string, call_id: string, arguments: string, status: string}} call - The call: item id, call id, JSON arguments and status.
 * @returns {any} The item.
 */
export function clientItem(kind, call) {
	const input = parsed(call.arguments);
	if (kind === "computer") {
		return {
			id: call.id,
			type: "computer_call",
			call_id: call.call_id,
			status: call.status,
			action: computerAction(input),
			pending_safety_checks: []
		};
	}
	if (kind === "shell") {
		return {
			id: call.id,
			type: "shell_call",
			call_id: call.call_id,
			status: call.status,
			action: {
				commands: Array.isArray(input.commands) ? input.commands.map(String) : [],
				timeout_ms: Number.isInteger(input.timeout_ms) ? input.timeout_ms : null,
				max_output_length: Number.isInteger(input.max_output_length) ? input.max_output_length : null
			}
		};
	}
	return { id: call.id, type: "apply_patch_call", call_id: call.call_id, status: call.status, operation: input };
}

/** Pixels one scroll click of Anthropic's computer tool stands for. (UNSURE: OpenAI's `scroll` counts pixels.) */
const CLICK = 100;

/**
 * The point of an Anthropic action input (`coordinate: [x, y]`).
 * @param {any} value - A coordinate.
 * @returns {{x: number, y: number} | null} The point, or null when it is not one.
 */
function pointOf(value) {
	return Array.isArray(value) && Number.isFinite(value[0]) && Number.isFinite(value[1]) ? { x: value[0], y: value[1] } : null;
}

/**
 * The Responses computer action for the input of Anthropic's computer tool (`computer_20250124` and later: `{ action, coordinate, text, ... }`).
 * `left_click`, `right_click` and `middle_click` are `click` with a button (`left`, `right`, `wheel`), `double_click` and `triple_click` (no counterpart: the
 * closest one) are `double_click`, `mouse_move` is `move`, `left_click_drag` is `drag`, `key` and `hold_key` are `keypress`, and `type`, `scroll`, `wait`
 * and `screenshot` keep their names. What has no counterpart (`cursor_position`, `left_mouse_down`, `left_mouse_up`, `zoom`, an unknown action, or an action
 * that needs a point and has none) becomes a `screenshot`, which a client can always take and from which the model plans again.
 * @param {any} input - The tool call's input.
 * @returns {any} The action.
 */
export function computerAction(input) {
	const at = pointOf(input.coordinate);
	const need = (make) => (at === null ? { type: "screenshot" } : make(at));
	switch (input.action) {
		case "left_click":
			return need((point) => ({ type: "click", button: "left", ...point }));
		case "right_click":
			return need((point) => ({ type: "click", button: "right", ...point }));
		case "middle_click":
			return need((point) => ({ type: "click", button: "wheel", ...point }));
		case "double_click":
		case "triple_click":
			return need((point) => ({ type: "double_click", ...point }));
		case "mouse_move":
			return need((point) => ({ type: "move", ...point }));
		case "left_click_drag": {
			const from = pointOf(input.start_coordinate);
			return from === null || at === null ? { type: "screenshot" } : { type: "drag", path: [from, at] };
		}
		case "scroll": {
			const amount = (Number.isFinite(input.scroll_amount) ? input.scroll_amount : 1) * CLICK;
			const by = { up: [0, -amount], down: [0, amount], left: [-amount, 0], right: [amount, 0] }[input.scroll_direction];
			return at === null || by === undefined ? { type: "screenshot" } : { type: "scroll", ...at, scroll_x: by[0], scroll_y: by[1] };
		}
		case "type":
			return typeof input.text === "string" ? { type: "type", text: input.text } : { type: "screenshot" };
		case "key":
		case "hold_key":
			return typeof input.text === "string" ? { type: "keypress", keys: input.text.split("+") } : { type: "screenshot" };
		case "wait":
			return { type: "wait" };
		default:
			return { type: "screenshot" };
	}
}

/**
 * The input of Anthropic's computer tool for a Responses computer action, for a `computer_call` the client replays.
 * @param {any} action - The `action` of the item.
 * @returns {Record<string, any>} The input (`{ action: "screenshot" }` for an action it does not know).
 */
export function computerInput(action) {
	const at = Number.isFinite(action?.x) && Number.isFinite(action?.y) ? [action.x, action.y] : undefined;
	switch (action?.type) {
		case "click":
			return {
				action: action.button === "right" ? "right_click" : action.button === "wheel" ? "middle_click" : "left_click",
				coordinate: at
			};
		case "double_click":
			return { action: "double_click", coordinate: at };
		case "move":
			return { action: "mouse_move", coordinate: at };
		case "drag": {
			const path = Array.isArray(action.path) ? action.path : [];
			const last = path.at(-1);
			return { action: "left_click_drag", start_coordinate: [path[0]?.x, path[0]?.y], coordinate: [last?.x, last?.y] };
		}
		case "scroll": {
			const vertical = Math.abs(action.scroll_y ?? 0) >= Math.abs(action.scroll_x ?? 0);
			const amount = Math.max(1, Math.round(Math.abs(vertical ? (action.scroll_y ?? 0) : (action.scroll_x ?? 0)) / CLICK));
			const direction = vertical ? ((action.scroll_y ?? 0) < 0 ? "up" : "down") : (action.scroll_x ?? 0) < 0 ? "left" : "right";
			return { action: "scroll", coordinate: at, scroll_direction: direction, scroll_amount: amount };
		}
		case "type":
			return { action: "type", text: String(action.text ?? "") };
		case "keypress":
			return { action: "key", text: (Array.isArray(action.keys) ? action.keys : []).join("+") };
		case "wait":
			return { action: "wait", duration: 2 };
		default:
			return { action: "screenshot" };
	}
}

/**
 * The tool names (and so the kinds) a request's emulated client tools are offered under, recorded on the converter's state so the reply
 * converters can turn a function call of that name back into the tool's item.
 * @param {any} state - Converter state.
 * @param {string} name - Function name.
 * @returns {"shell" | "apply_patch" | "computer" | undefined} The tool the name stands for in this request.
 */
export function clientKind(state, name) {
	const kind = state?.clientTools?.[name];
	return kind === "shell" || kind === "apply_patch" || kind === "computer" ? kind : undefined;
}

/**
 * Whether a Chat tool carries the hosted marker (an emulated tool the runner serves).
 * @param {any} tool - Chat tool.
 * @returns {boolean} True for a marked tool.
 */
export function hostedMark(tool) {
	return tool !== null && typeof tool === "object" && tool.llmt_hosted !== undefined && typeof tool.llmt_hosted?.kind === "string";
}

/**
 * Whether a Chat message carries the hosted marker (a hosted call replayed from the client's history).
 * @param {any} message - Chat message.
 * @returns {boolean} True for a marked message.
 */
export function replayMark(message) {
	return (
		message !== null && typeof message === "object" && message.llmt_hosted !== undefined && typeof message.llmt_hosted?.kind === "string"
	);
}

/**
 * Whether a Chat message carries an input item only a Responses upstream can take (`hostedTools: "native"`).
 * @param {any} message - Chat message.
 * @returns {boolean} True for a marked message.
 */
export function nativeMark(message) {
	return message !== null && typeof message === "object" && message.llmt_native !== undefined && message.llmt_native?.item !== undefined;
}

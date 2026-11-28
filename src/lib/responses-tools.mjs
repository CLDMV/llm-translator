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
 * @property {"function" | "custom" | "serverTools" | "none"} via - What carries it: a Chat function or custom tool, a `serverTools` executor, or nothing.
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
		handling: "rejected",
		via: "none",
		note: "The computer actions and screenshots of the Responses API have no mapping to a function tool."
	},
	{
		kind: "mcp",
		match: /^mcp$/,
		handling: "rejected",
		via: "none",
		note: "The translator does not call remote MCP servers on the model's behalf."
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
 * The Responses item of a client-executed tool call, from the function call the model made.
 * UNSURE: `shell_call` is `{ id, type, call_id, status, action: { commands, timeout_ms, max_output_length } }` and `apply_patch_call` is
 * `{ id, type, call_id, status, operation: { type, path, diff } }`.
 * @param {"shell" | "apply_patch"} kind - The tool.
 * @param {{id: string, call_id: string, arguments: string, status: string}} call - The call: item id, call id, JSON arguments and status.
 * @returns {any} The item.
 */
export function clientItem(kind, call) {
	const input = parsed(call.arguments);
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

/**
 * The tool names (and so the kinds) a request's emulated client tools are offered under, recorded on the converter's state so the reply
 * converters can turn a function call of that name back into the tool's item.
 * @param {any} state - Converter state.
 * @param {string} name - Function name.
 * @returns {"shell" | "apply_patch" | undefined} The tool the name stands for in this request.
 */
export function clientKind(state, name) {
	const kind = state?.clientTools?.[name];
	return kind === "shell" || kind === "apply_patch" ? kind : undefined;
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

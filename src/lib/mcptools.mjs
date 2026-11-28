/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/mcptools.mjs
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
 * @fileoverview The Responses `mcp` tool for the hosted tool runner (`hostedtools.mjs`): the servers a request names, their tools offered to the model as
 * functions, the `mcp_list_tools`, `mcp_call` and `mcp_approval_request` items, and the history items that come back (`mcp_list_tools`, `mcp_call`,
 * `mcp_approval_request`, `mcp_approval_response`).
 *
 * A server is reached with the client of `lib/mcp.mjs`, only when `serverTools.mcp` lists its host. Its tools (filtered by `allowed_tools`) are listed
 * once per request (an `mcp_list_tools` item of the history stands in for the call, as it does on OpenAI's API) and offered as functions named by
 * {@link mcpName}. A call of a tool that `require_approval` covers (the default is every tool) is not made: the turn ends with an `mcp_approval_request`
 * item, and the client's `mcp_approval_response` on the next turn either makes the call (`approve: true`) or tells the model it was refused.
 * @module @cldmv/llm-translator/lib/mcptools
 */
import { TranslatorError } from "./errors.mjs";
import { allowed, connect } from "./mcp.mjs";
import { itemId } from "./responses.mjs";
import { mcpItem, mcpName, nativeMark, refusal } from "./responses-tools.mjs";

/**
 * A short reason for a failed MCP call or listing, with nothing of the request in it (no URL, no headers).
 * @param {any} cause - What was thrown.
 * @returns {string} Text of at most 200 characters.
 */
function describe(cause) {
	return String(cause?.message ?? cause).slice(0, 200);
}

/**
 * Whether the tools of a server named by `allowed_tools` include a tool.
 * @param {any} tool - The `mcp` tool of the request.
 * @param {any} listed - A tool the server listed.
 * @returns {boolean} True when the model may be offered it.
 */
function permitted(tool, listed) {
	const rule = tool.allowed_tools;
	if (rule === undefined || rule === null) return true;
	const names = Array.isArray(rule) ? rule : rule.tool_names;
	if (Array.isArray(names) && !names.includes(listed.name)) return false;
	return Array.isArray(rule) || rule.read_only !== true || listed.annotations?.readOnlyHint === true;
}

/**
 * Whether a call of a tool needs the client's approval first (`require_approval`; every tool does unless the request says otherwise).
 * @param {any} tool - The `mcp` tool of the request.
 * @param {string} name - The tool's name on the server.
 * @returns {boolean} True when the call waits for an `mcp_approval_response`.
 */
function approval(tool, name) {
	const rule = tool.require_approval ?? "always";
	if (rule === "never") return false;
	if (rule === "always") return true;
	return !(rule.never?.tool_names ?? []).includes(name) || (rule.always?.tool_names ?? []).includes(name);
}

/**
 * The MCP part of a plan for the hosted tool runner.
 * @param {any[]} marks - The tools the request converter marked `mcp` (`tool.llmt_hosted`).
 * @param {any[]} items - The MCP input items (messages marked `llmt_native`).
 * @param {{hosts: string[]} | undefined} setting - The `serverTools.mcp` setting.
 * @returns {{setting: any, servers: any[], names: Map<string, {server: any, tool: string}>}} The plan.
 * @throws {TranslatorError} `unsupported_tool` (for a tool) or `unsupported_content` (for an item) when MCP is not configured, and `unsupported_tool` for a URL that may not be called; `invalid_request` for two servers with one label; `unsupported_content` for an approval response whose request is not earlier in the input.
 */
export function plan(marks, items, setting) {
	if (setting === undefined) {
		if (marks.length > 0) {
			throw refusal(
				marks[0].llmt_hosted.at,
				'the mcp tool is off: add serverTools.mcp with the hosts it may call, for example { hosts: ["mcp.example.com"] } (see docs/settings.md)'
			);
		}
		const at = items[0].llmt_native.at;
		throw new TranslatorError(
			`${at}: ${items[0].llmt_native.item.type} items need the mcp tool, which is off: add serverTools.mcp (see docs/settings.md)`,
			{
				code: "unsupported_content",
				param: at
			}
		);
	}
	const servers = [];
	for (const mark of marks) {
		const { at, tool } = mark.llmt_hosted;
		try {
			allowed(tool.server_url, setting);
		} catch (cause) {
			throw refusal(`${at}.server_url`, cause.message);
		}
		if (servers.some((server) => server.label === tool.server_label)) {
			throw new TranslatorError(`${at}.server_label: the label ${JSON.stringify(tool.server_label)} is used by another mcp tool`, {
				code: "invalid_request",
				param: `${at}.server_label`
			});
		}
		servers.push({ mark, tool, label: tool.server_label, client: null, ready: null, entries: [] });
	}
	const asked = new Set();
	for (const { llmt_native: found } of items) {
		if (found.item.type === "mcp_approval_request") asked.add(found.item.id);
		else if (found.item.type === "mcp_approval_response" && !asked.has(found.item.approval_request_id)) {
			throw new TranslatorError(`${found.at}.approval_request_id: it names no mcp_approval_request earlier in the input`, {
				code: "unsupported_content",
				param: `${found.at}.approval_request_id`
			});
		}
	}
	return { setting, servers, names: new Map() };
}

/**
 * Make a server's client and initialize it, once.
 * @param {any} plan - Plan from {@link plan}.
 * @param {any} server - One of its servers.
 * @param {AbortSignal | undefined} signal - Aborts the calls.
 * @returns {Promise<void>} Resolves when the server is initialized.
 */
function ready(plan, server, signal) {
	server.ready ??= (async () => {
		server.client = connect(
			{ url: server.tool.server_url, headers: server.tool.headers, authorization: server.tool.authorization },
			plan.setting,
			signal
		);
		await server.client.initialize();
	})();
	return server.ready;
}

/**
 * Call a tool of a server.
 * @param {any} plan - Plan from {@link plan}.
 * @param {any} server - One of its servers.
 * @param {string} name - The tool's name on the server.
 * @param {any} args - The arguments.
 * @param {AbortSignal | undefined} signal - Aborts the calls.
 * @returns {Promise<{text: string, error: boolean}>} The result as text; a failure is an error result, never a throw.
 */
async function call(plan, server, name, args, signal) {
	try {
		await ready(plan, server, signal);
		return await server.client.call(name, args);
	} catch (cause) {
		return { text: describe(cause), error: true };
	}
}

/** The Anthropic-shaped view of an MCP tool the executors' `execute` is given. */
const VIEW = { type: "mcp_20250618", name: "mcp" };

/**
 * List the servers' tools, register them with the plan and turn the MCP items of the history into the messages the model reads.
 *
 * The plan's `tools` and `hosted` maps get an entry per tool offered (so the runner's `rewrite` offers them and `execute` runs them), and `plan.names` maps
 * the function name back to the server and tool. A server that cannot be listed gets an `mcp_list_tools` item with an `error` and offers nothing.
 * @param {object} spec - `{ plan, tools, hosted, messages, signal, announce }`.
 * @param {any} spec.plan - Plan from {@link plan}.
 * @param {Map<string, any>} spec.tools - The runner plan's `tools`.
 * @param {Map<any, any[]>} spec.hosted - The runner plan's `hosted`.
 * @param {any[]} spec.messages - The Chat messages of the request.
 * @param {AbortSignal | undefined} spec.signal - Aborts the calls.
 * @param {(spec: any) => void} spec.announce - Emits an event.
 * @returns {Promise<{messages: any[], prefix: any[]}>} The messages without the MCP items, and the items the response starts with (new `mcp_list_tools`, approved `mcp_call`).
 */
export async function prepare({ plan, tools, hosted, messages, signal, announce }) {
	const prefix = [];
	const listed = new Map();
	for (const message of messages) {
		if (nativeMark(message) && message.llmt_native.item.type === "mcp_list_tools")
			listed.set(message.llmt_native.item.server_label, message.llmt_native.item);
	}
	for (const server of plan.servers) {
		let offered;
		const known = listed.get(server.label);
		if (known !== undefined) offered = known.tools ?? [];
		else {
			try {
				await ready(plan, server, signal);
				offered = (await server.client.list()).map((entry) => ({
					name: entry.name,
					description: entry.description ?? null,
					input_schema: entry.inputSchema ?? { type: "object", properties: {} },
					annotations: entry.annotations ?? null
				}));
				prefix.push({ id: itemId("mcpl"), type: "mcp_list_tools", server_label: server.label, tools: offered });
			} catch (cause) {
				offered = [];
				prefix.push({ id: itemId("mcpl"), type: "mcp_list_tools", server_label: server.label, tools: [], error: describe(cause) });
				announce({
					type: "servertool",
					kind: "mcp_list_tools",
					level: "warn",
					message: `Listing the tools of the MCP server ${server.label} failed: ${describe(cause)}`
				});
			}
		}
		server.entries = [];
		const executor = {
			type: /^mcp_/,
			run: async (input, details) => ({ content: await call(plan, server, plan.names.get(details.name).tool, input, signal) }),
			read: (content) => (content.error ? `error: ${content.text}` : content.text)
		};
		for (const entry of offered.filter((one) => permitted(server.tool, one))) {
			const name = mcpName(server.label, entry.name);
			if (plan.names.has(name)) continue;
			plan.names.set(name, { server, tool: entry.name });
			const member = {
				name,
				description: entry.description ?? undefined,
				schema: entry.input_schema ?? { type: "object", properties: {} }
			};
			const found = { tool: VIEW, executor, member };
			tools.set(name, found);
			server.entries.push(found);
		}
		hosted.set(server.mark, server.entries);
	}
	const out = [];
	const asked = new Map();
	for (const message of messages) {
		if (!nativeMark(message) || !mcpItem(message.llmt_native.item)) {
			out.push(message);
			continue;
		}
		const { item } = message.llmt_native;
		if (item.type === "mcp_call") {
			out.push(
				...exchange(
					item.id,
					mcpName(item.server_label, item.name),
					item.arguments,
					item.error ? `error: ${item.error}` : (item.output ?? "")
				)
			);
		} else if (item.type === "mcp_approval_request") {
			asked.set(item.id, item);
		} else if (item.type === "mcp_approval_response") {
			const request = asked.get(item.approval_request_id);
			out.push(...(await answered(plan, request, item, prefix, signal)));
		}
	}
	return { messages: out, prefix };
}

/**
 * The messages for a call and its result: the model's call and a tool message.
 * @param {string} id - The call id.
 * @param {string} name - The function name.
 * @param {any} args - The arguments (JSON text).
 * @param {string} text - The result text.
 * @returns {any[]} Two Chat messages.
 */
function exchange(id, name, args, text) {
	return [
		{
			role: "assistant",
			content: null,
			tool_calls: [{ id, type: "function", function: { name, arguments: typeof args === "string" ? args : "{}" } }]
		},
		{ role: "tool", tool_call_id: id, content: text }
	];
}

/**
 * The messages for an approval request the client answered: the call is made when it was approved, and the model is told when it was not.
 * @param {any} plan - Plan from {@link plan}.
 * @param {any} request - The `mcp_approval_request` item.
 * @param {any} response - The `mcp_approval_response` item.
 * @param {any[]} prefix - Receives the `mcp_call` item of a call that was made.
 * @param {AbortSignal | undefined} signal - Aborts the call.
 * @returns {Promise<any[]>} The call and its result as Chat messages.
 */
async function answered(plan, request, response, prefix, signal) {
	if (response.approve !== true) {
		return exchange(
			request.id,
			mcpName(request.server_label, request.name),
			request.arguments,
			"The user did not approve this call, so it was not made."
		);
	}
	const server = plan.servers.find((entry) => entry.label === request.server_label);
	let args = {};
	try {
		const parsed = JSON.parse(typeof request.arguments === "string" && request.arguments !== "" ? request.arguments : "{}");
		if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed;
	} catch {
		// The arguments the model wrote were not an object: the server is asked with none, and says so.
	}
	const result =
		server === undefined
			? { text: "The MCP server of this call is not part of the request.", error: true }
			: await call(plan, server, request.name, args, signal);
	prefix.push(callItem(request.server_label, request.name, request.arguments, result, request.id));
	return exchange(
		request.id,
		mcpName(request.server_label, request.name),
		request.arguments,
		result.error ? `error: ${result.text}` : result.text
	);
}

/**
 * The `mcp_call` item of a call.
 * UNSURE (OpenAI item fields): `{ id, type, server_label, name, arguments, output, error, status?, approval_request_id? }`, with `output` the result text
 * and `error` the failure text (the other is null).
 * @param {string} label - The `server_label`.
 * @param {string} name - The tool's name on the server.
 * @param {string} args - The arguments as JSON text.
 * @param {{text: string, error: boolean}} result - The result.
 * @param {string} [approved] - The id of the `mcp_approval_request` that was approved for it.
 * @returns {any} The item.
 */
export function callItem(label, name, args, result, approved) {
	return {
		id: itemId("mcp"),
		type: "mcp_call",
		server_label: label,
		name,
		arguments: args,
		output: result.error ? null : result.text,
		error: result.error ? result.text : null,
		status: result.error ? "failed" : "completed",
		...(approved === undefined ? {} : { approval_request_id: approved })
	};
}

/**
 * Whether a function the model called is an MCP tool whose call waits for approval.
 * @param {any} plan - The MCP plan.
 * @param {string} name - The function name.
 * @returns {boolean} True when the call is not made but asked about.
 */
export function pending(plan, name) {
	const known = plan?.names.get(name);
	return known !== undefined && approval(known.server.tool, known.tool);
}

/**
 * The `mcp_approval_request` item for a call.
 * @param {any} plan - The MCP plan.
 * @param {{name: string, input: any}} call - The call the model made.
 * @returns {any} The item.
 */
export function requestItem(plan, call) {
	const { server, tool } = plan.names.get(call.name);
	return {
		id: itemId("mcpr"),
		type: "mcp_approval_request",
		server_label: server.label,
		name: tool,
		arguments: JSON.stringify(call.input)
	};
}

/**
 * The `mcp_call` item for a call the runner made.
 * @param {any} plan - The MCP plan.
 * @param {any} made - The call the model made (`{ name, input }`, with the id it was made under).
 * @param {any} content - The result content (`{ text, error }`, or an error object when the arguments were not an object).
 * @returns {any} The item.
 */
export function madeItem(plan, made, content) {
	const { server, tool } = plan.names.get(made.name);
	const result = typeof content?.text === "string" ? content : { text: "the arguments were not a JSON object", error: true };
	return callItem(server.label, tool, JSON.stringify(made.input), result);
}

/**
 * The function name that forces a tool, for `tool_choice` `{ type: "mcp", server_label, name }`.
 * @param {any} plan - The MCP plan.
 * @param {{server_label: string, name?: string}} choice - The request's choice.
 * @returns {any} The Chat `tool_choice`: the function when the server has the tool, else `required`.
 */
export function choose(plan, choice) {
	const name = choice.name === undefined ? undefined : mcpName(choice.server_label, choice.name);
	return name !== undefined && plan.names.has(name) ? { type: "function", function: { name } } : "required";
}

/**
 * End the sessions of the servers that were used.
 * @param {any} plan - The MCP plan.
 * @returns {Promise<void>} Resolves when every session is closed.
 */
export async function close(plan) {
	await Promise.all(plan.servers.map((server) => server.client?.close()));
}

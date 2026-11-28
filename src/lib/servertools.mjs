/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/servertools.mjs
 *	@Date: 2026-11-24T21:49:32-08:00 (1795585772)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-25T00:38:11-08:00 (1795595891)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Anthropic server tools (`web_search_*`, `web_fetch_*`, `code_execution_*`, `tool_search_*`) run by the translator.
 *
 * An Anthropic-front request that goes to a converted upstream (OpenAI Chat, Responses, Gemini, ...) cannot use these tools, because the
 * upstream model has no server behind it. When the caller configured an executor for a server tool type, the translator offers the tool to
 * the upstream as a function tool, runs the executor itself when the model calls it, appends the call and its result to the conversation
 * and asks the upstream again, until the model stops calling server tools. The client receives Anthropic's own blocks: `server_tool_use`
 * followed by the result block, then the model's following output. Every upstream round is an ordinary `send` of an Anthropic-shaped body
 * whose server tools were replaced by function tools, so routing, failover, conversion, capture, events and usage metering apply per round.
 *
 * An executor is `{ type, schema, run, description?, result?, usage? }`:
 * - `type`: a `RegExp` (or exact string) matched against the tool's `type` (`/^web_search_/`).
 * - `schema(tool)`: the JSON schema of the function's input (an object schema) for that tool definition.
 * - `description`: text (or `(tool) => text`) offered to the model with the function.
 * - `run(input, { tool, id, signal, context })`: async; returns `{ content, type? }` (the result block's `content`, and its block type when
 *   it is not `<tool kind>_tool_result`) or throws. A thrown error becomes the tool's error result (`error_code` from the error's `code`
 *   when it is a string, else `unavailable`). `context` is `{ model, metadata, messages, results }`: the client request's model, metadata and
 *   messages, and the content of the results the runner produced earlier in this request.
 * - `result`: the result block type, for a tool kind this module does not know.
 * - `usage`: the `usage.server_tool_use` counter this tool increments (`web_search_requests`, `web_fetch_requests`; none for other kinds).
 * - `members(tool)`: for a tool that Anthropic serves as several functions (`code_execution_20250825` is `bash_code_execution` and
 *   `text_editor_code_execution`), returns `[{ name, schema, description?, result? }]`; each member is offered to the upstream as a function of its
 *   own, a call of it is returned as a `server_tool_use` named `name`, and its result block type is `result`. `run` receives `name`.
 * - `deferred`: `true` for an executor that searches the request's tools marked `defer_loading: true` (tool search). The runner then withholds those
 *   tools from the upstream until a search result of this request, or a `tool_reference` in the history, names them, and offers them as
 *   ordinary function tools from then on. A result `content` with `tool_references` (`[{ type: "tool_reference", tool_name }]`) loads the tools it names.
 *   `context.tools` is the request's tools.
 * - `read(content)`: the text the upstream model reads for a successful result, for a result whose `content` is not readable as JSON (it is used
 *   for a result the runner just produced and for one the client replays in history). Without it the content is sent as JSON. It also gets `offset`,
 *   the number of citable results that came before this one in the request, so an executor that has `cite` numbers its results from `offset + 1`.
 * - `cite(item)`: makes the executor's results citable. `item` is one entry of a result's `content` array; `cite` returns the Anthropic citation
 *   (`web_search_result_location`) for it. The runner numbers the items of every result of the request in order (the history's first), and a
 *   text of the model that has `[[cite:N]]` markers (see citemarks.mjs) becomes text blocks with the citations of source N.
 * @module @cldmv/llm-translator/lib/servertools
 */
import { randomBytes } from "node:crypto";
import { AsyncResource } from "node:async_hooks";
import { TranslatorError } from "./errors.mjs";
import { resolve } from "./route.mjs";
import { combine, deliver } from "./usage.mjs";
import { emit } from "./events.mjs";
import { split, streamer } from "./citemarks.mjs";

/**
 * @typedef {object} ServerToolExecutor
 * @property {RegExp | string} type Matches the tool's `type` (`/^web_search_/`, or an exact `"web_fetch_20250910"`).
 * @property {(tool: any) => any} schema JSON schema (an object schema) of the function's input, for that tool definition.
 * @property {(input: any, details: {tool: any, id: string, name: string, signal?: AbortSignal, context: {model?: string, metadata?: any, messages?: any[], tools?: any[], results?: any[], container?: string}, container?: string, files: any | null}) => Promise<{content: any, type?: string, container?: {id: string, expires_at?: string}}>} run Runs one call; resolves with the result block's `content` (its `type` when it is not `<kind>_tool_result`, and the `container` the call ran in) or throws. `container` is the container id of the request (or of an earlier call of it) and `files` the file store of the Files API (null when it is off).
 * @property {string | ((tool: any) => string)} [description] Text offered to the model with the function.
 * @property {string} [result] The result block type, for a tool kind that has no `<kind>_tool_result`.
 * @property {string} [usage] The `usage.server_tool_use` counter a call increments (defaults to `web_search_requests` / `web_fetch_requests` for those kinds).
 * @property {(tool: any) => {name: string, schema: any, description?: string, result?: string}[]} [members] The functions one tool definition is offered as, when it is more than one.
 * @property {boolean} [deferred] Whether the executor searches the tools marked `defer_loading` (the runner withholds them until a result names them).
 * @property {(content: any, offset?: number) => string} [read] The text the upstream model reads for a successful result (default: the content as JSON); `offset` is the number of citable items before it in the request.
 * @property {(item: any) => any} [cite] The citation of one item of a result's `content` array; makes the executor's results citable with `[[cite:N]]` markers.
 */

/** @typedef {ServerToolExecutor[] | {executors?: ServerToolExecutor[], maxRounds?: number}} ServerTools */

/** The default number of upstream calls one request may make. */
export const ROUNDS = 10;

/** The usage counters Anthropic defines in `usage.server_tool_use`, by tool kind. */
const COUNTERS = { web_search: "web_search_requests", web_fetch: "web_fetch_requests" };

/** The error content type of a tool kind's result, where it does not follow `<kind>_tool_result_error`. */
const ERRORS = { web_fetch: "web_fetch_tool_error" };

/**
 * The kind of a server tool type: the type without its date suffix.
 * @param {string} type - Tool type (`web_search_20250305`).
 * @returns {string} Kind (`web_search`).
 */
export function kind(type) {
	return type.replace(/_\d+$/, "");
}

/**
 * Validate the `serverTools` option of the config or of a `send` call.
 * @param {any} value - `undefined`, an array of executors, or `{ executors, maxRounds }`.
 * @returns {{executors: any[], maxRounds: number | undefined}} Normalized option.
 * @throws {TranslatorError} `INVALID_CONFIG` for an executor with no usable `type`, `schema` or `run`, or a `maxRounds` that is not a positive whole number.
 */
export function normalize(value) {
	if (value === undefined || value === null) return { executors: [], maxRounds: undefined };
	const spec = Array.isArray(value) ? { executors: value } : value;
	const executors = spec.executors ?? [];
	const bad = (message) => new TranslatorError(`serverTools: ${message}`, { code: "INVALID_CONFIG", status: 500 });
	if (!Array.isArray(executors)) throw bad("executors must be an array");
	for (const executor of executors) {
		if (!executor || typeof executor !== "object") throw bad("an executor must be an object");
		if (!(executor.type instanceof RegExp) && (typeof executor.type !== "string" || executor.type === "")) {
			throw bad("an executor's type must be a RegExp or a non-empty string");
		}
		if (typeof executor.schema !== "function") throw bad("an executor's schema must be a function");
		if (typeof executor.run !== "function") throw bad("an executor's run must be a function");
		if (executor.members !== undefined && typeof executor.members !== "function") throw bad("an executor's members must be a function");
		if (executor.deferred !== undefined && typeof executor.deferred !== "boolean") throw bad("an executor's deferred must be a boolean");
		if (executor.read !== undefined && typeof executor.read !== "function") throw bad("an executor's read must be a function");
		if (executor.cite !== undefined && typeof executor.cite !== "function") throw bad("an executor's cite must be a function");
	}
	if (spec.maxRounds !== undefined && (!Number.isInteger(spec.maxRounds) || spec.maxRounds < 1)) {
		throw bad("maxRounds must be a positive whole number");
	}
	return { executors: [...executors], maxRounds: spec.maxRounds };
}

/**
 * The executor for a tool type.
 * @param {any[]} executors - Executors, earlier ones win.
 * @param {string} type - Tool type.
 * @returns {any} The executor, or undefined.
 */
export function find(executors, type) {
	return executors.find((executor) => (executor.type instanceof RegExp ? executor.type.test(type) : executor.type === type));
}

/**
 * Whether a request body has server tools the runner takes over and the routed upstream is a converted one, and if so the plan to run it.
 * A passthrough to an Anthropic-protocol upstream is never touched: that server runs its own server tools.
 * @param {any} c - Captured translator parts (`capture`).
 * @param {any} body - Client request body.
 * @param {any} options - The `send` options (`serverTools`).
 * @returns {{executors: any[], maxRounds: number, tools: Map<string, {tool: any, executor: any, member?: any}>, hosted: Map<any, any[]>, loaded: Set<string> | null} | null} The plan, or null for the normal path.
 */
export function wants(c, body, options) {
	if (
		c.front !== "anthropic" ||
		!body ||
		typeof body !== "object" ||
		Array.isArray(body) ||
		!Array.isArray(body.tools) ||
		!Array.isArray(body.messages)
	)
		return null;
	const own = normalize(options.serverTools);
	const global = c.config.serverTools;
	const executors = [...own.executors, ...global.executors];
	if (executors.length === 0) return null;
	/** @type {Map<string, {tool: any, executor: any, member?: any}>} */
	const tools = new Map();
	/** @type {Map<any, {tool: any, executor: any, member?: any}[]>} */
	const hosted = new Map();
	for (const tool of body.tools) {
		if (typeof tool?.type !== "string" || tool.type === "custom") continue;
		const executor = find(executors, tool.type);
		if (executor === undefined) continue;
		const members = typeof executor.members === "function" ? executor.members(tool) : [];
		const entries = members.length > 0 ? members.map((member) => ({ tool, executor, member })) : [{ tool, executor }];
		for (const entry of entries) tools.set(entry.member?.name ?? tool.name, entry);
		hosted.set(tool, entries);
	}
	if (tools.size === 0) return null;
	if (resolve(c, body).convert === null) return null;
	const searching = [...tools.values()].some((entry) => entry.executor.deferred === true);
	return {
		executors,
		maxRounds: own.maxRounds ?? global.maxRounds ?? ROUNDS,
		tools,
		hosted,
		loaded: searching ? new Set(references(body.messages)) : null
	};
}

/**
 * The names of the tools the history's results loaded: `tool_reference` blocks in a server tool result's content (`tool_search_tool_result`) and
 * in a client `tool_result`'s content array (a custom search tool).
 * @param {any[]} messages - Client messages.
 * @returns {string[]} Tool names.
 */
function references(messages) {
	const names = [];
	for (const message of messages) {
		if (!Array.isArray(message?.content)) continue;
		for (const block of message.content) {
			if (!String(block?.type).endsWith("tool_result")) continue;
			const inner = Array.isArray(block.content)
				? block.content
				: Array.isArray(block.content?.tool_references)
					? block.content.tool_references
					: [];
			for (const item of inner) if (item?.type === "tool_reference" && typeof item.tool_name === "string") names.push(item.tool_name);
		}
	}
	return names;
}

/**
 * The text of a result block's content, as the function result the upstream model reads.
 * @param {any} content - The result block's `content`.
 * @returns {string} Text.
 */
function text(content) {
	return typeof content === "string" ? content : JSON.stringify(content);
}

/**
 * The text of a result for the upstream model: the executor's `read` for a successful result, the JSON of the content otherwise.
 * @param {any} executor - Executor of the tool, or undefined when unknown.
 * @param {any} content - The result block's `content`.
 * @param {number} [offset] - Citable items that came before this result in the request.
 * @returns {string} Text.
 */
export function render(executor, content, offset = 0) {
	return typeof executor?.read === "function" && !failed(content) ? executor.read(content, offset) : text(content);
}

/**
 * The items of a result that can be cited: the entries of a successful result's content array, for an executor that has `cite`.
 * @param {any} executor - Executor of the tool, or undefined when unknown.
 * @param {any} content - The result block's `content`.
 * @returns {any[]} The items, or none.
 */
export function citable(executor, content) {
	return typeof executor?.cite === "function" && Array.isArray(content) ? content : [];
}

/**
 * The citations of the results in a request's history, in order: the sources that `[[cite:N]]` markers may name before this turn's searches.
 * @param {any[]} messages - Client messages.
 * @param {any} plan - Plan from {@link wants}.
 * @returns {any[]} Citations; source N is entry N - 1.
 */
export function sources(messages, plan) {
	const out = [];
	for (const message of messages) {
		if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
		const named = new Map(message.content.filter((block) => block?.type === "server_tool_use").map((block) => [block.id, block.name]));
		for (const block of message.content) {
			if (!isResult(block)) continue;
			const executor = plan.tools.get(named.get(block.tool_use_id))?.executor;
			out.push(...citable(executor, block.content).map((item) => executor.cite(item)));
		}
	}
	return out;
}

/**
 * A block of the model's answer with its `[[cite:N]]` markers turned into citations.
 * @param {any} block - A content block of the answer.
 * @param {any[]} known - The citations the markers may name.
 * @returns {any[]} The block as it was, or the text blocks it was cut into.
 */
function expand(block, known) {
	if (known.length === 0 || block.type !== "text" || block.citations?.length > 0) return [block];
	const parts = split(block.text, known);
	if (parts.every((part) => part.citations.length === 0)) return [block];
	return parts.map((part) => ({
		type: "text",
		text: part.text,
		...(part.citations.length > 0 ? { citations: part.citations.map((citation) => ({ ...citation })) } : {})
	}));
}

/**
 * Whether a result block's content is an error object (`<...>_error` with an `error_code`).
 * @param {any} content - The result block's `content`.
 * @returns {boolean} True for an error result.
 */
export function failed(content) {
	return typeof content?.error_code === "string";
}

/**
 * Convert the server tool blocks of a request's history into a function call and its result, as the upstream understands them. An assistant
 * message `[text, server_tool_use, <x>_tool_result, text]` becomes `assistant [text, tool_use]`, `user [tool_result]`, `assistant [text]`
 * (the converters merge adjacent turns of one role). A `server_tool_use` with no result in its message is dropped.
 * @param {any[]} messages - Client messages.
 * @param {any} [plan] - Plan from {@link wants}; its executors' `read` renders the results.
 * @returns {any[]} Messages with no server tool blocks.
 */
export function history(messages, plan) {
	const out = [];
	// The results the model could cite are numbered across the whole history, so a result's offset is the citable items before it.
	let seen = 0;
	for (const message of messages) {
		if (message?.role !== "assistant" || !Array.isArray(message.content)) {
			out.push(message);
			continue;
		}
		const answered = new Set(message.content.filter(isResult).map((block) => block.tool_use_id));
		const named = new Map(message.content.filter((block) => block?.type === "server_tool_use").map((block) => [block.id, block.name]));
		let assistant = [];
		let results = [];
		for (const block of message.content) {
			if (isResult(block)) {
				if (assistant.length > 0) out.push({ ...message, content: assistant });
				assistant = [];
				const executor = plan?.tools.get(named.get(block.tool_use_id))?.executor;
				const offset = seen;
				seen += citable(executor, block.content).length;
				results.push({
					type: "tool_result",
					tool_use_id: block.tool_use_id,
					content: render(executor, block.content, offset),
					...(failed(block.content) ? { is_error: true } : {})
				});
				continue;
			}
			if (results.length > 0) out.push({ role: "user", content: results });
			results = [];
			if (block?.type !== "server_tool_use") assistant.push(plan === undefined ? block : unmarked(block));
			else if (answered.has(block.id)) assistant.push({ type: "tool_use", id: block.id, name: block.name, input: block.input ?? {} });
		}
		if (assistant.length > 0) out.push({ ...message, content: assistant });
		if (results.length > 0) out.push({ role: "user", content: results });
	}
	return out;
}

/**
 * A replayed text block without the citations this translator wrote (`web_search_result_location`): the upstream model sees the text, and the
 * results it came from are in the history as numbered function results.
 * @param {any} block - Content block of an assistant message.
 * @returns {any} The block, without those citations.
 */
function unmarked(block) {
	if (block?.type !== "text" || !Array.isArray(block.citations)) return block;
	const { citations, ...rest } = block;
	const left = citations.filter((citation) => citation.type !== "web_search_result_location");
	return left.length > 0 ? { ...rest, citations: left } : rest;
}

/**
 * Whether a block is the result of a server tool (`web_search_tool_result`, ...), not a client tool result.
 * @param {any} block - Content block.
 * @returns {boolean} True for a server tool result block.
 */
function isResult(block) {
	return (
		typeof block?.type === "string" &&
		block.type !== "tool_result" &&
		block.type.endsWith("_tool_result") &&
		typeof block.tool_use_id === "string"
	);
}

/**
 * The request the upstream gets: the server tools the runner took over become function tools, and server tool blocks in the history become
 * a function call and its result.
 * @param {any} body - Client request body.
 * @param {any} plan - Plan from {@link wants}.
 * @param {any[]} extra - Messages appended after the client's (the rounds run so far).
 * @returns {any} Anthropic-shaped body with only custom tools.
 */
export function rewrite(body, plan, extra = []) {
	const tools = body.tools.flatMap((tool) => {
		const entries = plan.hosted.get(tool);
		if (entries === undefined) {
			if (plan.loaded === null || tool.defer_loading !== true) return [tool];
			// A deferred tool stays out of the upstream's tools until a search has named it; then it is an ordinary tool.
			const { defer_loading: _, ...rest } = tool;
			return plan.loaded.has(tool.name) ? [rest] : [];
		}
		return entries.map(({ executor, member }) => {
			const description =
				member?.description ?? (typeof executor.description === "function" ? executor.description(tool) : executor.description);
			return {
				name: member?.name ?? tool.name,
				...(typeof description === "string" ? { description } : {}),
				input_schema: member?.schema ?? executor.schema(tool)
			};
		});
	});
	return { ...body, tools, messages: [...history(body.messages, plan), ...extra] };
}

/**
 * The container id of a request's `container` field (an id, or an object with one).
 * @param {any} value - The request's `container`.
 * @returns {string | undefined} The id.
 */
function containerId(value) {
	const id = typeof value === "string" ? value : value?.id;
	return typeof id === "string" && id !== "" ? id : undefined;
}

/**
 * The `container` field of the reply, when an executor reported the container a call ran in.
 * @param {{container?: any}} state - Request-wide state.
 * @returns {{container: any} | {}} The field, or nothing.
 */
function held(state) {
	return state.container === undefined ? {} : { container: state.container };
}

/**
 * A fresh server tool use id.
 * @returns {string} `srvtoolu_...` id.
 */
function id() {
	return `srvtoolu_${randomBytes(12).toString("hex")}`;
}

/**
 * Run one server tool call.
 * @param {any} call - `{ id, name, input }` as the upstream model called it.
 * @param {any} plan - Plan from {@link wants}.
 * @param {{used: Map<string, number>, counts: Record<string, number>, signal: AbortSignal | undefined, context: any, files: any, container?: {id: string, expires_at?: string}, announce: (spec: any) => void, sources: any[], offsets: Map<any, number>}} state - Request-wide state.
 * @returns {Promise<{use: any, result: any}>} The `server_tool_use` block (new id) and the result block.
 */
export async function execute(call, plan, state) {
	const { tool, executor, member } = plan.tools.get(call.name);
	const use = { type: "server_tool_use", id: id(), name: call.name, input: call.input };
	const base = kind(tool.type);
	const done = (type, content) => ({ use, result: { type, tool_use_id: use.id, content } });
	const resultType = member?.result ?? executor.result ?? `${base}_tool_result`;
	const problem = (code, message) => {
		state.announce({ type: "servertool", kind: code, level: "warn", message, tool: call.name });
		return done(resultType, { type: ERRORS[base] ?? `${resultType}_error`, error_code: code });
	};
	const used = state.used.get(call.name) ?? 0;
	if (Number.isInteger(tool.max_uses) && used >= tool.max_uses) {
		return problem("max_uses_exceeded", `${call.name} was called more than its max_uses (${tool.max_uses}) allows`);
	}
	state.used.set(call.name, used + 1);
	const counter = executor.usage ?? COUNTERS[base];
	if (counter !== undefined) state.counts[counter] = (state.counts[counter] ?? 0) + 1;
	if (call.input && typeof call.input === "object" && "_raw_arguments" in call.input) {
		return problem("invalid_tool_input", `${call.name} was called with arguments that are not a JSON object`);
	}
	try {
		const container = state.container?.id ?? state.context.container;
		const details = { tool, id: use.id, name: call.name, signal: state.signal, context: state.context, container, files: state.files };
		const out = await executor.run(call.input, details);
		if (!out || typeof out !== "object" || out.content === undefined) throw new TypeError("the executor returned no content");
		// Later calls of the request may fetch the URLs this result names.
		state.context.results?.push(out.content);
		if (typeof executor.cite === "function" && Array.isArray(out.content)) {
			state.offsets.set(out.content, state.sources.length);
			state.sources.push(...out.content.map((item) => executor.cite(item)));
		}
		if (executor.deferred === true) {
			for (const item of out.content?.tool_references ?? []) if (typeof item?.tool_name === "string") plan.loaded.add(item.tool_name);
		}
		if (out.container?.id !== undefined) state.container = out.container;
		return done(out.type ?? resultType, out.content);
	} catch (cause) {
		const code = typeof cause?.code === "string" && /^[a-z_]+$/.test(cause.code) ? cause.code : "unavailable";
		return problem(code, `${call.name} failed: ${cause?.message ?? cause}`);
	}
}

/**
 * The messages that carry one round's server tool calls and their results to the next upstream call.
 * @param {any[]} blocks - The round's content blocks as the upstream reply gave them (text, thinking, `tool_use`).
 * @param {{call: any, result: any}[]} ran - The executed calls with their result blocks.
 * @param {any} plan - Plan from {@link wants}.
 * @param {Map<any, number>} offsets - Citable items before each result's content, by the content.
 * @returns {any[]} An assistant message and the user message with the function results.
 */
function turn(blocks, ran, plan, offsets) {
	return [
		{ role: "assistant", content: blocks },
		{
			role: "user",
			content: ran.map(({ call, result }) => ({
				type: "tool_result",
				tool_use_id: call.id,
				content: render(plan.tools.get(call.name).executor, result.content, offsets.get(result.content)),
				...(failed(result.content) ? { is_error: true } : {})
			}))
		}
	];
}

/**
 * Add two usage objects (numbers add, nested objects recurse, any other value is replaced by the later one).
 * @param {any} left - Usage so far.
 * @param {any} right - Usage to add.
 * @returns {any} The sum.
 */
export function add(left, right) {
	if (left === undefined || left === null) return right;
	if (right === undefined || right === null) return left;
	if (typeof left === "number" && typeof right === "number") return left + right;
	if (typeof left === "object" && typeof right === "object" && !Array.isArray(left) && !Array.isArray(right)) {
		const out = { ...left };
		for (const key of Object.keys(right)) out[key] = add(left[key], right[key]);
		return out;
	}
	return right;
}

/**
 * The usage of the reply: the rounds' usage summed, with the server tool counters.
 * @param {any} sum - Summed Anthropic usage of the rounds.
 * @param {Record<string, number>} counts - `usage.server_tool_use` counters.
 * @returns {any} Usage object.
 */
function usageOf(sum, counts) {
	return Object.keys(counts).length > 0 ? add(sum, { server_tool_use: counts }) : sum;
}

/**
 * Answer an Anthropic-front request by running its server tools. See the module comment. Every round is a full `send` of the rewritten
 * body; the reply carries a non-enumerable `usage` promise of the combined report like any `send` reply (for a stream it settles when the
 * stream ends or is closed early).
 * @param {object} spec - `{ body, plan, options, send, warn, c }`.
 * @param {any} spec.body - Client request body.
 * @param {any} spec.plan - Plan from {@link wants}.
 * @param {any} spec.options - The `send` options of the request.
 * @param {(body: any, options: any) => Promise<any>} spec.send - The single-request send.
 * @param {(message: string, details: {kind: "threw" | "rejected"}) => void} spec.warn - Receives a message when `onUsage` throws or rejects.
 * @param {any} spec.c - Captured translator parts (events go there).
 * @returns {Promise<any>} The reply.
 */
export async function run({ body, plan, options, send: direct, warn, c }) {
	// The later rounds of a stream start when the client reads it, outside the call that slothlet gave `send` its context for.
	const send = AsyncResource.bind(direct);
	const waits = [];
	/** @type {(value?: any) => void} */
	let finish;
	const usage = new Promise((done) => {
		finish = done;
	}).then(() =>
		Promise.all(waits).then((reports) => {
			const report = combine(reports);
			deliver(report, options.onUsage, warn);
			return report;
		})
	);
	const attach = (reply) => Object.defineProperty(reply, "usage", { value: usage, enumerable: false, configurable: true });
	/**
	 * One upstream call: a `send` whose usage report is collected.
	 * @param {any[]} extra - Messages the earlier rounds appended.
	 * @returns {Promise<any>} The reply.
	 */
	const ask = (extra) => {
		let report;
		waits.push(
			new Promise((done) => {
				report = done;
			})
		);
		// `send` reports its usage when it throws too (an abort), so the combined report still settles.
		return send(rewrite(body, plan, extra), { ...options, serverTools: undefined, onUsage: report });
	};
	const announce = (spec) => emit(c, { ...spec, log: options.log });
	const state = {
		used: new Map(),
		counts: {},
		signal: options.signal,
		context: {
			model: body.model,
			metadata: body.metadata,
			messages: body.messages,
			tools: body.tools,
			results: [],
			container: containerId(body.container)
		},
		files: c.files(),
		announce,
		sources: sources(body.messages, plan),
		offsets: new Map()
	};
	const stream = body.stream === true;
	let handed = false;
	try {
		const first = await ask([]);
		if (stream ? first.stream !== undefined : first.status === 200) {
			if (!stream) return attach(await collected({ first, ask, plan, state }));
			handed = true;
			return attach({ status: 200, headers: first.headers, stream: streaming({ first, ask, plan, state, finish }) });
		}
		return attach(first);
	} finally {
		// A stream settles the report itself, when it ends.
		if (!handed) finish();
	}
}

/**
 * The non-streaming loop.
 * @param {any} spec - `{ first, ask, plan, state }`.
 * @returns {Promise<any>} The reply.
 */
async function collected({ first, ask, plan, state }) {
	let reply = first;
	let rounds = 1;
	const blocks = [];
	let sum;
	const extra = [];
	for (;;) {
		const message = reply.body;
		sum = add(sum, message.usage);
		const content = message.content;
		// Markers in this round's text can only name the sources the model had read when it wrote it.
		const known = state.sources.slice();
		const calls = content.filter((block) => block.type === "tool_use" && plan.tools.has(block.name));
		if (calls.length === 0) {
			blocks.push(...content.flatMap((block) => expand(block, known)));
			return {
				status: 200,
				headers: first.headers,
				body: { ...message, id: first.body.id, content: blocks, ...held(state), usage: usageOf(sum, state.counts) }
			};
		}
		const ran = [];
		for (const call of calls) ran.push({ call, ...(await execute(call, plan, state)) });
		for (const block of content) {
			const entry = ran.find((item) => item.call === block);
			if (entry) blocks.push(entry.use, entry.result);
			else blocks.push(...expand(block, known));
		}
		const client = content.some((block) => block.type === "tool_use" && !plan.tools.has(block.name));
		const pause = !client && rounds >= plan.maxRounds;
		if (client || pause) {
			if (pause) state.announce(paused(rounds));
			const stop = pause ? { stop_reason: "pause_turn" } : {};
			return {
				status: 200,
				headers: first.headers,
				body: { ...message, id: first.body.id, content: blocks, ...stop, ...held(state), usage: usageOf(sum, state.counts) }
			};
		}
		extra.push(...turn(content, ran, plan, state.offsets));
		reply = await ask(extra);
		rounds++;
		if (reply.status !== 200) return reply;
	}
}

/**
 * The event that records a turn handed back to the client with `pause_turn`.
 * @param {number} rounds - Upstream calls made.
 * @returns {any} Event spec.
 */
function paused(rounds) {
	return {
		type: "servertool",
		kind: "pause_turn",
		level: "warn",
		message: `Stopped after ${rounds} upstream calls (maxRounds); the client can continue the turn`
	};
}

/**
 * A Server-Sent Events frame in the translator's stream shape.
 * @param {string} name - Event name.
 * @param {any} data - Event data (without `type`).
 * @returns {{event: string, data: any}} Frame.
 */
function frame(name, data) {
	return { event: name, data: { type: name, ...data } };
}

/**
 * The frames of a server tool use and its result, as two content blocks.
 * @param {{use: any, result: any}} entry - The executed call.
 * @param {() => number} next - Takes the next block index.
 * @returns {{event: string, data: any}[]} Frames.
 */
function pair({ use, result }, next) {
	const at = next();
	const to = next();
	return [
		frame("content_block_start", { index: at, content_block: { ...use, input: {} } }),
		frame("content_block_delta", { index: at, delta: { type: "input_json_delta", partial_json: JSON.stringify(use.input) } }),
		frame("content_block_stop", { index: at }),
		frame("content_block_start", { index: to, content_block: result }),
		frame("content_block_stop", { index: to })
	];
}

/**
 * The frames of a text block that is read for citation markers. Text goes out as it comes; a marker puts a `citations_delta` on the open block,
 * which then ends: the text after it is a new text block (white space between markers is dropped, so adjacent markers cite the same block).
 * A marker with no text before it in its block is dropped.
 * @param {any} entry - The block's entry (`weave` holds the marker reader and its state, `out` the block's index in the reply).
 * @param {{event: string, data: any}} step - The upstream frame for the block (a delta or the stop).
 * @param {() => number} next - Takes the next block index.
 * @returns {Generator<{event: string, data: any}>} Frames.
 */
function* woven(entry, step, next) {
	const weave = entry.weave;
	const { data } = step;
	const isText = data.type === "content_block_delta" && data.delta.type === "text_delta";
	if (!isText && data.type !== "content_block_stop") {
		yield { ...step, data: { ...data, index: entry.out } };
		return;
	}
	for (const op of isText ? weave.read.feed(data.delta.text) : weave.read.end()) {
		if ("mark" in op) {
			if (!weave.had) continue;
			weave.after = true;
			weave.gap = "";
			yield frame("content_block_delta", { index: entry.out, delta: { type: "citations_delta", citation: { ...op.mark } } });
			continue;
		}
		let piece = op.text;
		if (weave.after) {
			if (piece.trim() === "") {
				weave.gap += piece;
				continue;
			}
			yield frame("content_block_stop", { index: entry.out });
			entry.out = next();
			yield frame("content_block_start", { index: entry.out, content_block: { type: "text", text: "" } });
			piece = weave.gap + piece;
			weave.after = false;
			weave.gap = "";
		}
		if (piece.trim() !== "") weave.had = true;
		yield frame("content_block_delta", { index: entry.out, delta: { type: "text_delta", text: piece } });
	}
	if (!isText) yield { ...step, data: { ...data, index: entry.out } };
}

/**
 * Add a block delta to the block being recorded.
 * @param {any} entry - Recorded block.
 * @param {any} delta - Delta of the `content_block_delta` event.
 * @returns {void}
 */
function record(entry, delta) {
	const block = entry.block;
	if (delta.type === "input_json_delta") entry.json.push(delta.partial_json);
	else if (delta.type === "text_delta") block.text += delta.text;
	else if (delta.type === "thinking_delta") block.thinking += delta.thinking;
	else if (delta.type === "signature_delta") block.signature = delta.signature;
}

/**
 * A tool call's input from its streamed JSON fragments.
 * @param {string[]} json - Fragments.
 * @returns {any} The input object, or `{ _raw_arguments }` when the text is not a JSON object.
 */
function parse(json) {
	const joined = json.join("");
	try {
		const value = JSON.parse(joined === "" ? "{}" : joined);
		if (value && typeof value === "object" && !Array.isArray(value)) return value;
	} catch {
		// Falls through to the raw form.
	}
	return { _raw_arguments: joined };
}

/**
 * The streaming loop: forwards each round's events with block indexes renumbered, holds the server tool calls back until the round ends,
 * runs them, emits them as blocks, and starts the next round. Only the first round's `message_start` and the last round's `message_delta`
 * and `message_stop` are sent; a single round with no server tool call is forwarded as it came.
 * @param {any} spec - `{ first, ask, plan, state, finish }`.
 * @returns {AsyncGenerator<{event: string, data: any}>} Events.
 */
async function* streaming({ first, ask, plan, state, finish }) {
	let reply = first;
	let rounds = 1;
	let index = 0;
	const next = () => index++;
	let sum;
	const extra = [];
	let iterator;
	try {
		for (;;) {
			iterator = reply.stream[Symbol.asyncIterator]();
			/** @type {Map<number, any>} */
			const open = new Map();
			const recorded = [];
			const frames = {};
			for (let step = await iterator.next(); !step.done; step = await iterator.next()) {
				const { data } = step.value;
				if (data.type === "error") {
					yield step.value;
					return;
				}
				if (data.type === "ping") {
					yield step.value;
					continue;
				}
				if (data.type === "message_start" || data.type === "message_delta" || data.type === "message_stop") {
					frames[data.type] = step.value;
					if (data.type === "message_start" && rounds === 1) yield step.value;
					continue;
				}
				if (data.type === "content_block_start") {
					const held = data.content_block.type === "tool_use" && plan.tools.has(data.content_block.name);
					const entry = { block: { ...data.content_block }, held, json: [], out: held ? -1 : next() };
					// A text block of a request with sources is read for `[[cite:N]]` markers.
					if (data.content_block.type === "text" && state.sources.length > 0) {
						entry.weave = { read: streamer(state.sources.slice()), after: false, had: false, gap: "" };
					}
					open.set(data.index, entry);
					if (!held) yield { ...step.value, data: { ...data, index: entry.out } };
					continue;
				}
				const entry = open.get(data.index);
				if (data.type === "content_block_delta") record(entry, data.delta);
				else recorded.push(entry);
				if (entry.weave !== undefined) {
					yield* woven(entry, step.value, next);
					continue;
				}
				if (!entry.held) yield { ...step.value, data: { ...data, index: entry.out } };
			}
			iterator = undefined;
			const content = recorded.map(({ block, json }) => (block.type === "tool_use" ? { ...block, input: parse(json) } : block));
			const delta = frames.message_delta.data;
			sum = add(sum, { ...frames.message_start.data.message.usage, ...delta.usage });
			const calls = content.filter((block) => block.type === "tool_use" && plan.tools.has(block.name));
			if (calls.length === 0 && rounds === 1) {
				yield frames.message_delta;
				yield frames.message_stop;
				return;
			}
			const ran = [];
			for (const call of calls) {
				const done = await execute(call, plan, state);
				ran.push({ call, ...done });
				yield* pair(done, next);
			}
			const client = content.some((block) => block.type === "tool_use" && !plan.tools.has(block.name));
			const pause = calls.length > 0 && !client && rounds >= plan.maxRounds;
			if (calls.length === 0 || client || pause) {
				if (pause) state.announce(paused(rounds));
				const stop = pause ? { stop_reason: "pause_turn" } : {};
				yield frame("message_delta", { ...delta, delta: { ...delta.delta, ...stop, ...held(state) }, usage: usageOf(sum, state.counts) });
				yield frames.message_stop;
				return;
			}
			extra.push(...turn(content, ran, plan, state.offsets));
			reply = await ask(extra);
			rounds++;
			if (reply.stream === undefined) {
				yield frame("error", reply.body);
				return;
			}
		}
	} finally {
		// A stream closed early cancels the round in flight so its usage report settles.
		await iterator?.return();
		finish();
	}
}

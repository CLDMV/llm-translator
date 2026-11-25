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
 *   when it is a string, else `unavailable`). `context` is `{ model, metadata }` of the client request.
 * - `result`: the result block type, for a tool kind this module does not know.
 * - `usage`: the `usage.server_tool_use` counter this tool increments (`web_search_requests`, `web_fetch_requests`; none for other kinds).
 * - `read(content)`: the text the upstream model reads for a successful result, for a result whose `content` is not readable as JSON (it is used
 *   for a result the runner just produced and for one the client replays in history). Without it the content is sent as JSON.
 * @module @cldmv/llm-translator/lib/servertools
 */
import { randomBytes } from "node:crypto";
import { AsyncResource } from "node:async_hooks";
import { TranslatorError } from "./errors.mjs";
import { resolve } from "./route.mjs";
import { combine, deliver } from "./usage.mjs";
import { emit } from "./events.mjs";

/**
 * @typedef {object} ServerToolExecutor
 * @property {RegExp | string} type Matches the tool's `type` (`/^web_search_/`, or an exact `"web_fetch_20250910"`).
 * @property {(tool: any) => any} schema JSON schema (an object schema) of the function's input, for that tool definition.
 * @property {(input: any, details: {tool: any, id: string, signal?: AbortSignal, context: {model?: string, metadata?: any}}) => Promise<{content: any, type?: string}>} run Runs one call; resolves with the result block's `content` (and its `type` when it is not `<kind>_tool_result`) or throws.
 * @property {string | ((tool: any) => string)} [description] Text offered to the model with the function.
 * @property {string} [result] The result block type, for a tool kind that has no `<kind>_tool_result`.
 * @property {string} [usage] The `usage.server_tool_use` counter a call increments (defaults to `web_search_requests` / `web_fetch_requests` for those kinds).
 * @property {(content: any) => string} [read] The text the upstream model reads for a successful result (default: the content as JSON).
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
		if (executor.read !== undefined && typeof executor.read !== "function") throw bad("an executor's read must be a function");
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
function find(executors, type) {
	return executors.find((executor) => (executor.type instanceof RegExp ? executor.type.test(type) : executor.type === type));
}

/**
 * Whether a request body has server tools the runner takes over and the routed upstream is a converted one, and if so the plan to run it.
 * A passthrough to an Anthropic-protocol upstream is never touched: that server runs its own server tools.
 * @param {any} c - Captured translator parts (`capture`).
 * @param {any} body - Client request body.
 * @param {any} options - The `send` options (`serverTools`).
 * @returns {{executors: any[], maxRounds: number, tools: Map<string, {tool: any, executor: any}>} | null} The plan, or null for the normal path.
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
	/** @type {Map<string, {tool: any, executor: any}>} */
	const tools = new Map();
	for (const tool of body.tools) {
		if (typeof tool?.type !== "string" || tool.type === "custom") continue;
		const executor = find(executors, tool.type);
		if (executor !== undefined) tools.set(tool.name, { tool, executor });
	}
	if (tools.size === 0) return null;
	if (resolve(c, body).convert === null) return null;
	return { executors, maxRounds: own.maxRounds ?? global.maxRounds ?? ROUNDS, tools };
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
 * @returns {string} Text.
 */
function render(executor, content) {
	return typeof executor?.read === "function" && !failed(content) ? executor.read(content) : text(content);
}

/**
 * Whether a result block's content is an error object (`<...>_error` with an `error_code`).
 * @param {any} content - The result block's `content`.
 * @returns {boolean} True for an error result.
 */
function failed(content) {
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
				results.push({
					type: "tool_result",
					tool_use_id: block.tool_use_id,
					content: render(plan?.tools.get(named.get(block.tool_use_id))?.executor, block.content),
					...(failed(block.content) ? { is_error: true } : {})
				});
				continue;
			}
			if (results.length > 0) out.push({ role: "user", content: results });
			results = [];
			if (block?.type !== "server_tool_use") assistant.push(block);
			else if (answered.has(block.id)) assistant.push({ type: "tool_use", id: block.id, name: block.name, input: block.input ?? {} });
		}
		if (assistant.length > 0) out.push({ ...message, content: assistant });
		if (results.length > 0) out.push({ role: "user", content: results });
	}
	return out;
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
	const tools = body.tools.map((tool) => {
		const entry = plan.tools.get(tool.name);
		if (entry === undefined) return tool;
		const { executor } = entry;
		const description = typeof executor.description === "function" ? executor.description(tool) : executor.description;
		return {
			name: tool.name,
			...(typeof description === "string" ? { description } : {}),
			input_schema: executor.schema(tool)
		};
	});
	return { ...body, tools, messages: [...history(body.messages, plan), ...extra] };
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
 * @param {{used: Map<string, number>, counts: Record<string, number>, signal: AbortSignal | undefined, context: any, announce: (spec: any) => void}} state - Request-wide state.
 * @returns {Promise<{use: any, result: any}>} The `server_tool_use` block (new id) and the result block.
 */
export async function execute(call, plan, state) {
	const { tool, executor } = plan.tools.get(call.name);
	const use = { type: "server_tool_use", id: id(), name: call.name, input: call.input };
	const base = kind(tool.type);
	const done = (type, content) => ({ use, result: { type, tool_use_id: use.id, content } });
	const resultType = executor.result ?? `${base}_tool_result`;
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
		const out = await executor.run(call.input, { tool, id: use.id, signal: state.signal, context: state.context });
		if (!out || typeof out !== "object" || out.content === undefined) throw new TypeError("the executor returned no content");
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
 * @returns {any[]} An assistant message and the user message with the function results.
 */
function turn(blocks, ran, plan) {
	return [
		{ role: "assistant", content: blocks },
		{
			role: "user",
			content: ran.map(({ call, result }) => ({
				type: "tool_result",
				tool_use_id: call.id,
				content: render(plan.tools.get(call.name).executor, result.content),
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
		context: { model: body.model, metadata: body.metadata },
		announce
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
		const calls = content.filter((block) => block.type === "tool_use" && plan.tools.has(block.name));
		if (calls.length === 0) {
			blocks.push(...content);
			return {
				status: 200,
				headers: first.headers,
				body: { ...message, id: first.body.id, content: blocks, usage: usageOf(sum, state.counts) }
			};
		}
		const ran = [];
		for (const call of calls) ran.push({ call, ...(await execute(call, plan, state)) });
		for (const block of content) {
			const entry = ran.find((item) => item.call === block);
			if (entry) blocks.push(entry.use, entry.result);
			else blocks.push(block);
		}
		const client = content.some((block) => block.type === "tool_use" && !plan.tools.has(block.name));
		const pause = !client && rounds >= plan.maxRounds;
		if (client || pause) {
			if (pause) state.announce(paused(rounds));
			const stop = pause ? { stop_reason: "pause_turn" } : {};
			return {
				status: 200,
				headers: first.headers,
				body: { ...message, id: first.body.id, content: blocks, ...stop, usage: usageOf(sum, state.counts) }
			};
		}
		extra.push(...turn(content, ran, plan));
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
					open.set(data.index, entry);
					if (!held) yield { ...step.value, data: { ...data, index: entry.out } };
					continue;
				}
				const entry = open.get(data.index);
				if (data.type === "content_block_delta") record(entry, data.delta);
				else recorded.push(entry);
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
				yield frame("message_delta", { ...delta, delta: { ...delta.delta, ...stop }, usage: usageOf(sum, state.counts) });
				yield frames.message_stop;
				return;
			}
			extra.push(...turn(content, ran, plan));
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

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/hostedtools.mjs
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
 * @fileoverview The Responses API's hosted tools (`web_search`, `code_interpreter`, `tool_search`) run by the translator.
 *
 * The Responses front converts a request to its Chat Completions form (`openai/responses/to/openai/chat/request.mjs`). A hosted tool that the
 * translator emulates leaves that converter as a function tool carrying `llmt_hosted: { kind, at, tool }`, and a hosted call the client replays as a
 * tool message carrying `llmt_hosted: { kind, item }`. `send` hands such a body to this module, which does for the Responses front what
 * `servertools.mjs` does for the Anthropic one, with the same executors (`serverTools`, see that module for the executor interface): the marked tools are
 * offered to the upstream as function tools, the executor runs when the model calls one, the call and its result are appended to the conversation and the
 * upstream is asked again, until the model stops calling hosted tools. Every round is an ordinary `send` of a Chat body without markers, so routing,
 * failover, conversion, capture, events and usage metering apply per round, and the usage is reported once, summed.
 *
 * The reply is a Chat reply with extensions the Responses converters read: `llmt_rounds` (`[{ message, hosted }]`, each round's assistant message and the
 * Responses items of the hosted calls it made), `llmt_incomplete` (the reason of a turn cut off at `maxRounds`: `max_tool_calls`) and, in a stream,
 * chunks with `llmt_items`. The executors are given an Anthropic-shaped view of each tool (`web_search_20250305`, `code_execution_20250522`,
 * `tool_search_tool_bm25_20251119`), so they need no change.
 *
 * A round that calls a function of the client together with hosted tools ends the turn after the hosted calls ran, as the Anthropic runner does. At
 * `maxRounds` the calls of the last round are run, their items are returned and the response is `incomplete` with `max_tool_calls`.
 * @module @cldmv/llm-translator/lib/hostedtools
 */
import { AsyncResource } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { combine, deliver } from "./usage.mjs";
import { emit } from "./events.mjs";
import { split, streamer } from "./citemarks.mjs";
import { fromAnthropic, toAnnotation } from "./citations.mjs";
import { itemId } from "./responses.mjs";
import { mergeDetail, reasoningOf } from "./thinking.mjs";
import { seal } from "./websearch.mjs";
import { resolve as route } from "./route.mjs";
import { RESPONSES } from "./protocol.mjs";
import { TOOLS, hostedMark, nativeMark, replayMark, refusal } from "./responses-tools.mjs";
import { TranslatorError } from "./errors.mjs";
import { ROUNDS, add, citable, execute, failed, find, normalize, render } from "./servertools.mjs";

/** The fields the request converter adds for a Responses upstream that takes hosted tools as they are. */
const NATIVE_FIELDS = ["llmt_native_choice", "llmt_native_include"];

const DONE = { data: "[DONE]" };

/** The `response.incomplete_details.reason` of a turn cut off at the round limit. (UNSURE: OpenAI documents only `max_output_tokens` and `content_filter`.) */
export const CUT_OFF = "max_tool_calls";

/**
 * The Anthropic-shaped view of a hosted tool, the form the executors know.
 * `web_search`: `filters.allowed_domains` and `user_location` carry over. `code_interpreter` is the Python tool (`code_execution_20250522`).
 * `tool_search` is the BM25 search (`tool_search_tool_bm25_20251119`).
 * @param {string} kind - `web_search`, `code_interpreter` or `tool_search`.
 * @param {any} [tool] - The Responses tool definition.
 * @returns {any} Anthropic tool.
 */
export function view(kind, tool = {}) {
	if (kind === "web_search") {
		const domains = tool.filters?.allowed_domains;
		const where = tool.user_location;
		return {
			type: "web_search_20250305",
			name: "web_search",
			...(Array.isArray(domains) && domains.length > 0 ? { allowed_domains: domains } : {}),
			...(where !== null && typeof where === "object"
				? {
						user_location: {
							type: "approximate",
							...Object.fromEntries(
								["city", "region", "country", "timezone"].filter((key) => typeof where[key] === "string").map((key) => [key, where[key]])
							)
						}
					}
				: {})
		};
	}
	if (kind === "code_interpreter") return { type: "code_execution_20250522", name: "code_interpreter" };
	return { type: "tool_search_tool_bm25_20251119", name: "tool_search" };
}

/**
 * The text a call's arguments parse to, as the executors take it: an object, or `{ _raw_arguments }` when the text is not a JSON object.
 * @param {unknown} json - `function.arguments`.
 * @returns {any} Input object.
 */
function inputOf(json) {
	const text = typeof json === "string" ? json : "";
	try {
		const value = JSON.parse(text === "" ? "{}" : text);
		if (value !== null && typeof value === "object" && !Array.isArray(value)) return value;
	} catch {
		// Falls through to the raw form.
	}
	return { _raw_arguments: text };
}

/**
 * The result content a replayed hosted item stands for, in the shape of the executors' own results (so their `read` renders it).
 * @param {string} kind - Tool kind.
 * @param {any} item - The item the client replayed (`web_search_call`, `code_interpreter_call` or `tool_search_output`).
 * @returns {any} Result content.
 */
function contentOf(kind, item) {
	const bad = item?.status === "failed";
	if (kind === "web_search") {
		if (bad) return { type: "web_search_tool_result_error", error_code: "unavailable" };
		const sources = Array.isArray(item?.action?.sources) ? item.action.sources : [];
		return sources
			.filter((source) => typeof source?.url === "string")
			.map((source) => ({
				type: "web_search_result",
				url: source.url,
				title: source.url,
				encrypted_content: seal(undefined),
				page_age: null
			}));
	}
	if (kind === "code_interpreter") {
		if (bad) return { type: "code_execution_tool_result_error", error_code: "unavailable" };
		const logs = (Array.isArray(item?.outputs) ? item.outputs : [])
			.filter((output) => output?.type === "logs" && typeof output.logs === "string")
			.map((output) => output.logs)
			.join("\n");
		return { type: "code_execution_result", stdout: logs, stderr: "", return_code: 0, content: [] };
	}
	if (bad) return { type: "tool_search_tool_result_error", error_code: "unavailable" };
	const names = (Array.isArray(item?.tools) ? item.tools : [])
		.map((tool) => tool?.name ?? tool?.function?.name)
		.filter((name) => typeof name === "string");
	return { type: "tool_search_tool_search_result", tool_references: names.map((name) => ({ type: "tool_reference", tool_name: name })) };
}

/**
 * Whether the request has hosted tools the runner takes over (or hosted calls to replay), and if so the plan to run it. A tool whose executor is
 * not configured is refused: the model cannot be offered a tool nothing could run.
 * @param {any} c - Captured translator parts (`capture`).
 * @param {any} body - Chat body of a Responses request (markers from the request converter).
 * @param {any} options - The `send` options (`serverTools`).
 * @returns {{executors: any[], maxRounds: number, tools: Map<string, {tool: any, executor: any, member?: any}>, hosted: Map<any, any[]>, loaded: Set<string> | null} | null} The plan, or null for the normal path.
 * @throws {TranslatorError} `unsupported_tool`, status 400, `param` the tool's path, for a hosted tool with no executor in `serverTools`.
 */
export function wants(c, body, options) {
	if (!body || typeof body !== "object" || Array.isArray(body)) return null;
	const marked = Array.isArray(body.tools) ? body.tools.filter(hostedMark) : [];
	const replays = Array.isArray(body.messages) ? body.messages.filter(replayMark) : [];
	if (marked.length === 0 && replays.length === 0 && !(Array.isArray(body.messages) && body.messages.some(nativeMark))) return null;
	// An upstream on the Responses API set to `hostedTools: "native"` gets the tools and items as they are, so the runner steps aside.
	if (nativeRoute(c, body, options)) return null;
	refuse(body, false);
	const own = normalize(options.serverTools);
	const global = c.config.serverTools;
	const executors = [...own.executors, ...global.executors];
	/** @type {Map<string, {tool: any, executor: any, member?: any}>} */
	const tools = new Map();
	/** @type {Map<any, any[]>} */
	const hosted = new Map();
	for (const tool of marked) {
		const { kind, at, tool: original } = tool.llmt_hosted;
		const row = TOOLS.find((entry) => entry.kind === kind);
		const shown = view(kind, original);
		const executor = find(executors, shown.type);
		if (executor === undefined) {
			throw refusal(
				at,
				`the ${original?.type ?? kind} tool needs an executor for ${row?.executor ?? kind} in serverTools, and none is configured (see docs/settings.md)`
			);
		}
		const members = typeof executor.members === "function" ? executor.members(shown) : [];
		const entries = members.length > 0 ? members.map((member) => ({ tool: shown, executor, member })) : [{ tool: shown, executor }];
		for (const entry of entries) tools.set(entry.member?.name ?? shown.name, entry);
		hosted.set(tool, entries);
	}
	const searching = [...tools.values()].some((entry) => entry.executor.deferred === true);
	const loaded = new Set();
	for (const message of replays) {
		if (message.llmt_hosted.kind === "tool_search") {
			for (const name of namesOf(contentOf("tool_search", message.llmt_hosted.item))) loaded.add(name);
		}
	}
	return { executors, maxRounds: own.maxRounds ?? global.maxRounds ?? ROUNDS, tools, hosted, loaded: searching ? loaded : null };
}

/**
 * Whether the request goes to an upstream that takes hosted tools as they are: the Responses protocol with `hostedTools: "native"`.
 * @param {any} c - Captured translator parts (`capture`).
 * @param {any} body - Chat body of a Responses request.
 * @param {any} options - The `send` options (`wire`).
 * @returns {boolean} True for a native route.
 */
function nativeRoute(c, body, options) {
	const picked = route(c, body, { wire: options.wire });
	return picked.protocol === RESPONSES && c.settings(picked.endpoint, picked.protocol).hostedTools === "native";
}

/**
 * Refuse what cannot be sent to the upstream the request goes to: a tool or an input item only a Responses upstream with `hostedTools: "native"` can
 * take (`all: false`, used where the emulation runner takes over), or any hosted tool or item at all (`all: true`, used for an upstream that does not
 * speak the Responses API, which a request reaches when `api: "auto"` falls back to Chat Completions).
 * @param {any} body - Chat body of a Responses request.
 * @param {boolean} all - Refuse the emulated hosted tools too.
 * @returns {void}
 * @throws {TranslatorError} `unsupported_tool` (`param` the tool's path) or `unsupported_content` (`param` the item's path).
 */
export function refuse(body, all) {
	for (const tool of Array.isArray(body?.tools) ? body.tools : []) {
		if (!hostedMark(tool) || (!all && tool.llmt_hosted.native !== true)) continue;
		const { kind, at, tool: original } = tool.llmt_hosted;
		const row = TOOLS.find((entry) => entry.kind === kind);
		throw refusal(
			at,
			`unsupported tool type ${JSON.stringify(original.type)}: ${row?.note ?? "the translator does not know it"} It can only go to an upstream on the Responses API (api: "responses") with the hostedTools setting "native".`
		);
	}
	for (const message of Array.isArray(body?.messages) ? body.messages : []) {
		const item = nativeMark(message)
			? message.llmt_native
			: replayMark(message) && all
				? { item: message.llmt_hosted.item, at: undefined }
				: null;
		if (item === null) continue;
		const at = item.at ?? "input";
		throw new TranslatorError(
			`${at}: unsupported input item type ${JSON.stringify(item.item?.type ?? null)}: it can only go to an upstream on the Responses API (api: "responses") with the hostedTools setting "native".`,
			{ code: "unsupported_content", param: at }
		);
	}
}

/**
 * The tool names a tool search result names.
 * @param {any} content - The result content.
 * @returns {string[]} Names.
 */
function namesOf(content) {
	return (content?.tool_references ?? []).map((reference) => reference?.tool_name).filter((name) => typeof name === "string");
}

/**
 * A message without the replayed item its tool calls carry for a Responses upstream.
 * @param {any} message - Chat message.
 * @returns {any} The message, or a copy without `llmt_item` on its tool calls.
 */
function bare(message) {
	if (!Array.isArray(message?.tool_calls) || !message.tool_calls.some((call) => call?.llmt_item !== undefined)) return message;
	return { ...message, tool_calls: message.tool_calls.map(({ llmt_item: _, ...call }) => call) };
}

/**
 * The messages the upstream gets: the hosted calls the client replayed become the results their executors read, and the markers go. Also the
 * citations those results make citable, numbered in order, which `[[cite:N]]` markers of the new answer may name.
 * @param {any[]} messages - The Chat messages of the request.
 * @param {any} plan - Plan from {@link wants}.
 * @returns {{messages: any[], sources: any[]}} The messages and the citations of the history.
 */
function past(messages, plan) {
	let seen = 0;
	const sources = [];
	const out = messages.map((message) => {
		if (!replayMark(message)) return bare(message);
		const { kind, item } = message.llmt_hosted;
		const executor = find(plan.executors, view(kind).type);
		const content = contentOf(kind, item);
		const offset = seen;
		const cited = citable(executor, content);
		seen += cited.length;
		sources.push(...cited.map((entry) => executor.cite(entry)));
		const { llmt_hosted: _, ...rest } = message;
		return { ...rest, content: render(executor, content, offset) };
	});
	return { messages: out, sources };
}

/**
 * The Chat tools the upstream gets: the marked tools as function tools with the executor's schema and description, deferred functions only once a
 * search has named them, and no markers.
 * @param {any[]} tools - The request's Chat tools.
 * @param {any} plan - Plan from {@link wants}.
 * @returns {any[]} Chat tools.
 */
function offered(tools, plan) {
	return tools.flatMap((tool) => {
		const entries = plan.hosted.get(tool);
		if (entries === undefined) {
			const { llmt_deferred: deferred, ...rest } = tool;
			if (deferred === true && !plan.loaded?.has(rest.function?.name)) return [];
			return [rest];
		}
		return entries.map(({ executor, member, tool: shown }) => {
			const description =
				member?.description ?? (typeof executor.description === "function" ? executor.description(shown) : executor.description);
			return {
				type: "function",
				function: {
					name: member?.name ?? shown.name,
					...(typeof description === "string" ? { description } : {}),
					parameters: member?.schema ?? executor.schema(shown)
				}
			};
		});
	});
}

/**
 * The request the upstream gets for one round.
 * @param {any} body - Chat body of the Responses request.
 * @param {any} plan - Plan from {@link wants}.
 * @param {any[]} history - The request's messages with the replayed hosted calls rendered.
 * @param {any[]} extra - Messages appended after the request's (the rounds run so far).
 * @returns {any} Chat body without markers.
 */
export function rewrite(body, plan, history, extra = []) {
	const { tools: _, ...rest } = body;
	for (const name of NATIVE_FIELDS) delete rest[name];
	const tools = offered(body.tools ?? [], plan);
	const gone = tools.length === 0 ? ["tool_choice", "parallel_tool_calls"] : [];
	const out = { ...rest, ...(tools.length > 0 ? { tools } : {}), messages: [...history, ...extra] };
	for (const name of gone) delete out[name];
	return out;
}

/**
 * A copy of a body with the markers removed and the hosted tools left as the plain functions they were offered as, for a caller that does not run
 * them (a token count).
 * @param {any} body - Chat body of a Responses request.
 * @returns {any} Body without markers.
 */
export function strip(body) {
	if (!body || typeof body !== "object" || !Array.isArray(body.tools) || !Array.isArray(body.messages)) return body;
	const marked = (message) => replayMark(message) || nativeMark(message) || bare(message) !== message;
	if (!body.tools.some((tool) => hostedMark(tool) || tool?.llmt_deferred !== undefined) && !body.messages.some(marked)) return body;
	const rest = { ...body };
	for (const name of NATIVE_FIELDS) delete rest[name];
	return {
		...rest,
		tools: body.tools.map(({ llmt_hosted: _, llmt_deferred: ___deferred, ...tool }) => tool),
		messages: body.messages
			.filter((message) => !nativeMark(message))
			.map((message) => {
				if (!replayMark(message)) return bare(message);
				const { llmt_hosted: _, ...kept } = message;
				return kept;
			})
	};
}

/**
 * The Responses items of one executed hosted call.
 * UNSURE (OpenAI item fields): `web_search_call` is `{ id, type, status, action: { type: "search", query, sources: [{ type: "url", url }] } }`;
 * `code_interpreter_call` is `{ id, type, status, code, container_id, outputs: [{ type: "logs", logs }] }`; `tool_search_call` is
 * `{ id, type, call_id, status, execution, arguments }` and `tool_search_output` `{ id, type, call_id, status, execution, tools }` with the loaded tool
 * definitions. Sources and outputs are always included (there is no `include` handling).
 * @param {string} kind - Tool kind.
 * @param {{id: string, input: any}} call - The call: its Chat id and parsed input.
 * @param {{result: any}} done - Result of `execute`.
 * @param {any} state - Request-wide state (`fallbackContainer`, `functions`).
 * @returns {any[]} Output items.
 */
function itemsOf(kind, call, done, state) {
	const content = done.result.content;
	const bad = failed(content);
	const status = bad ? "failed" : "completed";
	if (kind === "web_search") {
		const hits = !bad && Array.isArray(content) ? content : [];
		return [
			{
				id: itemId("ws"),
				type: "web_search_call",
				status,
				action: { type: "search", query: String(call.input.query ?? ""), sources: hits.map((hit) => ({ type: "url", url: hit.url })) }
			}
		];
	}
	if (kind === "code_interpreter") {
		const logs = bad ? "" : [content?.stdout, content?.stderr].filter((text) => typeof text === "string" && text !== "").join("\n");
		return [
			{
				id: itemId("ci"),
				type: "code_interpreter_call",
				status,
				code: String(call.input.code ?? ""),
				container_id: state.container?.id ?? state.fallbackContainer,
				outputs: bad ? [] : [{ type: "logs", logs }]
			}
		];
	}
	const tools = bad
		? []
		: namesOf(content)
				.map((name) => state.functions.get(name))
				.filter((tool) => tool !== undefined);
	return [
		{ id: itemId("tsc"), type: "tool_search_call", call_id: call.id, status, execution: "server", arguments: call.input },
		{ id: itemId("tso"), type: "tool_search_output", call_id: call.id, status, execution: "server", tools }
	];
}

/**
 * The hosted calls of a message, in the order the model made them.
 * @param {any} message - Chat assistant message (or the calls of a stream round).
 * @param {any} plan - Plan from {@link wants}.
 * @returns {{id: string, name: string, input: any}[]} The calls of tools the runner serves.
 */
function hostedCalls(message, plan) {
	return (message.tool_calls ?? [])
		.filter((call) => call?.type !== "custom" && plan.tools.has(call?.function?.name))
		.map((call) => ({ id: call.id, name: call.function.name, input: inputOf(call.function.arguments) }));
}

/**
 * A message's text with its `[[cite:N]]` markers turned into `url_citation` annotations.
 * @param {any} message - Chat assistant message.
 * @param {any[]} known - The citations the markers may name.
 * @returns {any} The message, with the markers removed and the annotations added; unchanged when it has no markers.
 */
function annotated(message, known) {
	const text = message.content;
	if (known.length === 0 || typeof text !== "string" || !text.includes("[[")) return message;
	const parts = split(text, known);
	if (parts.every((part) => part.citations.length === 0)) return message;
	let content = "";
	const annotations = [];
	for (const part of parts) {
		for (const citation of part.citations) {
			const neutral = fromAnthropic(citation);
			if (neutral !== null)
				annotations.push(toAnnotation({ ...neutral, span: { start: content.length, end: content.length + part.text.length } }));
		}
		content += part.text;
	}
	return { ...message, content, annotations: [...(message.annotations ?? []), ...annotations] };
}

/**
 * The tool messages that carry a round's hosted results to the next upstream call.
 * @param {{call: any, done: any}[]} ran - The executed calls.
 * @param {any} plan - Plan from {@link wants}.
 * @param {Map<any, number>} offsets - Citable items before each result's content, by the content.
 * @returns {any[]} Tool messages.
 */
function results(ran, plan, offsets) {
	return ran.map(({ call, done }) => ({
		role: "tool",
		tool_call_id: call.id,
		content: render(plan.tools.get(call.name).executor, done.result.content, offsets.get(done.result.content))
	}));
}

/**
 * Answer a Responses-front request by running its hosted tools. See the module comment. Every round is a full `send` of the rewritten body; the reply
 * carries a non-enumerable `usage` promise of the combined report like any `send` reply (for a stream it settles when the stream ends or is closed early).
 * @param {object} spec - `{ body, plan, options, send, warn, c }`.
 * @param {any} spec.body - Chat body of the Responses request.
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
	const earlier = past(body.messages, plan);
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
		return send(rewrite(body, plan, earlier.messages, extra), { ...options, serverTools: undefined, onUsage: report });
	};
	const plain = (body.tools ?? []).filter((tool) => !hostedMark(tool) && tool?.function !== undefined);
	const state = {
		used: new Map(),
		counts: {},
		signal: options.signal,
		context: {
			model: body.model,
			metadata: body.metadata,
			messages: body.messages,
			tools: plain.map((tool) => ({
				name: tool.function.name,
				...(typeof tool.function.description === "string" ? { description: tool.function.description } : {}),
				input_schema: tool.function.parameters ?? { type: "object" },
				...(tool.llmt_deferred === true ? { defer_loading: true } : {})
			})),
			results: [],
			container: undefined
		},
		files: c.files(),
		announce: (spec) => emit(c, { ...spec, log: options.log }),
		sources: earlier.sources,
		offsets: new Map(),
		fallbackContainer: `cntr_${randomBytes(12).toString("hex")}`,
		functions: new Map(
			plain.map((tool) => [
				tool.function.name,
				{
					type: "function",
					name: tool.function.name,
					...(typeof tool.function.description === "string" ? { description: tool.function.description } : {}),
					parameters: tool.function.parameters ?? { type: "object", properties: {} },
					...(tool.llmt_deferred === true ? { defer_loading: true } : {})
				}
			])
		)
	};
	const stream = body.stream === true;
	let handed = false;
	try {
		const first = await ask([]);
		if (stream ? first.stream === undefined : first.status !== 200) return attach(first);
		if (plan.tools.size === 0) {
			// Only replayed history to render: the one round is the answer as it came.
			if (stream) handed = true;
			return attach(stream ? { ...first, stream: relay(first.stream, finish) } : first);
		}
		if (!stream) return attach(await collected({ first, ask, plan, state }));
		handed = true;
		return attach({ status: 200, headers: first.headers, stream: streaming({ first, ask, plan, state, finish }) });
	} finally {
		// A stream settles the report itself, when it ends.
		if (!handed) finish();
	}
}

/**
 * A stream passed on as it is, settling the usage report when it ends or is closed.
 * @param {AsyncIterable<any>} source - The upstream's stream.
 * @param {() => void} finish - Settles the report.
 * @returns {AsyncGenerator<any>} The same chunks.
 */
async function* relay(source, finish) {
	try {
		yield* source;
	} finally {
		finish();
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
	let sum;
	const extra = [];
	const done = [];
	for (;;) {
		const completion = reply.body;
		const choice = completion.choices[0];
		const message = choice.message;
		sum = add(sum, completion.usage);
		// Markers in this round's text can only name the sources the model had read when it wrote it.
		const known = state.sources.slice();
		const calls = hostedCalls(message, plan);
		const ran = [];
		for (const call of calls) {
			const result = await execute(call, plan, state);
			ran.push({ call, done: result, items: itemsOf(kindOf(plan, call), call, result, state) });
		}
		const client = (message.tool_calls ?? []).filter((call) => !calls.some((entry) => entry.id === call.id));
		const { tool_calls: _, ...bare } = message;
		done.push({
			message: annotated(client.length > 0 ? { ...bare, tool_calls: client } : bare, known),
			hosted: ran.flatMap((entry) => entry.items)
		});
		const pause = calls.length > 0 && client.length === 0 && rounds >= plan.maxRounds;
		if (calls.length === 0 || client.length > 0 || pause) {
			if (pause) state.announce(paused(rounds));
			return {
				status: 200,
				headers: first.headers,
				body: {
					...completion,
					id: first.body.id,
					choices: [{ ...choice, message: done.at(-1).message }],
					...(sum === undefined ? {} : { usage: sum }),
					llmt_rounds: done,
					...(pause ? { llmt_incomplete: CUT_OFF } : {})
				}
			};
		}
		extra.push(message, ...results(ran, plan, state.offsets));
		reply = await ask(extra);
		rounds++;
		if (reply.status !== 200) return reply;
	}
}

/**
 * The tool kind of a call: `web_search`, `code_interpreter` or `tool_search`.
 * @param {any} plan - Plan from {@link wants}.
 * @param {{name: string}} call - The call.
 * @returns {string} Kind.
 */
function kindOf(plan, call) {
	const type = plan.tools.get(call.name).tool.type;
	return type.startsWith("web_search") ? "web_search" : type.startsWith("code_execution") ? "code_interpreter" : "tool_search";
}

/**
 * The event that records a turn cut off at the round limit.
 * @param {number} rounds - Upstream calls made.
 * @returns {any} Event spec.
 */
function paused(rounds) {
	return {
		type: "servertool",
		kind: "max_tool_calls",
		level: "warn",
		message: `Stopped after ${rounds} upstream calls (maxRounds); the response is incomplete`
	};
}

/**
 * The text and annotations of the operations a citation marker reader gave.
 * @param {({text: string} | {mark: any})[]} ops - Operations in order.
 * @param {{offset: number, start: number, had: boolean, last: {start: number, end: number} | null}} at - Position state of the round's text.
 * @returns {{text: string, annotations: any[]}} Text to send and the annotations that apply to text up to it.
 */
function woven(ops, at) {
	let text = "";
	const annotations = [];
	for (const op of ops) {
		if ("text" in op) {
			text += op.text;
			at.offset += op.text.length;
			if (op.text.trim() !== "") at.had = true;
			continue;
		}
		// A marker cites the text since the last marker; adjacent markers cite the same span; one with no text before it is dropped.
		let span = at.last;
		if (at.had) {
			span = { start: at.start, end: at.offset };
			at.last = span;
			at.start = at.offset;
			at.had = false;
		}
		const neutral = span === null ? null : fromAnthropic(op.mark);
		if (neutral !== null) annotations.push(toAnnotation({ ...neutral, span }));
	}
	return { text, annotations };
}

/**
 * The streaming loop: forwards each round's chunks with the hosted calls held back, runs them when the round ends, sends their items, and starts the
 * next round. The finish reason and usage of every round are held back; the stream ends with one finish chunk, the summed usage and `[DONE]`.
 * @param {any} spec - `{ first, ask, plan, state, finish }`.
 * @returns {AsyncGenerator<{event?: string, data: any}>} Chunks.
 */
async function* streaming({ first, ask, plan, state, finish }) {
	let reply = first;
	let rounds = 1;
	let sum;
	let base = {};
	const extra = [];
	let iterator;
	// What ends the stream, sent after the loop so that nothing follows the last chunk (a consumer may stop reading at `[DONE]`).
	let tail;
	try {
		rounds: for (;;) {
			iterator = reply.stream[Symbol.asyncIterator]();
			/** @type {Map<number, {id: string, name: string, json: string[]}>} */
			const held = new Map();
			// The client's own calls wait for the round to end too, so they follow the hosted items the way they do in a JSON reply.
			const waiting = [];
			const known = state.sources.slice();
			const reader = known.length > 0 ? streamer(known) : null;
			const at = { offset: 0, start: 0, had: false, last: null };
			const said = { content: "", reasoning: "", details: [] };
			let reason = null;
			let client = false;
			for (let step = await iterator.next(); !step.done; step = await iterator.next()) {
				const frame = step.value;
				let data = frame.data;
				// The sentinel is not passed on; the loop goes on to the end of the round's stream so its usage report settles.
				if (data === "[DONE]") continue;
				if (data?.error) {
					tail = [frame, DONE];
					break rounds;
				}
				if (typeof data?.id === "string" && base.id === undefined)
					base = { id: data.id, object: data.object, created: data.created, model: data.model };
				if (data?.usage) {
					sum = add(sum, data.usage);
					const { usage: _, ...rest } = data;
					if (!(rest.choices?.length > 0)) continue;
					data = rest;
				}
				const choice = data?.choices?.[0];
				if (choice === undefined) {
					yield { ...frame, data };
					continue;
				}
				if (choice.finish_reason) reason = choice.finish_reason;
				const delta = { ...choice.delta };
				if (typeof delta.content === "string") said.content += delta.content;
				said.reasoning += reasoningOf(delta);
				for (const fragment of delta.reasoning_details ?? []) mergeDetail(said.details, fragment);
				if (Array.isArray(delta.tool_calls)) {
					for (const call of delta.tool_calls) {
						const key = call.index ?? 0;
						const name = call.function?.name;
						if (call.type !== "custom" && (held.has(key) || (typeof name === "string" && plan.tools.has(name)))) {
							const entry = held.get(key) ?? { id: "", name: "", json: [] };
							held.set(key, entry);
							if (typeof call.id === "string" && call.id !== "") entry.id = call.id;
							if (typeof name === "string" && name !== "") entry.name = name;
							if (typeof call.function?.arguments === "string") entry.json.push(call.function.arguments);
						} else {
							client = true;
							waiting.push(call);
						}
					}
					delete delta.tool_calls;
				}
				if (reader !== null && typeof delta.content === "string" && delta.content !== "") {
					const out = woven(reader.feed(delta.content), at);
					delta.content = out.text;
					if (out.annotations.length > 0) delta.annotations = out.annotations;
				}
				if (Object.keys(delta).length > 0) yield { ...frame, data: { ...data, choices: [{ ...choice, delta, finish_reason: null }] } };
			}
			iterator = undefined;
			// A tail that began like a marker and never became one goes out as text (the reader never ends on a complete marker).
			const rest = reader === null ? "" : woven(reader.end(), at).text;
			if (rest !== "") yield { data: { ...base, choices: [{ index: 0, delta: { content: rest }, finish_reason: null }] } };
			const calls = [...held.values()].map((entry) => ({ id: entry.id, name: entry.name, input: inputOf(entry.json.join("")) }));
			const ran = [];
			for (const call of calls) {
				const result = await execute(call, plan, state);
				const items = itemsOf(kindOf(plan, call), call, result, state);
				ran.push({ call, done: result });
				yield { data: { ...base, choices: [], llmt_items: items } };
			}
			if (waiting.length > 0) yield { data: { ...base, choices: [{ index: 0, delta: { tool_calls: waiting }, finish_reason: null }] } };
			const pause = calls.length > 0 && !client && rounds >= plan.maxRounds;
			if (calls.length === 0 || client || pause) {
				if (pause) state.announce(paused(rounds));
				// A round that sent no finish reason leaves it null, and the Responses converter fails the response as cut short.
				tail = [
					{ data: { ...base, choices: [{ index: 0, delta: {}, finish_reason: reason }], ...(pause ? { llmt_incomplete: CUT_OFF } : {}) } },
					...(sum === undefined ? [] : [{ data: { ...base, choices: [], usage: sum } }]),
					DONE
				];
				break rounds;
			}
			extra.push(
				{
					role: "assistant",
					content: said.content === "" ? null : said.content,
					...(said.reasoning === "" ? {} : { reasoning_content: said.reasoning }),
					...(said.details.length > 0 ? { reasoning_details: said.details } : {}),
					tool_calls: calls.map((call) => ({
						id: call.id,
						type: "function",
						function: { name: call.name, arguments: JSON.stringify(call.input) }
					}))
				},
				...results(ran, plan, state.offsets)
			);
			reply = await ask(extra);
			rounds++;
			if (reply.stream === undefined) {
				tail = [{ data: reply.body }, DONE];
				break rounds;
			}
		}
		finish();
		yield* tail;
	} finally {
		// A stream closed early cancels the round in flight so its usage report settles.
		await iterator?.return();
		finish();
	}
}

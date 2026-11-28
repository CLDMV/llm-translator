/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/responses-state.mjs
 *	@Date: 2026-11-23T12:00:00-08:00 (1795550400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-23T12:00:00-08:00 (1795550400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The stateful half of the Responses API: the response store a translator holds, the items kept in it (ids, pagination), resolving
 * `previous_response_id` and `conversation` into the history a request is answered against, and saving the response afterwards.
 * @module @cldmv/llm-translator/lib/responses-state
 */
import { TranslatorError } from "./errors.mjs";
import { cancel } from "./background.mjs";
import { itemId } from "./responses.mjs";
import { create } from "./responses-store.mjs";
import { apply, lookup } from "./prompts.mjs";
import { resolve as settingsOf } from "./settings.mjs";

/** Statuses of a response that is still being produced (background mode). */
export const LIVE = Object.freeze(["queued", "in_progress"]);

/** The item types a stored history can hold, with the id prefix of each. */
const PREFIXES = Object.freeze({
	message: "msg",
	function_call: "fc",
	function_call_output: "fco",
	reasoning: "rs",
	custom_tool_call: "ctc",
	custom_tool_call_output: "ctco",
	shell_call: "sc",
	shell_call_output: "sco",
	apply_patch_call: "apc",
	apply_patch_call_output: "apco",
	web_search_call: "ws",
	code_interpreter_call: "ci",
	tool_search_call: "tsc",
	tool_search_output: "tso",
	compaction: "cmp"
});

/**
 * A client error.
 * @param {number} status - HTTP status.
 * @param {string} message - Message.
 * @param {string} code - Error code.
 * @param {string | null} [param] - Offending parameter.
 * @returns {TranslatorError} Error.
 */
export function problem(status, message, code, param = null) {
	return new TranslatorError(message, { code, status, param, type: status === 404 ? "not_found_error" : "invalid_request_error" });
}

/**
 * The translator's response store and its `responses` setting, made on first use (the global setting; an upstream's own `settings` do not apply to a
 * store the fronts share).
 * @param {any} config - Translator config.
 * @param {any} state - Translator state (holds the store).
 * @returns {{ store: ReturnType<typeof create>, options: import("./responses-store.mjs").ResponsesSetting } | null} The store, or null when `responses` is null (stateful features are off).
 */
export function stateOf(config, state) {
	if (state.responses === undefined) {
		const options = settingsOf(config.settings).responses;
		state.responses = options === null ? null : { store: create(options), options };
	}
	return state.responses;
}

/**
 * The stateful Responses API's store, or the error that says it is off.
 * @param {any} config - Translator config.
 * @param {any} state - Translator state.
 * @returns {{ store: ReturnType<typeof create>, options: import("./responses-store.mjs").ResponsesSetting }} The store and its setting.
 * @throws {TranslatorError} 404 `responses_disabled` when `responses` is null.
 */
export function required(config, state) {
	const held = stateOf(config, state);
	if (held === null) {
		throw new TranslatorError("Stored responses are off (the responses setting is null)", { code: "responses_disabled", status: 404 });
	}
	return held;
}

/**
 * The background jobs of a translator (running ones, and finished ones whose event stream can still be read), by response id.
 * @param {any} state - Translator state.
 * @returns {Map<string, any>} Jobs.
 */
export function jobsOf(state) {
	state.jobs ??= new Map();
	return state.jobs;
}

/**
 * The error for an unknown response.
 * @param {string} id - The id asked for.
 * @returns {TranslatorError} 404 `response_not_found`.
 */
export function missing(id) {
	return problem(404, `Response with id '${id}' not found.`, "response_not_found", "response_id");
}

/**
 * The response object of a stored record. A background response that is still queued or in progress, but has no job left to finish it (the process
 * restarted with a directory store), is reported as failed.
 * @param {any} record - Stored record.
 * @param {any} state - Translator state.
 * @returns {any} Response object.
 */
export function viewOf(record, state) {
	const { response } = record;
	if (!LIVE.includes(response.status) || jobsOf(state).get(response.id)?.done === false) return response;
	return {
		...response,
		status: "failed",
		error: { code: "server_error", message: "The translator restarted before the response finished" }
	};
}

/**
 * Input items with ids: a string is one user message; a message with string content gets its content parts; an item without an id gets one; messages
 * and function calls get `status: "completed"`. The input is not changed.
 * @param {string | any[]} input - The `input` of a request, or the `items` of a conversation call.
 * @param {string} [at] - Path of the list, for errors.
 * @returns {any[]} Items.
 * @throws {TranslatorError} 400 `invalid_request` for an item that is not an object, `unsupported_content` for a type a history cannot hold.
 */
export function itemsOf(input, at = "input") {
	const list = typeof input === "string" ? [{ type: "message", role: "user", content: input }] : input;
	return list.map((item, position) => {
		const where = `${at}[${position}]`;
		if (item === null || typeof item !== "object" || Array.isArray(item))
			throw problem(400, `${where}: an item must be an object`, "invalid_request", where);
		const type = item.type ?? (item.role === undefined ? undefined : "message");
		if (!Object.hasOwn(PREFIXES, type)) {
			throw problem(400, `${where}: unsupported item type ${JSON.stringify(type ?? null)}`, "unsupported_content", where);
		}
		const out = { ...item, type, id: typeof item.id === "string" && item.id !== "" ? item.id : itemId(PREFIXES[type]) };
		if (type !== "reasoning" && type !== "compaction") out.status ??= "completed";
		if (type === "message" && typeof item.content === "string") {
			out.content =
				item.role === "assistant"
					? [{ type: "output_text", text: item.content, annotations: [] }]
					: [{ type: "input_text", text: item.content }];
		}
		return out;
	});
}

/**
 * One page of a list of items kept oldest first.
 * @param {any[]} items - Items, oldest first.
 * @param {{ limit?: any, order?: string, after?: string, before?: string }} [query] - Query parameters as the client sent them.
 * @param {"asc" | "desc"} [fallback] - Order when the query has none.
 * @returns {{ object: "list", data: any[], first_id: string | null, last_id: string | null, has_more: boolean }} The list object.
 * @throws {TranslatorError} 400 for a bad `limit` or `order`, 404 `item_not_found` when `after` or `before` names no item.
 */
export function listOf(items, query = {}, fallback = "desc") {
	const order = query.order ?? fallback;
	if (order !== "asc" && order !== "desc") throw problem(400, "order must be asc or desc", "invalid_order", "order");
	const limit = Number(query.limit ?? 20);
	if (!Number.isInteger(limit) || limit < 1 || limit > 100)
		throw problem(400, "limit must be a whole number from 1 to 100", "invalid_limit", "limit");
	const ordered = order === "asc" ? items : [...items].reverse();
	const position = (id, param) => {
		const found = ordered.findIndex((item) => item.id === id);
		if (found === -1) throw problem(404, `Item with id '${id}' not found.`, "item_not_found", param);
		return found;
	};
	const from = query.after === undefined ? 0 : position(query.after, "after") + 1;
	const to = query.before === undefined ? undefined : position(query.before, "before");
	const window = ordered.slice(from, to);
	const data = window.slice(0, limit);
	return { object: "list", data, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null, has_more: window.length > limit };
}

/**
 * The items a conversation holds after more are added to the end.
 * @param {any[]} held - Items it holds, oldest first.
 * @param {any[]} items - Items to add, with ids.
 * @param {number} max - Most items a conversation holds (`maxItems`).
 * @param {boolean} trim - True to drop the oldest items that do not fit (a response's items must be kept); false to refuse items that do not fit or that it already holds.
 * @returns {any[]} The items.
 * @throws {TranslatorError} 400 `conversation_full` when `trim` is false and the items do not fit, 400 `item_exists` for an id the conversation holds (or the batch repeats).
 */
export function fit(held, items, max, trim) {
	if (!trim) {
		const ids = new Set(held.map((item) => item.id));
		for (const item of items) {
			if (ids.has(item.id)) throw problem(400, `Item with id '${item.id}' is already in the conversation.`, "item_exists", "items");
			ids.add(item.id);
		}
	}
	const all = [...held, ...items];
	if (all.length <= max) return all;
	if (!trim) throw problem(400, `A conversation holds at most ${max} items`, "conversation_full", "items");
	return all.slice(all.length - max);
}

/**
 * Add items to the end of a conversation.
 * @param {ReturnType<typeof create>} store - The store.
 * @param {number} max - Most items a conversation holds (`maxItems`).
 * @param {string} id - Conversation id.
 * @param {any[]} items - Items with ids.
 * @param {boolean} trim - See {@link fit}.
 * @returns {Promise<any | null>} The conversation record, or null when there is none.
 * @throws {TranslatorError} As {@link fit}.
 */
export async function append(store, max, id, items, trim) {
	return store.update("conversation", id, (record) =>
		record === null ? undefined : { ...record, items: fit(record.items, items, max, trim) }
	);
}

/**
 * Replace the `item_reference` items of an input with copies of the stored items they name: input and output items of stored responses, and items of
 * conversations. A copy has no id (it gets a new one when the response is kept), so the same item is not twice in one conversation.
 * @param {ReturnType<typeof create>} store - The store.
 * @param {any} input - The request's `input`.
 * @returns {Promise<any>} The input; the same value when it holds no reference.
 * @throws {TranslatorError} 400 `invalid_request` for a reference without an id, 400 `item_not_found` for an id nothing holds (both with param `input`).
 */
async function dereference(store, input) {
	const isReference = (item) => item !== null && typeof item === "object" && item.type === "item_reference";
	if (!Array.isArray(input) || !input.some(isReference)) return input;
	for (const item of input.filter(isReference)) {
		if (typeof item.id !== "string" || item.id === "")
			throw problem(400, "input: an item_reference needs the id of an item", "invalid_request", "input");
	}
	const wanted = new Set(input.filter(isReference).map((item) => item.id));
	const found = new Map();
	const keep = (items) => {
		for (const item of items) if (wanted.has(item.id) && !found.has(item.id)) found.set(item.id, item);
	};
	for (const record of await store.all("conversation")) keep(record.items);
	for (const record of await store.all("response")) keep([...record.input, ...record.response.output]);
	return input.map((item) => {
		if (!isReference(item)) return item;
		const hit = found.get(item.id);
		if (hit === undefined) throw problem(400, `Item with id '${item.id}' not found.`, "item_not_found", "input");
		const copy = { ...hit };
		delete copy.id;
		return copy;
	});
}

/**
 * Whether a flag of a request is true, treating null and absence as the default.
 * @param {any} body - Request body.
 * @param {string} name - Field name.
 * @param {boolean} fallback - Value when the field is absent or null.
 * @returns {boolean} The flag.
 * @throws {TranslatorError} 400 `invalid_request` for a value that is not a boolean.
 */
function flag(body, name, fallback) {
	const value = body[name] ?? fallback;
	if (typeof value !== "boolean") throw problem(400, `${name}: expected true or false`, "invalid_request", name);
	return value;
}

/**
 * Resolve the stateful parts of a Responses request. Without a store (the `responses` setting is null) nothing is resolved and the request converter
 * refuses the stateful fields as it always did. With one, `previous_response_id` and `conversation` become the history items to put before the
 * request's own input, and `store`, `background`, `previous_response_id` and `conversation` leave the body the converter sees.
 * @param {any} body - Client body.
 * @param {{ config: any, state: any }} context - Translator config and state.
 * @returns {Promise<null | { id: string, body: any, history: any[], input: any, store: boolean, background: boolean, previous: string | null, conversation: string | null, echo: any }>} The plan, or null for a stateless request.
 * @throws {TranslatorError} 400 for a malformed parameter, both `previous_response_id` and `conversation`, a previous response that is unknown or unfinished, `background` without `store`; 404 `conversation_not_found`.
 */
export async function plan(body, { config, state }) {
	const held = stateOf(config, state);
	if (held === null || body === null || typeof body !== "object" || Array.isArray(body)) return null;
	const previous = body.previous_response_id ?? null;
	if (previous !== null && typeof previous !== "string") {
		throw problem(400, "previous_response_id: expected a response id", "invalid_request", "previous_response_id");
	}
	const reference = body.conversation ?? null;
	const conversation = typeof reference === "object" && reference !== null ? reference.id : reference;
	if (conversation !== null && (typeof conversation !== "string" || conversation === "")) {
		throw problem(400, "conversation: expected a conversation id or an object with an id", "invalid_request", "conversation");
	}
	if (previous !== null && conversation !== null) {
		throw problem(
			400,
			"Mutually exclusive parameters: 'previous_response_id' and 'conversation'. Ensure you are only providing one of these parameters.",
			"mutually_exclusive_parameters",
			"conversation"
		);
	}
	const store = flag(body, "store", true);
	const background = flag(body, "background", false);
	if (background && !store) throw problem(400, "background: background mode needs store to be true", "invalid_request", "background");
	let history = [];
	if (previous !== null) {
		const record = await held.store.get("response", previous);
		if (record === null) {
			throw problem(400, `Previous response with id '${previous}' not found.`, "previous_response_not_found", "previous_response_id");
		}
		const { status } = viewOf(record, state);
		if (LIVE.includes(status)) {
			throw problem(
				400,
				`Previous response with id '${previous}' is still ${status}.`,
				"previous_response_in_progress",
				"previous_response_id"
			);
		}
		history = [...record.history, ...record.input, ...record.response.output];
	}
	if (conversation !== null) {
		const record = await held.store.get("conversation", conversation);
		if (record === null) throw problem(404, `Conversation with id '${conversation}' not found.`, "conversation_not_found", "conversation");
		history = record.items;
	}
	const rest = { ...body };
	for (const name of ["previous_response_id", "conversation", "store", "background", "prompt"]) delete rest[name];
	rest.input = await dereference(held.store, body.input);
	// A stored prompt goes ahead of the request: its instructions before the request's, its input items before the request's input.
	const chosen = body.prompt === undefined || body.prompt === null ? null : lookup(held.options.prompts, body.prompt);
	if (chosen !== null) {
		const filled = apply(chosen.prompt, chosen.variables);
		if (filled.instructions !== null) {
			rest.instructions = [filled.instructions, rest.instructions].filter((text) => typeof text === "string" && text !== "").join("\n\n");
		}
		const own = typeof rest.input === "string" ? [{ type: "message", role: "user", content: rest.input }] : rest.input;
		if (filled.items.length > 0 && (own === undefined || Array.isArray(own))) rest.input = [...filled.items, ...(own ?? [])];
	}
	return {
		id: itemId("resp"),
		body: rest,
		history,
		input: rest.input,
		store,
		background,
		previous,
		conversation,
		echo: {
			store,
			background,
			previous_response_id: previous,
			conversation: conversation === null ? null : { id: conversation },
			prompt: chosen === null ? null : { id: chosen.id, version: chosen.version, variables: chosen.variables }
		}
	};
}

/**
 * The request body to convert once the history is known: the body without the stateful fields, with the history items before the request's own
 * input items.
 * @param {NonNullable<Awaited<ReturnType<typeof plan>>>} made - The request's plan.
 * @returns {any} Body.
 */
export function joined(made) {
	const own = typeof made.input === "string" ? [{ type: "message", role: "user", content: made.input }] : made.input;
	return { ...made.body, input: [...made.history, ...own] };
}

/**
 * The record that keeps a response and what it was answered from.
 * @param {NonNullable<Awaited<ReturnType<typeof plan>>>} made - The request's plan.
 * @param {any} response - Response object.
 * @returns {any} Record.
 */
function recordOf(made, response) {
	return {
		id: response.id,
		response,
		input: itemsOf(made.input),
		// A conversation is its own history; a chain keeps the items it was answered after.
		history: made.conversation === null ? made.history : [],
		conversation: made.conversation,
		background: made.background
	};
}

/**
 * Keep a background response that was just accepted (`queued`), so it can be retrieved and cancelled while it runs.
 * @param {NonNullable<Awaited<ReturnType<typeof plan>>>} made - The request's plan.
 * @param {any} response - The queued response object.
 * @param {{ config: any, state: any }} context - Translator config and state.
 * @returns {Promise<void>} Resolves when kept.
 */
export async function begin(made, response, { config, state }) {
	await required(config, state).store.put("response", response.id, recordOf(made, response));
}

/**
 * Record the progress of a background response (`in_progress`), unless it was cancelled or deleted meanwhile.
 * @param {string} id - Response id.
 * @param {any} response - The response object in its new status.
 * @param {{ config: any, state: any }} context - Translator config and state.
 * @returns {Promise<void>} Resolves when kept.
 */
export async function progress(id, response, { config, state }) {
	await required(config, state).store.update("response", id, (current) =>
		current === null || current.response.status === "cancelled" ? undefined : { ...current, response }
	);
}

/**
 * Keep a response, and add its input and output items to its conversation. Nothing is kept for `store: false`. A background response replaces its
 * queued record, unless it was cancelled or deleted meanwhile (then the result is dropped). A conversation only takes the items of a response that
 * finished (`completed` or `incomplete`).
 * @param {NonNullable<Awaited<ReturnType<typeof plan>>>} made - The request's plan.
 * @param {any} response - The finished response object.
 * @param {{ config: any, state: any }} context - Translator config and state.
 * @returns {Promise<void>} Resolves when kept.
 */
export async function finish(made, response, { config, state }) {
	if (!made.store) return;
	const { store, options } = required(config, state);
	const record = recordOf(made, response);
	if (made.background) {
		const kept = await store.update("response", response.id, (current) =>
			current === null || current.response.status === "cancelled" ? undefined : record
		);
		if (kept?.response !== response) return;
	} else {
		await store.put("response", response.id, record);
	}
	if (made.conversation !== null && (response.status === "completed" || response.status === "incomplete")) {
		await append(store, options.maxItems, made.conversation, [...record.input, ...response.output], true);
	}
}

/**
 * Cancel a background response: its job is stopped (the upstream request is aborted) and the stored response gets the status `cancelled`. A response
 * that is not running any more (finished, failed, cancelled before, or left without a job by a restart) is returned as it is.
 * @param {ReturnType<typeof create>} store - The store.
 * @param {any} state - Translator state.
 * @param {string} id - Response id.
 * @returns {Promise<any>} Response object.
 * @throws {TranslatorError} 404 `response_not_found`, 400 `not_background` for a response that was not made with `background: true`.
 */
export async function halt(store, state, id) {
	const record = await store.get("response", id);
	if (record === null) throw missing(id);
	if (!record.background) throw problem(400, "Cannot cancel a synchronous response.", "not_background", "response_id");
	if (!LIVE.includes(viewOf(record, state).status)) return viewOf(record, state);
	// A response that is live has a job: without one it would have been reported as failed.
	const jobs = jobsOf(state);
	cancel(jobs, jobs.get(id));
	const kept = await store.update("response", id, (current) =>
		current !== null && LIVE.includes(current.response.status)
			? { ...current, response: { ...current.response, status: "cancelled" } }
			: undefined
	);
	// Finished in the meantime: what it is now stands. Deleted in the meantime: it was cancelled.
	return viewOf(kept ?? { ...record, response: { ...record.response, status: "cancelled" } }, state);
}

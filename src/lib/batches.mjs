/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/batches.mjs
 *	@Date: 2026-11-22T12:00:00-08:00 (1795464000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T12:00:00-08:00 (1795464000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The Batch APIs: the batch objects of both fronts, request validation, input file parsing, listing with pagination and the Message Batches
 * results file. The batch itself is one record in the batch store (see `lib/batchstore`); this module only renders and checks.
 * @module @cldmv/llm-translator/lib/batches
 */
import { TranslatorError } from "./errors.mjs";
import { TERMINAL } from "./batchstore.mjs";

/** The endpoints the OpenAI front runs a batch against. */
export const ENDPOINTS = Object.freeze(["/v1/chat/completions", "/v1/responses", "/v1/embeddings"]);

/** What a Message Batches `custom_id` looks like. */
export const CUSTOM_ID = /^[a-zA-Z0-9_-]{1,64}$/;

/** Most errors an input file's validation reports, as OpenAI reports a bounded list. */
const MAX_ERRORS = 100;

/**
 * Whether a value is a plain object (not null, not an array).
 * @param {any} value - Value.
 * @returns {boolean} True for an object.
 */
export function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * A client error.
 * @param {number} status - HTTP status.
 * @param {string} message - Message.
 * @param {string} code - Error code.
 * @param {string} [param] - Offending parameter.
 * @returns {TranslatorError} Error.
 */
export function problem(status, message, code, param) {
	const type = status === 404 ? "not_found_error" : "invalid_request_error";
	return new TranslatorError(message, { code, status, param, type });
}

/**
 * The error for an unknown batch, worded like the front's own.
 * @param {"anthropic" | "openai"} front - Client protocol.
 * @param {string} id - The id asked for.
 * @returns {TranslatorError} 404 `batch_not_found`.
 */
export function missing(front, id) {
	return problem(404, front === "openai" ? `No batch found with id '${id}'.` : `Batch \`${id}\` not found.`, "batch_not_found", "batch_id");
}

/**
 * The error for a Batch API that is turned off.
 * @returns {TranslatorError} 404 `batches_disabled`.
 */
export function disabled() {
	return new TranslatorError("The Batch APIs are off (the batches setting is null)", { code: "batches_disabled", status: 404 });
}

/**
 * Message Batches' `processing_status` of a batch state.
 * @param {string} state - The record's state (OpenAI's status names).
 * @returns {"in_progress" | "canceling" | "ended"} Status.
 */
function processingStatus(state) {
	if (state === "cancelling") return "canceling";
	return TERMINAL.includes(state) ? "ended" : "in_progress";
}

/**
 * Anthropic's message batch object.
 * @param {any} record - Stored batch.
 * @param {string} [base] - Origin the `results_url` is built on (`https://host`); without it the url is a path.
 * @returns {any} Message batch.
 */
export function anthropicBatch(record, base = "") {
	const iso = (stamp) => (stamp === null ? null : new Date(stamp).toISOString());
	const ended = TERMINAL.includes(record.state);
	return {
		id: record.id,
		type: "message_batch",
		processing_status: processingStatus(record.state),
		request_counts: {
			processing: record.counts.pending,
			succeeded: record.counts.succeeded,
			errored: record.counts.errored,
			canceled: record.counts.canceled,
			expired: record.counts.expired
		},
		ended_at: iso(record.at.ended),
		created_at: iso(record.created_at),
		expires_at: iso(record.expires_at),
		cancel_initiated_at: iso(record.at.cancelling),
		results_url: ended ? `${base}/v1/messages/batches/${record.id}/results` : null
	};
}

/**
 * OpenAI's batch object.
 * @param {any} record - Stored batch.
 * @returns {any} Batch.
 */
export function openaiBatch(record) {
	const seconds = (stamp) => (stamp === null ? null : Math.floor(stamp / 1000));
	const { counts } = record;
	const total = record.items.length;
	return {
		id: record.id,
		object: "batch",
		endpoint: record.endpoint,
		...(record.model === null ? {} : { model: record.model }),
		errors: record.errors === null ? null : { object: "list", data: record.errors },
		input_file_id: record.input_file_id,
		completion_window: "24h",
		status: record.state,
		output_file_id: record.output_file_id,
		error_file_id: record.error_file_id,
		created_at: seconds(record.created_at),
		in_progress_at: seconds(record.at.in_progress),
		expires_at: seconds(record.expires_at),
		finalizing_at: seconds(record.at.finalizing),
		completed_at: seconds(record.state === "completed" ? record.at.ended : null),
		failed_at: seconds(record.state === "failed" ? record.at.ended : null),
		expired_at: seconds(record.state === "expired" ? record.at.ended : null),
		cancelling_at: seconds(record.at.cancelling),
		cancelled_at: seconds(record.state === "cancelled" ? record.at.ended : null),
		request_counts: { total, completed: counts.succeeded, failed: total - counts.succeeded - counts.pending },
		usage: {
			input_tokens: record.usage.input,
			input_tokens_details: { cached_tokens: record.usage.cached },
			output_tokens: record.usage.output,
			output_tokens_details: { reasoning_tokens: 0 },
			total_tokens: record.usage.input + record.usage.output
		},
		metadata: record.metadata
	};
}

/**
 * A page size from a query value.
 * @param {any} value - The value, or undefined.
 * @param {number} max - Largest allowed.
 * @returns {number} Page size (20 when not given).
 * @throws {TranslatorError} 400 `invalid_limit`.
 */
function limitOf(value, max) {
	if (value === undefined) return 20;
	const limit = Number(value);
	if (!Number.isInteger(limit) || limit < 1 || limit > max)
		throw problem(400, `limit must be a whole number from 1 to ${max}`, "invalid_limit", "limit");
	return limit;
}

/**
 * Anthropic's batch list, newest first: `{ data, has_more, first_id, last_id }`, `limit` 1 to 1000 (default 20), `after_id` for older batches and
 * `before_id` for newer ones.
 * @param {any[]} records - Stored batches of the front, newest first.
 * @param {{ limit?: any, before_id?: string, after_id?: string }} query - Query parameters.
 * @param {string} [base] - Origin for the `results_url`s.
 * @returns {any} List.
 * @throws {TranslatorError} 400 for a bad `limit` or a cursor that names no batch.
 */
export function anthropicList(records, query, base) {
	const limit = limitOf(query.limit, 1000);
	let from = 0;
	let to = records.length;
	const cursor = (id, param) => {
		const index = records.findIndex((record) => record.id === id);
		if (index === -1) throw problem(400, `${param} does not name a batch`, "invalid_cursor", param);
		return index;
	};
	if (query.after_id !== undefined) from = cursor(query.after_id, "after_id") + 1;
	if (query.before_id !== undefined) {
		to = cursor(query.before_id, "before_id");
		from = Math.max(from, Math.max(0, to - limit));
	}
	const window = records.slice(from, to);
	const data = window.slice(0, limit).map((record) => anthropicBatch(record, base));
	return { data, has_more: window.length > limit, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null };
}

/**
 * OpenAI's batch list, newest first: `{ object: "list", data, first_id, last_id, has_more }`, `limit` 1 to 100 (default 20), `after` the id of the last
 * batch of the previous page.
 * @param {any[]} records - Stored batches of the front, newest first.
 * @param {{ limit?: any, after?: string }} query - Query parameters.
 * @returns {any} List.
 * @throws {TranslatorError} 400 for a bad `limit` or an `after` that names no batch.
 */
export function openaiList(records, query) {
	const limit = limitOf(query.limit, 100);
	let list = records;
	if (query.after !== undefined) {
		const index = list.findIndex((record) => record.id === query.after);
		if (index === -1) throw problem(400, "after does not name a batch", "invalid_cursor", "after");
		list = list.slice(index + 1);
	}
	const data = list.slice(0, limit).map(openaiBatch);
	return { object: "list", data, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null, has_more: list.length > limit };
}

/**
 * Check a Message Batches create body and make its items.
 * @param {any} body - `{ requests: [{ custom_id, params }] }`.
 * @param {number} max - Most requests one batch may hold (`maxRequests`).
 * @returns {{ custom_id: string, request: any, outcome: null, result: null }[]} Items.
 * @throws {TranslatorError} 400 `invalid_request` naming the offending field.
 */
export function anthropicItems(body, max) {
	const fail = (message, param) => problem(400, message, "invalid_request", param);
	if (!isObject(body) || !Array.isArray(body.requests)) throw fail("requests: Field required", "requests");
	if (body.requests.length < 1) throw fail("requests: List should have at least 1 item", "requests");
	if (body.requests.length > max) throw fail(`requests: List should have at most ${max} items`, "requests");
	const seen = new Set();
	return body.requests.map((entry, index) => {
		const at = `requests.${index}`;
		if (!isObject(entry)) throw fail(`${at}: Input should be a valid dictionary`, at);
		if (typeof entry.custom_id !== "string" || !CUSTOM_ID.test(entry.custom_id)) {
			throw fail(`${at}.custom_id: String should match pattern '${CUSTOM_ID.source}'`, `${at}.custom_id`);
		}
		if (seen.has(entry.custom_id)) throw fail(`${at}.custom_id: custom_id '${entry.custom_id}' is used more than once`, `${at}.custom_id`);
		seen.add(entry.custom_id);
		if (!isObject(entry.params)) throw fail(`${at}.params: Field required`, `${at}.params`);
		return { custom_id: entry.custom_id, request: entry.params, outcome: null, result: null };
	});
}

/**
 * The `metadata` of an OpenAI create body: up to 16 string pairs, keys up to 64 characters and values up to 512.
 * @param {any} value - The value.
 * @returns {Record<string, string> | null} Metadata, or null when none was given.
 * @throws {TranslatorError} 400 `invalid_value`.
 */
function metadataOf(value) {
	if (value === undefined || value === null) return null;
	const entries = isObject(value) ? Object.entries(value) : null;
	if (entries === null) throw problem(400, "metadata must be an object of string pairs", "invalid_value", "metadata");
	if (entries.length > 16) throw problem(400, "metadata can have at most 16 keys", "invalid_value", "metadata");
	for (const [key, entry] of entries) {
		if (key.length > 64 || typeof entry !== "string" || entry.length > 512) {
			throw problem(400, "metadata keys are at most 64 characters and values are strings of at most 512", "invalid_value", "metadata");
		}
	}
	return value;
}

/**
 * Check an OpenAI create body.
 * @param {any} body - `{ input_file_id, endpoint, completion_window, metadata, output_expires_after }`.
 * @returns {{ input_file_id: string, endpoint: string, metadata: Record<string, string> | null, expiresIn: number | null }} The checked fields (`expiresIn`: seconds the output files live).
 * @throws {TranslatorError} 400 for a missing or invalid field.
 */
export function openaiParams(body) {
	if (!isObject(body)) throw problem(400, "The request body must be a JSON object", "invalid_request", "body");
	if (typeof body.input_file_id !== "string" || body.input_file_id === "") {
		throw problem(400, "Missing required parameter: 'input_file_id'.", "missing_required_parameter", "input_file_id");
	}
	if (!ENDPOINTS.includes(body.endpoint)) {
		throw problem(
			400,
			`Invalid value: ${JSON.stringify(body.endpoint)}. Supported values are: ${ENDPOINTS.map((entry) => `'${entry}'`).join(", ")}.`,
			"invalid_value",
			"endpoint"
		);
	}
	if (body.completion_window !== "24h") {
		throw problem(
			400,
			`Invalid value: ${JSON.stringify(body.completion_window)}. Supported values are: '24h'.`,
			"invalid_value",
			"completion_window"
		);
	}
	const metadata = metadataOf(body.metadata);
	let expiresIn = null;
	if (body.output_expires_after !== undefined) {
		const after = body.output_expires_after;
		if (
			!isObject(after) ||
			after.anchor !== "created_at" ||
			!Number.isInteger(after.seconds) ||
			after.seconds < 3600 ||
			after.seconds > 2592000
		) {
			throw problem(
				400,
				"output_expires_after must be { anchor: 'created_at', seconds } with seconds from 3600 to 2592000",
				"invalid_value",
				"output_expires_after"
			);
		}
		expiresIn = after.seconds;
	}
	return { input_file_id: body.input_file_id, endpoint: body.endpoint, metadata, expiresIn };
}

/**
 * Read a batch input file: JSON lines of `{ custom_id, method: "POST", url, body }`. Every line is checked and the problems are listed as OpenAI lists them
 * (`code`, `message`, `line`, `param`), at most 100; blank lines are skipped. Nothing runs when a line is wrong.
 * @param {string} text - The file's text.
 * @param {string} endpoint - The batch's endpoint, which every line's `url` must be.
 * @param {number} max - Most requests one batch may hold (`maxRequests`).
 * @returns {{ items: { custom_id: string, request: { url: string, body: any }, outcome: null, result: null }[], errors: any[] }} The requests, and the problems (empty when the file is fine).
 */
export function parseInput(text, endpoint, max) {
	const items = [];
	const errors = [];
	const seen = new Set();
	const report = (code, message, line, param) => {
		if (errors.length < MAX_ERRORS) errors.push({ code, message, line, param });
	};
	const lines = text.split("\n");
	lines.forEach((raw, index) => {
		const line = index + 1;
		if (raw.trim() === "") return;
		let entry;
		try {
			entry = JSON.parse(raw);
		} catch {
			entry = null;
		}
		if (!isObject(entry)) return report("invalid_json_line", "This line is not parseable as valid JSON.", line, null);
		if (typeof entry.custom_id !== "string" || entry.custom_id === "")
			return report("invalid_request", "Missing required parameter: 'custom_id'.", line, "custom_id");
		if (seen.has(entry.custom_id)) return report("duplicate_custom_id", `Duplicate custom_id: '${entry.custom_id}'.`, line, "custom_id");
		seen.add(entry.custom_id);
		if (entry.method !== "POST") return report("invalid_method", "Invalid method: only POST is supported.", line, "method");
		if (entry.url !== endpoint)
			return report("invalid_url", "The URL provided for this request does not match the batch endpoint.", line, "url");
		if (!isObject(entry.body)) return report("invalid_request", "Missing required parameter: 'body'.", line, "body");
		if (entry.body.stream === true) return report("invalid_request", "Streaming is not supported in batch requests.", line, "body.stream");
		items.push({ custom_id: entry.custom_id, request: { url: entry.url, body: entry.body }, outcome: null, result: null });
	});
	if (errors.length === 0 && items.length === 0) report("empty_file", "The input file is empty.", null, null);
	if (errors.length === 0 && items.length > max) {
		errors.push({
			code: "too_many_tasks",
			message: `The file has ${items.length} requests; a batch holds at most ${max}.`,
			line: null,
			param: null
		});
	}
	return { items, errors };
}

/**
 * The results of an ended message batch as JSON lines, in request order.
 * @param {any} record - Stored batch.
 * @returns {string} One `{ custom_id, result }` object per line.
 */
export function resultsOf(record) {
	return record.items.map((item) => `${JSON.stringify({ custom_id: item.custom_id, result: item.result })}\n`).join("");
}

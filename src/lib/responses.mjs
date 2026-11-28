/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/responses.mjs
 *	@Date: 2026-11-17T12:00:00-08:00 (1794945600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-17T12:00:00-08:00 (1794945600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Shapes shared by the Responses API converters: ids, the reasoning carrier, usage, status and the response envelope.
 * @module @cldmv/llm-translator/lib/responses
 */
import { randomBytes } from "node:crypto";

/** Marks an `encrypted_content` value written by this translator. */
const CARRY = "llmt-rs1:";
/** Marks the `encrypted_content` of a `compaction` item written by this translator (the summary text). */
const SUMMARY = "llmt-cp1:";
/** The sentence a compaction summary is introduced with when it goes back to the model. */
export const COMPACTED = "Summary of the earlier conversation, which has been compacted:";
/** Most reasoning detail items and most decoded bytes read back from a client. */
const MAX_DETAILS = 64;
const MAX_BYTES = 1024 * 1024;

/** What the model is asked to write when a conversation is compacted (`POST /v1/responses/compact` and automatic compaction). */
export const COMPACT_PROMPT =
	"Write a summary of the conversation above that will replace its earlier turns. Keep the user's goals and instructions, the decisions made, the facts, names and identifiers later turns depend on, the work still to do, and the state of any tool use. Reply with the summary only.";

/**
 * A Responses style id: a short prefix (`resp`, `msg`, `fc`, `fco`, `rs`, `conv`, `ws`, `ci`, `cmp`, ...), an underscore and 24 hex digits.
 * @param {string} prefix - Id family.
 * @returns {string} The id.
 */
export function itemId(prefix) {
	return `${prefix}_${randomBytes(12).toString("hex")}`;
}

/**
 * Pack the `reasoning_details` of a reply into the `encrypted_content` of a reasoning item, so the client sends them back with the next turn.
 * @param {unknown} details - `reasoning_details` list.
 * @returns {string | undefined} The carrier string, or undefined when there is nothing to carry.
 */
export function pack(details) {
	if (!Array.isArray(details) || details.length === 0) return undefined;
	return CARRY + Buffer.from(JSON.stringify(details)).toString("base64url");
}

/**
 * Read back what {@link pack} wrote. Anything else (another producer's data, a malformed or oversized value) gives null.
 * @param {unknown} value - `encrypted_content` of a reasoning item the client sent.
 * @returns {object[] | null} The `reasoning_details` items, or null.
 */
export function unpack(value) {
	if (typeof value !== "string" || !value.startsWith(CARRY) || value.length > MAX_BYTES * 2) return null;
	try {
		const details = JSON.parse(Buffer.from(value.slice(CARRY.length), "base64url").toString("utf8"));
		const plain = (item) => item !== null && typeof item === "object" && !Array.isArray(item);
		return Array.isArray(details) && details.length <= MAX_DETAILS && details.every(plain) ? details : null;
	} catch {
		return null;
	}
}

/**
 * Pack the summary of a compaction into the `encrypted_content` of a `compaction` item. Like the reasoning carrier it is only base64: the
 * translator reads it back when the client sends the item with a later request.
 * @param {string} text - Summary text.
 * @returns {string} The carrier string.
 */
export function summarize(text) {
	return SUMMARY + Buffer.from(JSON.stringify({ summary: text })).toString("base64url");
}

/**
 * Read back what {@link summarize} wrote. Anything else (another producer's data, a malformed or oversized value) gives null.
 * @param {unknown} value - `encrypted_content` of a `compaction` item the client sent.
 * @returns {string | null} The summary text, or null.
 */
export function unsummarize(value) {
	if (typeof value !== "string" || !value.startsWith(SUMMARY) || value.length > MAX_BYTES * 2) return null;
	try {
		const { summary } = JSON.parse(Buffer.from(value.slice(SUMMARY.length), "base64url").toString("utf8"));
		return typeof summary === "string" && summary !== "" ? summary : null;
	} catch {
		return null;
	}
}

/**
 * Responses usage for a Chat Completions usage object.
 * @param {any} usage - Chat `usage` (may be absent).
 * @returns {{input_tokens: number, input_tokens_details: {cached_tokens: number}, output_tokens: number, output_tokens_details: {reasoning_tokens: number}, total_tokens: number} | null} Usage, or null when the upstream sent none.
 */
export function usageOf(usage) {
	if (usage === null || typeof usage !== "object") return null;
	const input = usage.prompt_tokens ?? 0;
	const output = usage.completion_tokens ?? 0;
	return {
		input_tokens: input,
		input_tokens_details: { cached_tokens: usage.prompt_tokens_details?.cached_tokens ?? 0 },
		output_tokens: output,
		output_tokens_details: { reasoning_tokens: usage.completion_tokens_details?.reasoning_tokens ?? 0 },
		total_tokens: usage.total_tokens ?? input + output
	};
}

/**
 * Status and `incomplete_details` for a Chat Completions `finish_reason`: a length stop and a content filter end the response early.
 * @param {string | null | undefined} finish - `finish_reason`.
 * @returns {{status: "completed"} | {status: "incomplete", incomplete_details: {reason: string}}} Terminal status.
 */
export function endOf(finish) {
	if (finish === "length" || finish === "model_length")
		return { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } };
	if (finish === "content_filter") return { status: "incomplete", incomplete_details: { reason: "content_filter" } };
	return { status: "completed" };
}

/**
 * The response object around a list of output items, echoing the request parameters the way the API does.
 * @param {any} state - State from the request converter (`model`, `echo`).
 * @param {{id: string, created: number, status: string, model?: string, output: any[], usage?: any, error?: any, incomplete_details?: any}} parts - Per-response parts.
 * @returns {any} Response object.
 */
export function envelope(state, parts) {
	return {
		id: parts.id,
		object: "response",
		created_at: parts.created,
		status: parts.status,
		error: parts.error ?? null,
		incomplete_details: parts.incomplete_details ?? null,
		...state.echo,
		model: parts.model ?? state.model,
		output: parts.output,
		usage: parts.usage ?? null
	};
}

/**
 * A failure's `{ code, message }` for a response in the `failed` status.
 * @param {any} error - Chat error object (`{ message, type, code }`) or anything else thrown.
 * @returns {{code: string, message: string}} Error as a response carries it.
 */
export function failureOf(error) {
	const code = typeof error?.code === "string" ? error.code : "server_error";
	return { code, message: String(error?.message ?? "Upstream stream failed") };
}

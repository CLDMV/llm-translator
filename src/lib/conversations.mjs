/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/conversations.mjs
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
 * @fileoverview Conversation objects of the Conversations API: validation of `metadata` and the object a client sees for a stored conversation.
 * @module @cldmv/llm-translator/lib/conversations
 */
import { problem } from "./responses-state.mjs";

/**
 * Check a `metadata` value: an object of at most 16 string values, keys up to 64 characters and values up to 512.
 * @param {any} value - Value from the client (undefined or null mean none).
 * @returns {Record<string, string>} The metadata.
 * @throws {TranslatorError} 400 `invalid_metadata`.
 */
export function metadataOf(value) {
	if (value === undefined || value === null) return {};
	const fail = (message) => problem(400, `metadata: ${message}`, "invalid_metadata", "metadata");
	if (typeof value !== "object" || Array.isArray(value)) throw fail("expected an object of string values");
	const entries = Object.entries(value);
	if (entries.length > 16) throw fail("at most 16 keys");
	for (const [key, text] of entries) {
		if (key.length > 64) throw fail("keys are at most 64 characters");
		if (typeof text !== "string" || text.length > 512) throw fail("values must be strings of at most 512 characters");
	}
	return { ...value };
}

/**
 * The conversation object of a stored record.
 * @param {any} record - Stored conversation.
 * @returns {{ id: string, object: "conversation", created_at: number, metadata: Record<string, string> }} Conversation object.
 */
export function publicOf(record) {
	return { id: record.id, object: "conversation", created_at: record.created_at, metadata: record.metadata };
}

/**
 * The error for an unknown conversation.
 * @param {string} id - The id asked for.
 * @returns {import("./errors.mjs").TranslatorError} 404 `conversation_not_found`.
 */
export function missing(id) {
	return problem(404, `Conversation with id '${id}' not found.`, "conversation_not_found", "conversation_id");
}

/**
 * The error for an unknown item of a conversation.
 * @param {string} id - The id asked for.
 * @returns {import("./errors.mjs").TranslatorError} 404 `item_not_found`.
 */
export function missingItem(id) {
	return problem(404, `Item with id '${id}' not found.`, "item_not_found", "item_id");
}

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /api/conversations/create.mjs
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
 * @fileoverview Conversations api: create a conversation.
 * @module @cldmv/llm-translator/conversations
 */
import { context } from "../../lib/runtime.mjs";
import { itemId } from "../../lib/responses.mjs";
import { metadataOf, publicOf } from "../../lib/conversations.mjs";
import { fit, itemsOf, problem, required } from "../../lib/responses-state.mjs";

/**
 * Create a conversation (`POST /v1/conversations`) with optional `metadata` and up to 20 initial `items` (messages, function calls and their outputs,
 * reasoning items). A response created with `conversation` reads its items as history and appends its own input and output.
 * @param {{ metadata?: any, items?: any[] | null } | null} [body] - The request body.
 * @returns {Promise<any>} Conversation object `{ id, object: "conversation", created_at, metadata }`.
 * @throws {TranslatorError} 404 `responses_disabled` when `responses` is null, 400 for bad `metadata`, `items` (not a list, more than 20, an unsupported type) or more items than `maxItems`.
 */
export async function create(body = {}) {
	const { store, options } = required(context.config, context.state);
	const given = body ?? {};
	if (given.items !== undefined && given.items !== null && !Array.isArray(given.items))
		throw problem(400, "items: expected a list of items", "invalid_request", "items");
	if ((given.items ?? []).length > 20) throw problem(400, "items: at most 20 items can be added at a time", "invalid_request", "items");
	const metadata = metadataOf(given.metadata);
	const items = fit([], itemsOf(given.items ?? [], "items"), options.maxItems, false);
	const record = { id: itemId("conv"), created_at: Math.floor(Date.now() / 1000), metadata, items };
	await store.put("conversation", record.id, record);
	return publicOf(record);
}

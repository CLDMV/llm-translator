/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /api/conversations/items/create.mjs
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
 * @fileoverview Conversations api: add items to a conversation.
 * @module @cldmv/llm-translator/conversations/items
 */
import { context } from "../../../lib/runtime.mjs";
import { missing } from "../../../lib/conversations.mjs";
import { append, itemsOf, problem, required } from "../../../lib/responses-state.mjs";

/**
 * Add 1 to 20 items to the end of a conversation (`POST /v1/conversations/{id}/items`).
 * @param {string} id - Conversation id.
 * @param {{ items: any[] }} body - The request body.
 * @returns {Promise<any>} List object of the items that were added, `{ object: "list", data, first_id, last_id, has_more }`.
 * @throws {TranslatorError} 404 `responses_disabled` when `responses` is null, 404 `conversation_not_found`, 400 for `items` that are not a list of 1 to 20, an unsupported type, an id the conversation holds, or more items than `maxItems`.
 */
export async function create(id, body) {
	const { store, options } = required(context.config, context.state);
	if (!Array.isArray(body?.items) || body.items.length < 1 || body.items.length > 20)
		throw problem(400, "items: expected a list of 1 to 20 items", "invalid_request", "items");
	const items = itemsOf(body.items, "items");
	if ((await append(store, options.maxItems, id, items, false)) === null) throw missing(id);
	return { object: "list", data: items, first_id: items[0].id, last_id: items.at(-1).id, has_more: false };
}

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /api/conversations/items/get.mjs
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
 * @fileoverview Conversations api: retrieve one item of a conversation.
 * @module @cldmv/llm-translator/conversations/items
 */
import { context } from "../../../lib/runtime.mjs";
import { missing, missingItem } from "../../../lib/conversations.mjs";
import { required } from "../../../lib/responses-state.mjs";

/**
 * One item of a conversation (`GET /v1/conversations/{id}/items/{item_id}`).
 * @param {string} id - Conversation id.
 * @param {string} itemId - Item id.
 * @returns {Promise<any>} The item.
 * @throws {TranslatorError} 404 `responses_disabled` when `responses` is null, 404 `conversation_not_found` or `item_not_found`.
 */
export async function get(id, itemId) {
	const { store } = required(context.config, context.state);
	const record = await store.get("conversation", id);
	if (record === null) throw missing(id);
	const item = record.items.find((entry) => entry.id === itemId);
	if (item === undefined) throw missingItem(itemId);
	return item;
}

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /api/conversations/items/remove.mjs
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
 * @fileoverview Conversations api: delete one item of a conversation.
 * @module @cldmv/llm-translator/conversations/items
 */
import { context } from "../../../lib/runtime.mjs";
import { missing, missingItem, publicOf } from "../../../lib/conversations.mjs";
import { required } from "../../../lib/responses-state.mjs";

/**
 * Delete one item of a conversation (`DELETE /v1/conversations/{id}/items/{item_id}`).
 * @param {string} id - Conversation id.
 * @param {string} itemId - Item id.
 * @returns {Promise<any>} The conversation object.
 * @throws {TranslatorError} 404 `responses_disabled` when `responses` is null, 404 `conversation_not_found` or `item_not_found`.
 */
export async function remove(id, itemId) {
	const { store } = required(context.config, context.state);
	let found = false;
	const record = await store.update("conversation", id, (current) => {
		if (current === null) return undefined;
		found = current.items.some((entry) => entry.id === itemId);
		return found ? { ...current, items: current.items.filter((entry) => entry.id !== itemId) } : undefined;
	});
	if (record === null) throw missing(id);
	if (!found) throw missingItem(itemId);
	return publicOf(record);
}

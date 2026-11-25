/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /api/conversations/remove.mjs
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
 * @fileoverview Conversations api: delete a conversation.
 * @module @cldmv/llm-translator/conversations
 */
import { context } from "../../lib/runtime.mjs";
import { missing } from "../../lib/conversations.mjs";
import { required } from "../../lib/responses-state.mjs";

/**
 * Delete a conversation and the items it holds (`DELETE /v1/conversations/{id}`).
 * @param {string} id - Conversation id.
 * @returns {Promise<{ id: string, object: "conversation.deleted", deleted: true }>} Confirmation.
 * @throws {TranslatorError} 404 `responses_disabled` when `responses` is null, 404 `conversation_not_found`.
 */
export async function remove(id) {
	const { store } = required(context.config, context.state);
	if (!(await store.remove("conversation", id))) throw missing(id);
	return { id, object: "conversation.deleted", deleted: true };
}

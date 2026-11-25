/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /api/conversations/get.mjs
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
 * @fileoverview Conversations api: retrieve a conversation.
 * @module @cldmv/llm-translator/conversations
 */
import { context } from "../../lib/runtime.mjs";
import { missing, publicOf } from "../../lib/conversations.mjs";
import { required } from "../../lib/responses-state.mjs";

/**
 * A stored conversation (`GET /v1/conversations/{id}`).
 * @param {string} id - Conversation id.
 * @returns {Promise<any>} Conversation object.
 * @throws {TranslatorError} 404 `responses_disabled` when `responses` is null, 404 `conversation_not_found`.
 */
export async function get(id) {
	const { store } = required(context.config, context.state);
	const record = await store.get("conversation", id);
	if (record === null) throw missing(id);
	return publicOf(record);
}

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /api/conversations/update.mjs
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
 * @fileoverview Conversations api: update a conversation's metadata.
 * @module @cldmv/llm-translator/conversations
 */
import { context } from "../../lib/runtime.mjs";
import { metadataOf, missing, publicOf } from "../../lib/conversations.mjs";
import { problem, required } from "../../lib/responses-state.mjs";

/**
 * Replace a conversation's `metadata` (`POST /v1/conversations/{id}`).
 * @param {string} id - Conversation id.
 * @param {{ metadata: any }} body - The request body; `metadata` is required.
 * @returns {Promise<any>} Conversation object.
 * @throws {TranslatorError} 404 `responses_disabled` when `responses` is null, 404 `conversation_not_found`, 400 for missing or bad `metadata`.
 */
export async function update(id, body) {
	const { store } = required(context.config, context.state);
	if (body?.metadata === undefined || body.metadata === null) throw problem(400, "metadata: Field required", "invalid_request", "metadata");
	const metadata = metadataOf(body.metadata);
	const record = await store.update("conversation", id, (current) => (current === null ? undefined : { ...current, metadata }));
	if (record === null) throw missing(id);
	return publicOf(record);
}

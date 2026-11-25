/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /api/responses/get.mjs
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
 * @fileoverview Responses api: retrieve a stored response.
 * @module @cldmv/llm-translator/responses
 */
import { context } from "../../lib/runtime.mjs";
import { missing, required, viewOf } from "../../lib/responses-state.mjs";

/**
 * A stored response (`GET /v1/responses/{id}`): the response object as it was returned, or for a background response still running its current
 * status (`queued` or `in_progress`). `include` is accepted and has no effect.
 * @param {string} id - Response id.
 * @returns {Promise<any>} Response object.
 * @throws {TranslatorError} 404 `responses_disabled` when `responses` is null, 404 `response_not_found` for an unknown, deleted, evicted or expired id (and for a response made with `store: false`).
 */
export async function get(id) {
	const { store } = required(context.config, context.state);
	const record = await store.get("response", id);
	if (record === null) throw missing(id);
	return viewOf(record, context.state);
}

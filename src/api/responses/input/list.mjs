/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /api/responses/input/list.mjs
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
 * @fileoverview Responses api: list the input items of a stored response.
 * @module @cldmv/llm-translator/responses/input
 */
import { context } from "../../../lib/runtime.mjs";
import { listOf, missing, required } from "../../../lib/responses-state.mjs";

/**
 * The input items of a stored response (`GET /v1/responses/{id}/input_items`), as the request sent them with ids added: a string input is one user
 * message with `input_text` content. Only the response's own input is listed, not the history it was answered against. Newest first unless `order` is
 * `asc`; `limit` is 1 to 100 (default 20); `after` and `before` take an item id. `include` is accepted and has no effect.
 * @param {string} id - Response id.
 * @param {{ limit?: any, order?: string, after?: string, before?: string }} [query] - Query parameters as the client sent them.
 * @returns {Promise<any>} List object `{ object: "list", data, first_id, last_id, has_more }`.
 * @throws {TranslatorError} 404 `responses_disabled` when `responses` is null, 404 `response_not_found` or `item_not_found`, 400 for a bad `limit` or `order`.
 */
export async function list(id, query = {}) {
	const { store } = required(context.config, context.state);
	const record = await store.get("response", id);
	if (record === null) throw missing(id);
	return listOf(record.input, query);
}

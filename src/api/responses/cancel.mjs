/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/responses/cancel.mjs
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
 * @fileoverview Responses api: cancel a background response.
 * @module @cldmv/llm-translator/responses
 */
import { context } from "../../lib/runtime.mjs";
import { halt, required } from "../../lib/responses-state.mjs";

/**
 * Cancel a background response (`POST /v1/responses/{id}/cancel`): the upstream request is aborted and the response is kept with the status
 * `cancelled` and no output. A response that already finished (or was cancelled before) is returned as it is.
 * @param {string} id - Response id.
 * @returns {Promise<any>} Response object.
 * @throws {TranslatorError} 404 `responses_disabled` when `responses` is null, 404 `response_not_found`, 400 `not_background` for a response that was not made with `background: true`.
 */
export async function cancel(id) {
	return halt(required(context.config, context.state).store, context.state, id);
}

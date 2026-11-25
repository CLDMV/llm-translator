/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /api/responses/remove.mjs
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
 * @fileoverview Responses api: delete a stored response.
 * @module @cldmv/llm-translator/responses
 */
import { context } from "../../lib/runtime.mjs";
import { cancel } from "../../lib/background.mjs";
import { jobsOf, missing, required } from "../../lib/responses-state.mjs";

/**
 * Delete a stored response (`DELETE /v1/responses/{id}`). A background response still running is cancelled first. A conversation keeps the items the
 * response added to it.
 * @param {string} id - Response id.
 * @returns {Promise<{ id: string, object: "response.deleted", deleted: true }>} Confirmation.
 * @throws {TranslatorError} 404 `responses_disabled` when `responses` is null, 404 `response_not_found`.
 */
export async function remove(id) {
	const { store } = required(context.config, context.state);
	const jobs = jobsOf(context.state);
	const job = jobs.get(id);
	if (job !== undefined && !job.done) cancel(jobs, job);
	if (!(await store.remove("response", id))) throw missing(id);
	jobs.delete(id);
	return { id, object: "response.deleted", deleted: true };
}

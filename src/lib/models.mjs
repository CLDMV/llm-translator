/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/models.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:02-07:00 (1792958342)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Fetches an upstream `/v1/models` listing.
 * @module @cldmv/llm-translator/lib/models
 */
import * as http from "./http.mjs";

/**
 * Fetch and normalize the models an upstream reports.
 * @param {any} context - `{ endpoint, transport, signal, timeout, auth, extraHeaders }`.
 * @returns {Promise<{id: string, created?: number, owned_by?: string, max_model_len?: number}[] | null>} Models, or null when the upstream did not answer with a model list.
 */
export async function fetchModels({ endpoint, transport, signal, timeout, auth, extraHeaders }) {
	const result = await http.json(transport, http.join(endpoint.url, "/v1/models"), {
		method: "GET",
		headers: http.headers(endpoint, auth, extraHeaders),
		signal,
		timeout
	});
	if (!result.ok || !Array.isArray(result.body?.data)) return null;
	return result.body.data.filter((entry) => entry && typeof entry.id === "string");
}

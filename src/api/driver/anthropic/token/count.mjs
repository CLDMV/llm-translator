/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/anthropic/token/count.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:58:59-07:00 (1792958339)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Anthropic driver: token counting through `POST /v1/messages/count_tokens`.
 * @module @cldmv/llm-translator/driver/anthropic
 */
import * as http from "../../../../lib/http.mjs";

/**
 * Count tokens with the Anthropic API.
 * @param {any} context - `{ endpoint, request, transport, signal, timeout }`.
 * @returns {Promise<number | null>} Token count, or null when the API did not answer.
 */
export async function count({ endpoint, request, transport, signal, timeout }) {
	const body = { ...request };
	delete body.stream;
	delete body.max_tokens;
	const result = await http.json(transport, http.join(endpoint.url, "/v1/messages/count_tokens"), {
		method: "POST",
		headers: { "content-type": "application/json", "anthropic-version": "2023-06-01", ...http.headers(endpoint, "x-api-key") },
		body,
		signal,
		timeout
	});
	return result.ok && typeof result.body?.input_tokens === "number" ? result.body.input_tokens : null;
}

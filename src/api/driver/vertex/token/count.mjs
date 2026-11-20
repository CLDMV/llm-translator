/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/vertex/token/count.mjs
 *	@Date: 2026-11-19T09:00:00-08:00 (1795107600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-19T09:00:00-08:00 (1795107600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Vertex AI driver: token counting through the `count-tokens` publisher method.
 * @module @cldmv/llm-translator/driver/vertex
 */
import * as http from "../../../../lib/http.mjs";
import { token } from "../../../../lib/google-auth.mjs";
import { route } from "../../../../lib/vertex.mjs";

const FIELDS = ["messages", "system", "tools", "tool_choice", "thinking", "mcp_servers", "context_management"];

/**
 * Count tokens with `POST .../publishers/anthropic/models/count-tokens:rawPredict`, which takes the model in the body. Any failure (a missing
 * project or credentials, a 404 from a region or project without the method, a network error) gives null, so the caller uses the estimate.
 * @param {any} context - `{ endpoint, request, transport, signal, timeout }`.
 * @returns {Promise<number | null>} Token count, or null when Vertex AI did not answer.
 */
export async function count({ endpoint, request, transport, signal, timeout }) {
	// count-tokens rejects fields it does not know (sampling settings, max_tokens, stream), so send only the ones it accepts.
	const body = { model: request.model };
	for (const field of FIELDS) if (request[field] !== undefined) body[field] = request[field];
	try {
		const access = await token({ settings: endpoint.vertex, apiKey: endpoint.apiKey, transport, timeout, signal });
		const result = await http.json(transport, http.join(endpoint.url, route("count", endpoint)), {
			method: "POST",
			headers: { "content-type": "application/json", ...endpoint.headers, authorization: `Bearer ${access}` },
			body,
			signal,
			timeout
		});
		return result.ok && typeof result.body?.input_tokens === "number" ? result.body.input_tokens : null;
	} catch {
		// A token or configuration failure would also fail the request itself and be reported there; the count falls back to the estimate.
		return null;
	}
}

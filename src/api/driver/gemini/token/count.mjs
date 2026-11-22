/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/gemini/token/count.mjs
 *	@Date: 2026-11-21T10:00:00-08:00 (1795284000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-21T10:00:00-08:00 (1795284000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Gemini driver: token counting through the `countTokens` method.
 * @module @cldmv/llm-translator/driver/gemini
 */
import * as http from "../../../../lib/http.mjs";
import { GEMINI } from "../../../../lib/protocol.mjs";
import { countBody } from "../../../../lib/gemini.mjs";

/**
 * Count tokens with `POST /v1beta/models/<model>:countTokens` for an upstream on the native API. The prompt is the `generateContent` body the
 * request would send. Any failure (an upstream on the OpenAI-compatible endpoint, a rejected key, a network error) gives null, so the caller uses the estimate.
 * @param {any} context - `{ endpoint, request, path, state, transport, signal, timeout }`; `path` is the path of the call the request would make.
 * @returns {Promise<number | null>} Token count, or null when Gemini did not answer.
 */
export async function count({ endpoint, request, path, state, transport, signal, timeout }) {
	if (state?.protocol !== GEMINI) return null;
	// The path of a native call is always `.../models/<model>:<method>` (the `path` leaf builds it, with the model's own colons encoded).
	const base = path.slice(0, path.indexOf(":"));
	const result = await http.json(transport, http.join(endpoint.url, `${base}:countTokens`), {
		method: "POST",
		headers: { "content-type": "application/json", ...endpoint.headers, ...(endpoint.apiKey ? { "x-goog-api-key": endpoint.apiKey } : {}) },
		body: countBody(request, decodeURIComponent(base.slice(base.indexOf("/models/") + "/models/".length))),
		signal,
		timeout
	});
	return result.ok && Number.isFinite(result.body?.totalTokens) ? result.body.totalTokens : null;
}

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/gemini/cache.mjs
 *	@Date: 2026-11-22T10:00:00-08:00 (1795370400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T10:00:00-08:00 (1795370400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Gemini driver: cached contents for a `cache_control` breakpoint.
 * @module @cldmv/llm-translator/driver/gemini
 */
import * as http from "../../../lib/http.mjs";
import { apply } from "../../../lib/gemini-cache.mjs";
import { modelPath, route } from "../../../lib/gemini.mjs";

/**
 * Make a request use a cached content of the Gemini API (`POST /v1beta/cachedContents`), or leave it whole when one cannot be made.
 * @param {any} context - `{ endpoint, model, cache, body, headers, transport, timeout, warn }`: the plan the converter made for the request's `cache_control` breakpoint, and the body and headers about to be sent.
 * @returns {Promise<any>} The body to send.
 */
export function cache({ endpoint, model, cache: plan, body, headers, transport, timeout, warn }) {
	return apply({
		cache: plan,
		body,
		endpoint,
		headers,
		transport,
		timeout,
		model,
		url: http.join(endpoint.url, route(endpoint, "cachedContents")),
		resource: modelPath(model),
		warn
	});
}

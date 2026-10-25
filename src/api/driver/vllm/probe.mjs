/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/vllm/probe.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:00-07:00 (1792958340)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview vLLM driver: probes whether the chat template accepts non-leading system messages.
 * @module @cldmv/llm-translator/driver/vllm
 */
import * as http from "../../../lib/http.mjs";

/**
 * Tokenize `[system, user, system, user]` through `POST /tokenize`. Success means the template tolerates inline system messages.
 * @param {any} context - `{ endpoint, transport, signal, timeout, facts }`.
 * @returns {Promise<{inlineSystem: "keep" | "user"}>} Probed settings.
 */
export async function probe({ endpoint, transport, signal, timeout, facts }) {
	const result = await http.json(transport, http.join(endpoint.url, "/tokenize"), {
		method: "POST",
		headers: { "content-type": "application/json", ...http.headers(endpoint) },
		body: {
			model: facts?.models?.[0],
			messages: [
				{ role: "system", content: "a" },
				{ role: "user", content: "b" },
				{ role: "system", content: "c" },
				{ role: "user", content: "d" }
			]
		},
		signal,
		timeout
	});
	return { inlineSystem: result.ok ? "keep" : "user" };
}

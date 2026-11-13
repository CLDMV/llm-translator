/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/mistral/request.mjs
 *	@Date: 2026-10-31T14:00:00-07:00 (1793480400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-31T14:00:00-07:00 (1793480400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Mistral driver: request normalizer (Chat Completions body).
 * @module @cldmv/llm-translator/driver/mistral
 */
import { noEmptyTools } from "../../../lib/normalize.mjs";

/**
 * Drop tool fields when there are no tools, send `seed` as `random_seed` and `tool_choice: "required"` as `"any"` (Mistral's spelling).
 * @param {any} body - Chat Completions request body.
 * @returns {any} Normalized body.
 */
export function request(body) {
	const out = { ...noEmptyTools(body) };
	if (out.seed !== undefined) {
		if (out.random_seed === undefined) out.random_seed = out.seed;
		delete out.seed;
	}
	if (out.tool_choice === "required") out.tool_choice = "any";
	return out;
}

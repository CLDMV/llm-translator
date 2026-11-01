/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/sglang/request.mjs
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
 * @fileoverview SGLang driver: request normalizer (Chat Completions body).
 * @module @cldmv/llm-translator/driver/sglang
 */
import { noEmptyTools } from "../../../lib/normalize.mjs";

/**
 * Drop tool fields when there are no tools, and ask for reasoning to be returned separately (`separate_reasoning: true`) when the server
 * was started with a `--reasoning-parser`. The client's own `separate_reasoning` always wins.
 * @param {any} body - Chat Completions request body.
 * @param {any} [ctx] - `{ endpoint }`.
 * @returns {any} Normalized body.
 */
export function request(body, ctx) {
	const out = noEmptyTools(body);
	if (ctx?.endpoint?.facts?.reasoningParser && out.separate_reasoning === undefined) return { ...out, separate_reasoning: true };
	return out;
}

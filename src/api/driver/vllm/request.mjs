/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/vllm/request.mjs
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
 * @fileoverview vLLM driver: request normalizer (Chat Completions body).
 * @module @cldmv/llm-translator/driver/vllm
 */
import { noEmptyTools } from "../../../lib/normalize.mjs";

const EFFORTS = new Set(["xhigh", "max"]);

/**
 * Drop tool fields vLLM rejects when no tools are present, and clamp `reasoning_effort` to what vLLM accepts
 * (`xhigh` and `max` become `high`) unless the `effortPassthrough` setting is on.
 * @param {any} body - Chat Completions request body.
 * @param {any} [ctx] - `{ settings }`.
 * @returns {any} Normalized body.
 */
export function request(body, ctx) {
	const out = noEmptyTools(body);
	if (EFFORTS.has(out.reasoning_effort) && ctx?.settings?.effortPassthrough !== true) return { ...out, reasoning_effort: "high" };
	return out;
}

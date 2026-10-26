/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/estimate.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:01-07:00 (1792958341)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Prompt size estimate for upstreams that cannot count tokens.
 * @module @cldmv/llm-translator/lib/estimate
 */

/**
 * Rough prompt size: one token per four characters of the serialized system prompt, messages and tools.
 * @param {any} body - Upstream request body.
 * @returns {number} Estimated tokens.
 */
export function estimate(body) {
	return Math.ceil(JSON.stringify([body.system, body.messages, body.tools]).length / 4);
}

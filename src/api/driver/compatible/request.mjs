/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/compatible/request.mjs
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
 * @fileoverview Generic OpenAI-compatible driver: request normalizer (Chat Completions body).
 * @module @cldmv/llm-translator/driver/compatible
 */
import { noEmptyTools } from "../../../lib/normalize.mjs";

/**
 * Drop tool fields servers reject when no tools are present.
 * @param {any} body - Chat Completions request body.
 * @returns {any} Normalized body.
 */
export function request(body) {
	return noEmptyTools(body);
}

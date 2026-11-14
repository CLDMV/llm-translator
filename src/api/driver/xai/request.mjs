/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/xai/request.mjs
 *	@Date: 2026-11-13T10:00:00-08:00 (1794592800)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-13T10:00:00-08:00 (1794592800)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview xAI driver: request normalizer (Chat Completions body).
 * @module @cldmv/llm-translator/driver/xai
 */
import { trim } from "../../../lib/presets.mjs";

/**
 * Drop tool fields when there are no tools, and the fields xAI rejects (each recorded in `state.dropped`).
 * @param {any} body - Chat Completions request body.
 * @param {any} [context] - `{ state }`.
 * @returns {any} Normalized body.
 */
export function request(body, context) {
	return trim("xai", body, context);
}

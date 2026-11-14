/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/groq/path.mjs
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
 * @fileoverview Groq driver: URL path of each call.
 * @module @cldmv/llm-translator/driver/groq
 */
import { route } from "../../../lib/presets.mjs";

/**
 * Put the calls under the provider's path root, unless the upstream URL already ends in it.
 * @param {"chat" | "embeddings" | "models"} kind - Which call.
 * @param {any} context - `{ endpoint }`.
 * @returns {string} Path starting with `/`.
 */
export function path(kind, { endpoint }) {
	return route("groq", kind, endpoint);
}

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/azure/path.mjs
 *	@Date: 2026-11-13T09:00:00-08:00 (1794589200)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-13T09:00:00-08:00 (1794589200)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Azure OpenAI driver: URL path of each call.
 * @module @cldmv/llm-translator/driver/azure
 */
import { route } from "../../../lib/azure.mjs";

/**
 * Build the path of a call from the upstream's `apiVersion` and `deployment` (see `lib/azure.mjs`).
 * @param {"chat" | "embeddings" | "models"} kind - Which call.
 * @param {any} context - `{ endpoint, model }`.
 * @returns {string} Path with the `api-version` query when the classic URLs are in use.
 */
export function path(kind, { endpoint, model }) {
	return route(kind, endpoint, model);
}

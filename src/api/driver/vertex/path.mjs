/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/vertex/path.mjs
 *	@Date: 2026-11-19T09:00:00-08:00 (1795107600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-19T09:00:00-08:00 (1795107600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Vertex AI driver: URL path of each call.
 * @module @cldmv/llm-translator/driver/vertex
 */
import { route } from "../../../lib/vertex.mjs";

/**
 * Build the `rawPredict` path (`streamRawPredict` when `stream` is true) from the upstream's project and region and the request's model.
 * @param {"messages" | "count"} kind - Which call.
 * @param {any} context - `{ endpoint, model, stream }`.
 * @returns {string} Path starting with `/v1/projects/`.
 */
export function path(kind, { endpoint, model, stream }) {
	return route(kind, endpoint, model, { stream });
}

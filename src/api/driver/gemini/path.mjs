/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/gemini/path.mjs
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
 * @fileoverview Gemini driver: URL path of each call.
 * @module @cldmv/llm-translator/driver/gemini
 */
import { route } from "../../../lib/presets.mjs";
import { GEMINI } from "../../../lib/protocol.mjs";
import { modelPath, route as nativeRoute } from "../../../lib/gemini.mjs";

/**
 * Put the calls under the provider's path root, unless the upstream URL already ends in it. A native call (`kind` `gemini`) is
 * `models/<model>:generateContent`, or `:streamGenerateContent?alt=sse` for a stream, under `/v1beta`.
 * @param {"chat" | "gemini" | "embeddings" | "models"} kind - Which call.
 * @param {any} context - `{ endpoint, model, protocol, stream }`.
 * @returns {string} Path starting with `/`.
 */
export function path(kind, { endpoint, model, protocol, stream }) {
	if (protocol === GEMINI)
		return nativeRoute(endpoint, `${modelPath(model)}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`);
	return route("gemini", /** @type {"chat"} */ (kind), endpoint);
}

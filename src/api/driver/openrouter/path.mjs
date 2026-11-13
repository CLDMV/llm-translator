/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/openrouter/path.mjs
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
 * @fileoverview OpenRouter driver: URL path of each call.
 * @module @cldmv/llm-translator/driver/openrouter
 */

/** Paths under the API root. */
const PATHS = { chat: "/v1/chat/completions", embeddings: "/v1/embeddings", models: "/v1/models" };

/**
 * Put the calls under `/api`, so the upstream can be given as `https://openrouter.ai` or `https://openrouter.ai/api` (a trailing `/v1` is removed
 * by the config).
 * @param {"chat" | "embeddings" | "models"} kind - Which call.
 * @param {any} context - `{ endpoint }`.
 * @returns {string} Path starting with `/`.
 */
export function path(kind, { endpoint }) {
	return (endpoint.url.endsWith("/api") ? "" : "/api") + PATHS[kind];
}

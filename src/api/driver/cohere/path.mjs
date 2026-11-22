/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/cohere/path.mjs
 *	@Date: 2026-11-21T10:00:00-08:00 (1795284000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-21T10:00:00-08:00 (1795284000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Cohere driver: URL path of each call.
 * @module @cldmv/llm-translator/driver/cohere
 */
import { COMPATIBILITY } from "../../../lib/cohere.mjs";

/** Paths of the calls under the Compatibility API's root. */
const COMPATIBLE = { chat: "/v1/chat/completions", embeddings: "/v1/embeddings", models: "/v1/models" };

/**
 * Build the path of a call. A chat request over `cohere.chat` is `/v2/chat`; the rest go through the Compatibility API (`/compatibility/v1/...`,
 * unless the upstream URL already ends in `/compatibility`), except the model list, which is Cohere's own `/v1/models`.
 * @param {"chat" | "embeddings" | "models"} kind - Which call.
 * @param {any} context - `{ endpoint, protocol }`.
 * @returns {string} Path starting with `/`.
 */
export function path(kind, { endpoint, protocol }) {
	if (kind === "chat" && protocol === "cohere.chat") return "/v2/chat";
	if (kind === "models") return COMPATIBLE.models;
	return (endpoint.url.endsWith(COMPATIBILITY) ? "" : COMPATIBILITY) + COMPATIBLE[kind];
}

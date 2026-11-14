/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/azure/request.mjs
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
 * @fileoverview Azure OpenAI driver: request normalizer (Chat Completions body).
 * @module @cldmv/llm-translator/driver/azure
 */
import { noEmptyTools } from "../../../lib/normalize.mjs";

/** First `api-version` that accepts `max_completion_tokens` (`2024-09-01-preview`). Older versions only know `max_tokens`. */
const MAX_COMPLETION_TOKENS_SINCE = "2024-09-01";

/**
 * Drop tool fields Azure rejects when no tools are present, and send `max_tokens` when the upstream pins an `api-version` older than the one
 * that introduced `max_completion_tokens`. Versions that are not dated (`preview`, `latest`) and the v1 API keep `max_completion_tokens`.
 * @param {any} body - Chat Completions request body.
 * @param {any} [context] - `{ endpoint }`.
 * @returns {any} Normalized body.
 */
export function request(body, context) {
	const out = noEmptyTools(body);
	const version = context?.endpoint?.apiVersion?.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
	if (version === undefined || version >= MAX_COMPLETION_TOKENS_SINCE || out.max_completion_tokens === undefined) return out;
	const { max_completion_tokens: limit, ...rest } = out;
	return { ...rest, max_tokens: limit };
}

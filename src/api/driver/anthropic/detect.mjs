/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/anthropic/detect.mjs
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
 * @fileoverview Anthropic driver: matches the api.anthropic.com host.
 * @module @cldmv/llm-translator/driver/anthropic
 */

/**
 * Match by host name, no network access. Other Anthropic-compatible servers are selected with `backend: "anthropic"`.
 * @param {any} context - `{ endpoint }`.
 * @returns {{host: string} | null} Facts, or null when the endpoint is not api.anthropic.com.
 */
export function detect({ endpoint }) {
	const host = URL.canParse(endpoint.url) ? new URL(endpoint.url).hostname : "";
	return host === "api.anthropic.com" ? { host } : null;
}

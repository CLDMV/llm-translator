/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/mistral/detect.mjs
 *	@Date: 2026-10-31T14:00:00-07:00 (1793480400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-31T14:00:00-07:00 (1793480400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Mistral driver: matches the api.mistral.ai host.
 * @module @cldmv/llm-translator/driver/mistral
 */

/**
 * Match by host name, no network access.
 * @param {any} context - `{ endpoint }`.
 * @returns {{host: string} | null} Facts, or null when the endpoint is not api.mistral.ai.
 */
export function detect({ endpoint }) {
	const host = URL.canParse(endpoint.url) ? new URL(endpoint.url).hostname : "";
	return host === "api.mistral.ai" ? { host } : null;
}

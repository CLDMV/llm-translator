/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/cohere/detect.mjs
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
 * @fileoverview Cohere driver: matches the host names api.cohere.com and api.cohere.ai.
 * @module @cldmv/llm-translator/driver/cohere
 */
import { HOSTS } from "../../../lib/cohere.mjs";

/**
 * Match by host name, no network access.
 * @param {any} context - `{ endpoint }`.
 * @returns {{host: string} | null} Facts, or null when the endpoint is not Cohere's.
 */
export function detect({ endpoint }) {
	const host = URL.canParse(endpoint.url) ? new URL(endpoint.url).hostname : "";
	return HOSTS.includes(host) ? { host } : null;
}

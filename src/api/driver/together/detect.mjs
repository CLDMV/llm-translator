/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/together/detect.mjs
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
 * @fileoverview Together AI driver: matches the host name api.together.ai, api.together.xyz and us-api.together.ai.
 * @module @cldmv/llm-translator/driver/together
 */
import { match } from "../../../lib/presets.mjs";

/**
 * Match by host name, no network access.
 * @param {any} context - `{ endpoint }`.
 * @returns {{host: string} | null} Facts, or null when the endpoint is not Together AI's.
 */
export function detect({ endpoint }) {
	return match("together", endpoint);
}

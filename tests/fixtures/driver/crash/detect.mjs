/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/fixtures/driver/crash/detect.mjs
 *	@Date: 2026-10-25T12:20:39-07:00 (1792956039)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:03-07:00 (1792958343)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @param {object} context - Detection context.
 * @returns {object | null} Facts for urls containing "crash.test".
 */
export function detect({ endpoint }) {
	return endpoint.url.includes("crash.test") ? {} : null;
}

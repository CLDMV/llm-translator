/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/fixtures/driver/hooks/response.mjs
 *	@Date: 2026-10-25T12:19:29-07:00 (1792955969)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:04-07:00 (1792958344)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @param {object} body - Upstream body.
 * @returns {Promise<object>} Normalized body.
 */
export async function response(body) {
	return { ...body, hookedResponse: true };
}

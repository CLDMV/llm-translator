/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/fixtures/driver/latecrash/detect.mjs
 *	@Date: 2026-10-25T22:46:04-07:00 (1792993564)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-26T15:39:06-07:00 (1793054346)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

export function detect({ endpoint }) {
	return endpoint.url.includes("latecrash.test") ? {} : null;
}

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/server/stop.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:01-07:00 (1792958341)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Server api: stop every server started through this translator.
 * @module @cldmv/llm-translator/server
 */
import { context } from "../../lib/runtime.mjs";

/**
 * Close all servers started with `server.start`.
 * @returns {Promise<void>} Resolves when every server has closed.
 */
export async function stop() {
	await Promise.all([...context.state.servers].map((server) => server.close()));
}

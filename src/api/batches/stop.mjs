/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/batches/stop.mjs
 *	@Date: 2026-11-22T12:00:00-08:00 (1795464000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T12:00:00-08:00 (1795464000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Batches api: stop the batches that are running.
 * @module @cldmv/llm-translator/batches
 */
import { context } from "../../lib/runtime.mjs";

/**
 * Stop every batch that is running (their requests are aborted and the batches end as cancelled) and wait until they have. `server.stop` calls it; a program
 * that uses the batch api without a server calls it before it shuts down. Does nothing when no batch was ever made or `batches` is null.
 * @returns {Promise<void>} Resolves when no batch is running.
 */
export async function stop() {
	await context.state.batches?.stop();
}

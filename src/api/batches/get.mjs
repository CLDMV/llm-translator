/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/batches/get.mjs
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
 * @fileoverview Batches api: retrieve one batch.
 * @module @cldmv/llm-translator/batches
 */
import { context, self } from "../../lib/runtime.mjs";
import { anthropicBatch, openaiBatch } from "../../lib/batches.mjs";
import { find, runnerOf } from "../../lib/batch-run.mjs";

/**
 * The batch object of a batch, in the client protocol's shape. A batch made through the other front is not found.
 * @param {string} id - Batch id.
 * @param {any} [options] - `{ front, base }`.
 * @returns {Promise<any>} Batch object.
 * @throws {TranslatorError} 404 `batches_disabled` when `batches` is null, 404 `batch_not_found` for an unknown or expired id.
 */
export async function get(id, options = {}) {
	const front = options.front ?? context.config.front;
	const runner = runnerOf(self, context);
	const record = await find(runner, id, front);
	return front === "openai" ? openaiBatch(record) : anthropicBatch(record, options.base);
}

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/batches/cancel.mjs
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
 * @fileoverview Batches api: cancel a batch.
 * @module @cldmv/llm-translator/batches
 */
import { context, self } from "../../lib/runtime.mjs";
import { TERMINAL } from "../../lib/batchstore.mjs";
import { anthropicBatch, openaiBatch, problem } from "../../lib/batches.mjs";
import { find, runnerOf } from "../../lib/batch-run.mjs";

/**
 * Cancel a batch that has not ended. It becomes `cancelling` (Message Batches: `canceling`) at once, its requests in flight are aborted and the ones that
 * did not run are ended as cancelled (a `canceled` result, or a `batch_cancelled` line in the error file), then the batch is `cancelled` (`ended`). The
 * requests that finished keep their results. Cancelling a batch that is already cancelling answers it as it is.
 * @param {string} id - Batch id.
 * @param {any} [options] - `{ front, base }`.
 * @returns {Promise<any>} Batch object.
 * @throws {TranslatorError} 404 `batches_disabled` / `batch_not_found`, 409 `batch_ended` (OpenAI) or 400 `batch_ended` (Anthropic) when the batch has ended.
 */
export async function cancel(id, options = {}) {
	const front = options.front ?? context.config.front;
	const runner = runnerOf(self, context);
	const record = await find(runner, id, front);
	if (TERMINAL.includes(record.state)) {
		throw front === "openai"
			? problem(409, `Cannot cancel a batch with status '${record.state}'.`, "batch_ended", "batch_id")
			: problem(400, `Batch \`${id}\` has already ended and cannot be canceled.`, "batch_ended", "batch_id");
	}
	if (record.state !== "cancelling") runner.cancel(record);
	return front === "openai" ? openaiBatch(record) : anthropicBatch(record, options.base);
}

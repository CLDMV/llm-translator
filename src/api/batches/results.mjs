/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/batches/results.mjs
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
 * @fileoverview Batches api: read the results of a message batch.
 * @module @cldmv/llm-translator/batches
 */
import { context, self } from "../../lib/runtime.mjs";
import { TERMINAL } from "../../lib/batchstore.mjs";
import { problem, resultsOf } from "../../lib/batches.mjs";
import { find, runnerOf } from "../../lib/batch-run.mjs";

/**
 * The results of a message batch that has ended, as JSON lines (`{ custom_id, result }`, `result.type` is `succeeded`, `errored`, `canceled` or `expired`),
 * in request order. OpenAI batches have no such endpoint: their results are the files `output_file_id` and `error_file_id` name.
 * @param {string} id - Batch id.
 * @param {any} [options] - `{ front }`.
 * @returns {Promise<string>} The JSON lines.
 * @throws {TranslatorError} 404 `batches_disabled` / `batch_not_found`, 400 `batch_in_progress` when the batch has not ended, 404 `no_results_endpoint` on the OpenAI front.
 */
export async function results(id, options = {}) {
	const front = options.front ?? context.config.front;
	const runner = runnerOf(self, context);
	const record = await find(runner, id, front);
	if (front !== "anthropic") {
		throw problem(404, "A batch's results are in the files output_file_id and error_file_id name", "no_results_endpoint", "batch_id");
	}
	if (!TERMINAL.includes(record.state)) {
		throw problem(
			400,
			`Batch \`${id}\` has not ended; its results are available once processing has ended.`,
			"batch_in_progress",
			"batch_id"
		);
	}
	return resultsOf(record);
}

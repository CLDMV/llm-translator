/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/batches/remove.mjs
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
 * @fileoverview Batches api: delete a batch.
 * @module @cldmv/llm-translator/batches
 */
import { context, self } from "../../lib/runtime.mjs";
import { TERMINAL } from "../../lib/batchstore.mjs";
import { problem } from "../../lib/batches.mjs";
import { find, runnerOf } from "../../lib/batch-run.mjs";

/**
 * Delete a batch that has ended (`DELETE /v1/messages/batches/{id}`) and answer with the front's confirmation: Anthropic `{ id, type: "message_batch_deleted" }`,
 * OpenAI `{ id, object: "batch", deleted: true }`. OpenAI has no such route; the leaf is there for code that uses the api directly.
 * @param {string} id - Batch id.
 * @param {any} [options] - `{ front }`.
 * @returns {Promise<any>} Confirmation.
 * @throws {TranslatorError} 404 `batches_disabled` / `batch_not_found`, 400 `batch_in_progress` when the batch has not ended.
 */
export async function remove(id, options = {}) {
	const front = options.front ?? context.config.front;
	const runner = runnerOf(self, context);
	const record = await find(runner, id, front);
	if (!TERMINAL.includes(record.state)) {
		throw problem(
			400,
			`Batch \`${id}\` is still processing; cancel it and wait until it has ended before deleting it.`,
			"batch_in_progress",
			"batch_id"
		);
	}
	await runner.store.remove(id);
	return front === "openai" ? { id, object: "batch", deleted: true } : { id, type: "message_batch_deleted" };
}

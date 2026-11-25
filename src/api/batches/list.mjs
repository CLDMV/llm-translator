/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/batches/list.mjs
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
 * @fileoverview Batches api: list batches.
 * @module @cldmv/llm-translator/batches
 */
import { context, self } from "../../lib/runtime.mjs";
import { anthropicList, openaiList } from "../../lib/batches.mjs";
import { runnerOf } from "../../lib/batch-run.mjs";

/**
 * List the batches made through the front, newest first, in the client protocol's list shape. Anthropic: `{ data, has_more, first_id, last_id }` with
 * `limit` (default 20, at most 1000), `before_id` and `after_id`. OpenAI: `{ object: "list", data, first_id, last_id, has_more }` with `limit` (default 20,
 * at most 100) and `after`.
 * @param {any} [query] - Query parameters as the client sent them.
 * @param {any} [options] - `{ front, base }`.
 * @returns {Promise<any>} List.
 * @throws {TranslatorError} 404 `batches_disabled` when `batches` is null; 400 for a bad parameter.
 */
export async function list(query = {}, options = {}) {
	const front = options.front ?? context.config.front;
	const runner = runnerOf(self, context);
	await runner.ready;
	const records = (await runner.store.list()).filter((record) => record.front === front);
	return front === "openai" ? openaiList(records, query) : anthropicList(records, query, options.base);
}

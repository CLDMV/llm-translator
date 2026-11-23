/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/files/list.mjs
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
 * @fileoverview Files api: list stored files.
 * @module @cldmv/llm-translator/files
 */
import { context } from "../../lib/runtime.mjs";
import { TranslatorError } from "../../lib/errors.mjs";
import { anthropicList, openaiList, storeOf } from "../../lib/files.mjs";

/**
 * List the stored files, newest first, in the client protocol's list shape. Anthropic: `{ data, next_page }` paged with `page` (or up to 100 `ids`), or with
 * `beta: true` `{ data, has_more, first_id, last_id }` paged with `before_id` and `after_id`; `limit` defaults to 20 (at most 1000). OpenAI:
 * `{ object: "list", data, first_id, last_id, has_more }` with `purpose`, `limit` (default and most 10000), `after` and `order`.
 * @param {any} [query] - Query parameters as the client sent them.
 * @param {any} [options] - `{ front, beta }`.
 * @returns {Promise<any>} List.
 * @throws {TranslatorError} 404 `files_disabled` when `files` is null; 400 for a bad parameter.
 */
export async function list(query = {}, options = {}) {
	const front = options.front ?? context.config.front;
	const store = storeOf(context.config, context.state);
	if (store === null)
		throw new TranslatorError("The Files API is off (the files setting is null)", { code: "files_disabled", status: 404 });
	const metas = await store.list();
	return front === "openai" ? openaiList(metas, query) : anthropicList(metas, query, options.beta === true);
}

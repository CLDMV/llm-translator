/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/files/remove.mjs
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
 * @fileoverview Files api: delete a stored file.
 * @module @cldmv/llm-translator/files
 */
import { context } from "../../lib/runtime.mjs";
import { TranslatorError } from "../../lib/errors.mjs";
import { missing, storeOf } from "../../lib/files.mjs";

/**
 * Delete a stored file (`DELETE /v1/files/{id}`) and return the front's confirmation: Anthropic `{ id, type: "file_deleted" }`, OpenAI
 * `{ id, object: "file", deleted: true }`.
 * @param {string} id - File id.
 * @param {any} [options] - `{ front }`.
 * @returns {Promise<any>} Confirmation.
 * @throws {TranslatorError} 404 `files_disabled` when `files` is null, 404 `file_not_found` for an unknown or expired id.
 */
export async function remove(id, options = {}) {
	const front = options.front ?? context.config.front;
	const store = storeOf(context.config, context.state);
	if (store === null)
		throw new TranslatorError("The Files API is off (the files setting is null)", { code: "files_disabled", status: 404 });
	if ((await store.head(id)) === null || !(await store.remove(id))) throw missing(front, id);
	return front === "openai" ? { id, object: "file", deleted: true } : { id, type: "file_deleted" };
}

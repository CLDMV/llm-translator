/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/files/get.mjs
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
 * @fileoverview Files api: retrieve one stored file's metadata.
 * @module @cldmv/llm-translator/files
 */
import { context } from "../../lib/runtime.mjs";
import { TranslatorError } from "../../lib/errors.mjs";
import { anthropicFile, missing, openaiFile, storeOf } from "../../lib/files.mjs";

/**
 * The file object of a stored file, in the client protocol's shape.
 * @param {string} id - File id.
 * @param {any} [options] - `{ front, beta }`.
 * @returns {Promise<any>} File object.
 * @throws {TranslatorError} 404 `files_disabled` when `files` is null, 404 `file_not_found` for an unknown or expired id.
 */
export async function get(id, options = {}) {
	const front = options.front ?? context.config.front;
	const store = storeOf(context.config, context.state);
	if (store === null)
		throw new TranslatorError("The Files API is off (the files setting is null)", { code: "files_disabled", status: 404 });
	const meta = await store.head(id);
	if (meta === null) throw missing(front, id);
	return front === "openai" ? openaiFile(meta) : anthropicFile(meta, options.beta === true);
}

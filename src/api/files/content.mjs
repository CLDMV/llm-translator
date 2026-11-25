/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/files/content.mjs
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
 * @fileoverview Files api: read a stored file's bytes.
 * @module @cldmv/llm-translator/files
 */
import { context } from "../../lib/runtime.mjs";
import { TranslatorError } from "../../lib/errors.mjs";
import { missing, storeOf, TOOL_PURPOSE } from "../../lib/files.mjs";

/**
 * The bytes of a stored file. The OpenAI front serves them. The Anthropic front serves only files a server tool created (code execution output,
 * `downloadable: true`), as Anthropic does; an uploaded file is refused with the same 400 Anthropic gives.
 * @param {string} id - File id.
 * @param {any} [options] - `{ front }`.
 * @returns {Promise<{ data: Buffer, type: string, filename: string }>} The bytes, the media type and the file name.
 * @throws {TranslatorError} 404 `files_disabled` when `files` is null, 404 `file_not_found`, 400 `not_downloadable` on the Anthropic front.
 */
export async function content(id, options = {}) {
	const front = options.front ?? context.config.front;
	const store = storeOf(context.config, context.state);
	if (store === null)
		throw new TranslatorError("The Files API is off (the files setting is null)", { code: "files_disabled", status: 404 });
	const file = await store.get(id);
	if (file === null) throw missing(front, id);
	if (front === "anthropic" && file.meta.purpose !== TOOL_PURPOSE) {
		throw new TranslatorError(`File \`${id}\` is not downloadable: only files created by tools or skills can be downloaded`, {
			code: "not_downloadable",
			status: 400,
			type: "invalid_request_error",
			param: "file_id"
		});
	}
	return { data: file.data, type: file.meta.mime_type, filename: file.meta.filename };
}

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/files/create.mjs
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
 * @fileoverview Files api: store an uploaded file.
 * @module @cldmv/llm-translator/files
 */
import { context } from "../../lib/runtime.mjs";
import { TranslatorError } from "../../lib/errors.mjs";
import { newId } from "../../lib/filestore.mjs";
import { PURPOSES, anthropicFile, expiryOf, filenameOf, mimeOf, openaiFile, storeOf } from "../../lib/files.mjs";

/**
 * Store an uploaded file and return its file object in the client protocol's shape (Anthropic `{ type: "file", ... }` or OpenAI `{ object: "file", ... }`).
 * The id starts with `file_` for the Anthropic front and `file-` for the OpenAI front; either front can use any stored file. Limits come from the `files`
 * setting. Anthropic's form has `file` and an optional `expires_in_seconds`; OpenAI's has `file`, a `purpose` (required) and an optional
 * `expires_after[anchor]` / `expires_after[seconds]`. A file's lifetime is the shorter of its own and the `ttl` setting.
 * @param {{ filename: string, data: Buffer, type?: string, fields?: Record<string, string> }} upload - The file part and the form's text fields.
 * @param {any} [options] - `{ front, beta }`; `beta` selects Anthropic's `files-api-2025-04-14` shape (no `expires_at`).
 * @returns {Promise<any>} File object.
 * @throws {TranslatorError} 404 `files_disabled` when `files` is null; 400 for a bad name, purpose or expiry; 413 `file_too_large`; 400 `storage_limit_exceeded`.
 */
export async function create(upload, options = {}) {
	const front = options.front ?? context.config.front;
	const store = storeOf(context.config, context.state);
	if (store === null)
		throw new TranslatorError("The Files API is off (the files setting is null)", { code: "files_disabled", status: 404 });
	const fields = upload.fields ?? {};
	const filename = filenameOf(upload.filename);
	let purpose = "user_data";
	if (front === "openai") {
		purpose = fields.purpose;
		if (!PURPOSES.includes(purpose)) {
			throw new TranslatorError(`purpose must be one of ${PURPOSES.join(", ")}`, {
				code: "invalid_purpose",
				status: 400,
				type: "invalid_request_error",
				param: "purpose"
			});
		}
	}
	const meta = await store.put({
		id: newId(front),
		filename,
		mimeType: mimeOf(upload.type, filename),
		purpose,
		data: upload.data,
		expiresIn: expiryOf(front, fields)
	});
	return front === "openai" ? openaiFile(meta) : anthropicFile(meta, options.beta === true);
}

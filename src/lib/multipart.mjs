/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/multipart.mjs
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
 * @fileoverview A small `multipart/form-data` reader for file uploads, so the Files API needs no extra dependency. The body is read whole (the server
 * limits its size before it gets here).
 * @module @cldmv/llm-translator/lib/multipart
 */
import { TranslatorError } from "./errors.mjs";

const CRLF = Buffer.from("\r\n");
const BLANK = Buffer.from("\r\n\r\n");

/**
 * An invalid upload.
 * @param {string} message - What is wrong.
 * @returns {TranslatorError} 400 `invalid_multipart`.
 */
function bad(message) {
	return new TranslatorError(message, { code: "invalid_multipart", status: 400, type: "invalid_request_error" });
}

/**
 * The value of a header parameter (`name="x"`), with backslash escapes inside quotes undone.
 * @param {string} header - Header value.
 * @param {string} key - Parameter name.
 * @returns {string | undefined} The value.
 */
function param(header, key) {
	const match = new RegExp(`(?:^|;)\\s*${key}=(?:"((?:[^"\\\\]|\\\\.)*)"|([^;\\s]*))`, "i").exec(header);
	if (!match) return undefined;
	return match[1] === undefined ? match[2] : match[1].replace(/\\(.)/g, "$1");
}

/**
 * Parse a `multipart/form-data` body.
 * @param {Buffer} body - The body.
 * @param {string | undefined} contentType - The request's `content-type` header, which names the boundary.
 * @returns {{ fields: Record<string, string>, files: { name: string, filename: string, type: string | undefined, data: Buffer }[] }} Text fields by name and file parts in order.
 * @throws {TranslatorError} 400 `invalid_multipart` when there is no boundary or the body is not well formed.
 */
export function parse(body, contentType) {
	const boundary = param(contentType ?? "", "boundary");
	if (boundary === undefined || boundary === "") throw bad("The multipart request has no boundary");
	const delimiter = Buffer.from(`--${boundary}`);
	/** @type {Record<string, string>} */
	const fields = {};
	/** @type {{ name: string, filename: string, type: string | undefined, data: Buffer }[]} */
	const files = [];
	let at = body.indexOf(delimiter);
	if (at === -1) throw bad("The multipart body has no parts");
	for (;;) {
		at += delimiter.length;
		// `--` after a delimiter ends the body.
		if (body.subarray(at, at + 2).toString() === "--") break;
		if (!body.subarray(at, at + CRLF.length).equals(CRLF)) throw bad("The multipart body is malformed");
		at += CRLF.length;
		const next = body.indexOf(Buffer.concat([CRLF, delimiter]), at);
		if (next === -1) throw bad("The multipart body is not closed");
		const part = body.subarray(at, next);
		at = next + CRLF.length;
		const split = part.indexOf(BLANK);
		if (split === -1) throw bad("A multipart part has no header block");
		/** @type {Record<string, string>} */
		const headers = {};
		for (const line of part.subarray(0, split).toString("utf8").split("\r\n")) {
			const colon = line.indexOf(":");
			if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
		}
		const disposition = headers["content-disposition"] ?? "";
		const name = param(disposition, "name");
		if (name === undefined) throw bad("A multipart part has no name");
		const data = part.subarray(split + BLANK.length);
		const filename = param(disposition, "filename");
		if (filename === undefined) fields[name] = data.toString("utf8");
		else files.push({ name, filename, type: headers["content-type"], data });
	}
	return { fields, files };
}

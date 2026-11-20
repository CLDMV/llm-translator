/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/vertex/error.mjs
 *	@Date: 2026-11-19T09:00:00-08:00 (1795107600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-19T09:00:00-08:00 (1795107600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Vertex AI driver: error normalizer.
 * @module @cldmv/llm-translator/driver/vertex
 */
import * as upstream from "../../../lib/upstream-error.mjs";

/**
 * Normalize Google's error envelope (`{ error: { code, message, status } }`, sometimes inside a one-element array) and Claude's own
 * (`{ type: "error", error: { type, message } }`, which Vertex AI passes through) to the nested shape. Google's `status` (`NOT_FOUND`) becomes the code.
 * @param {number} status - HTTP status.
 * @param {*} body - Parsed upstream error body.
 * @returns {{error: {message: string, type: string | undefined, param: *, code: *}}} Nested error body.
 */
export function error(status, body) {
	const first = Array.isArray(body) ? body[0] : body;
	const info = upstream.parse(first, status);
	const code = typeof first?.error?.status === "string" ? first.error.status : info.code;
	return { error: { message: info.message, type: info.type, param: info.param ?? null, code: code ?? status } };
}

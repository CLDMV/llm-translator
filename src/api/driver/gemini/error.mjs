/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/gemini/error.mjs
 *	@Date: 2026-11-21T10:00:00-08:00 (1795284000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-21T10:00:00-08:00 (1795284000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Gemini driver: error normalizer.
 * @module @cldmv/llm-translator/driver/gemini
 */
import { normalize } from "../../../lib/google-error.mjs";
import { GEMINI } from "../../../lib/protocol.mjs";

/**
 * Normalize an error of the native `generateContent` API (Google's `{ error: { code, message, status } }` envelope, which becomes the nested
 * shape with the status, for example `INVALID_ARGUMENT`, as the code). An error of the OpenAI-compatible endpoint is left as it is.
 * @param {number} status - HTTP status.
 * @param {*} body - Parsed upstream error body.
 * @param {any} [context] - `{ state }`, the state returned by `request`.
 * @returns {*} Error body.
 */
export function error(status, body, context) {
	return context?.state?.protocol === GEMINI ? normalize(status, body) : body;
}

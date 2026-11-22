/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/gemini/request.mjs
 *	@Date: 2026-11-13T10:00:00-08:00 (1794592800)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-13T10:00:00-08:00 (1794592800)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Gemini driver: request normalizer (a Chat Completions body for the OpenAI-compatible endpoint, a `generateContent` body for the native API).
 * @module @cldmv/llm-translator/driver/gemini
 */
import { trim } from "../../../lib/presets.mjs";
import { GEMINI } from "../../../lib/protocol.mjs";

/**
 * Drop tool fields when there are no tools, and the fields Gemini (OpenAI-compatible endpoint) rejects (each recorded in `state.dropped`). A
 * native `generateContent` body loses `model` and `stream` instead: the URL carries both, and the API rejects fields it does not know.
 * @param {any} body - Chat Completions or `generateContent` request body.
 * @param {any} [context] - `{ state, protocol }`.
 * @returns {any} Normalized body.
 */
export function request(body, context) {
	if (context?.protocol === GEMINI) {
		const { model: ___model, stream: ___stream, ...rest } = body;
		return rest;
	}
	return trim("gemini", body, context);
}

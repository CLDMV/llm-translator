/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/openrouter/response.mjs
 *	@Date: 2026-11-13T09:00:00-08:00 (1794589200)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-13T09:00:00-08:00 (1794589200)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview OpenRouter driver: response normalizer (Chat Completions body).
 * @module @cldmv/llm-translator/driver/openrouter
 */
import { found, failure } from "../../../lib/openrouter.mjs";

/**
 * Turn an error OpenRouter sent with HTTP 200 into an upstream error: `choices[i].error` on every choice, or a top-level `error` and no choices.
 * Any partial text of the failed choice is dropped. A reply with a choice that did not fail passes unchanged.
 * @param {any} body - Parsed `chat.completion`.
 * @returns {any} The body.
 * @throws {import("../../../lib/errors.mjs").TranslatorError} With the error's `message` and its `code` as the HTTP status.
 */
export function response(body) {
	const error = found(body);
	if (error) throw failure(error);
	return body;
}

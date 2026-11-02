/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/deepseek/error.mjs
 *	@Date: 2026-10-31T14:00:00-07:00 (1793480400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-31T14:00:00-07:00 (1793480400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview DeepSeek driver: error normalizer.
 * @module @cldmv/llm-translator/driver/deepseek
 */
import * as upstream from "../../../lib/upstream-error.mjs";

const HINT =
	"DeepSeek needs the reasoning of earlier turns sent back when tools are used in thinking mode. The conversation no longer carries it (thinking blocks were not replayed or were cleared), so start a new conversation.";

/**
 * Normalize to the nested OpenAI shape and explain DeepSeek's `reasoning_content` refusal.
 * @param {number} status - HTTP status.
 * @param {*} body - Parsed upstream error body.
 * @returns {{error: {message: string, type: string | undefined, param: *, code: *}}} Nested error body.
 */
export function error(status, body) {
	const info = upstream.parse(body, status);
	const message = status === 400 && /reasoning_content/i.test(info.message) ? `${info.message} ${HINT}` : info.message;
	return { error: { message, type: info.type, param: info.param ?? null, code: info.code ?? status } };
}

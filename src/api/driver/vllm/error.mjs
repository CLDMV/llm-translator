/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/vllm/error.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:00-07:00 (1792958340)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview vLLM driver: error normalizer.
 * @module @cldmv/llm-translator/driver/vllm
 */
import * as upstream from "../../../lib/upstream-error.mjs";

/**
 * Normalize old flat (`{message,type,code}`) and nested vLLM error bodies to the nested OpenAI shape.
 * @param {number} status - HTTP status.
 * @param {*} body - Parsed upstream error body.
 * @returns {{error: {message: string, type: string | undefined, param: *, code: *}}} Nested error body.
 */
export function error(status, body) {
	const info = upstream.parse(body, status);
	return { error: { message: info.message, type: info.type, param: info.param ?? null, code: info.code ?? status } };
}

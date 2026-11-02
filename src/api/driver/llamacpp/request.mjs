/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/llamacpp/request.mjs
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
 * @fileoverview llama.cpp driver: request normalizer (Chat Completions body).
 * @module @cldmv/llm-translator/driver/llamacpp
 */
import { noEmptyTools } from "../../../lib/normalize.mjs";

/**
 * Drop tool fields when there are no tools; send `parallel_tool_calls: true` with tools (llama-server leaves parallel calls off unless
 * asked, and the converter only ever sends `false`); and rename vLLM's `repetition_penalty` to llama.cpp's `repeat_penalty`.
 * @param {any} body - Chat Completions request body.
 * @param {any} [ctx] - `{ settings }`.
 * @returns {any} Normalized body.
 */
export function request(body, ctx) {
	let out = noEmptyTools(body);
	if (out.tools !== undefined && out.parallel_tool_calls === undefined && ctx?.settings?.parallelToolCalls !== false) {
		out = { ...out, parallel_tool_calls: true };
	}
	if (out.repetition_penalty !== undefined && out.repeat_penalty === undefined) {
		const { repetition_penalty: penalty, ...rest } = out;
		out = { ...rest, repeat_penalty: penalty };
	}
	return out;
}

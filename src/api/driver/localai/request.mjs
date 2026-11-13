/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/localai/request.mjs
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
 * @fileoverview LocalAI driver: request normalizer (Chat Completions body).
 * @module @cldmv/llm-translator/driver/localai
 */
import { noEmptyTools } from "../../../lib/normalize.mjs";

/**
 * Drop tool fields when there are no tools; rename vLLM's `repetition_penalty` to LocalAI's `repeat_penalty`; and take over
 * `parallel_tool_calls: false`. LocalAI does not read that field: whether a model may call several tools in one turn is its YAML
 * `function.parallel_calls`. When the client asked for one call at a time (the Anthropic front's `disable_parallel_tool_use`), the field
 * is removed and `state.localaiSingleCall` makes the response normalizers keep only the first call.
 * @param {any} body - Chat Completions request body.
 * @param {any} [ctx] - `{ state }`.
 * @returns {any} Normalized body.
 */
export function request(body, ctx) {
	const out = { ...noEmptyTools(body) };
	if (out.repetition_penalty !== undefined) {
		if (out.repeat_penalty === undefined) out.repeat_penalty = out.repetition_penalty;
		delete out.repetition_penalty;
	}
	if (out.parallel_tool_calls === false && ctx?.state) {
		ctx.state.localaiSingleCall = true;
		delete out.parallel_tool_calls;
	}
	return out;
}

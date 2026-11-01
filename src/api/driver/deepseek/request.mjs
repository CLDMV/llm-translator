/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/deepseek/request.mjs
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
 * @fileoverview DeepSeek driver: request normalizer (Chat Completions body).
 * @module @cldmv/llm-translator/driver/deepseek
 */
import { noEmptyTools } from "../../../lib/normalize.mjs";

/** Fields that fail in thinking mode: forced tool choice (`required` or a named function) and log probabilities. */
const THINKING_REJECTS = ["logprobs", "top_logprobs"];

/**
 * Is this request in thinking mode? The `deepseek-reasoner` family always is; other models are when the body enables `thinking`.
 * @param {any} body - Chat Completions request body.
 * @returns {boolean} True for thinking mode.
 */
function thinking(body) {
	if (body.thinking?.type === "disabled") return false;
	return body.thinking?.type === "enabled" || /reasoner/i.test(String(body.model));
}

/**
 * Drop tool fields when there are no tools. In thinking mode also remove what DeepSeek rejects there: `tool_choice` of `required` or a named
 * function (`auto` and `none` stay) and `logprobs`/`top_logprobs`; each removal is recorded in `state.dropped`.
 * @param {any} body - Chat Completions request body.
 * @param {any} [ctx] - `{ state }`.
 * @returns {any} Normalized body.
 */
export function request(body, ctx) {
	let out = noEmptyTools(body);
	if (!thinking(out)) return out;
	const dropped = ctx?.state?.dropped;
	const remove = (field) => {
		out = { ...out };
		delete out[field];
		if (Array.isArray(dropped) && !dropped.includes(field)) dropped.push(field);
	};
	if (out.tool_choice !== undefined && out.tool_choice !== "auto" && out.tool_choice !== "none") remove("tool_choice");
	for (const field of THINKING_REJECTS) if (out[field] !== undefined) remove(field);
	return out;
}

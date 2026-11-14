/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/openrouter/request.mjs
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
 * @fileoverview OpenRouter driver: request normalizer (Chat Completions body).
 * @module @cldmv/llm-translator/driver/openrouter
 */
import { noEmptyTools } from "../../../lib/normalize.mjs";

/**
 * Drop empty tool fields and express the reasoning controls the way OpenRouter takes them: a `reasoning` object with either `effort` or
 * `max_tokens`, never both. A `reasoning` object the client sent itself is kept as it is (its `reasoning_effort` sibling is removed). Otherwise
 * `reasoning_effort` becomes `reasoning: { effort }`, and an Anthropic request that enabled thinking with a `budget_tokens` and no effort
 * becomes `reasoning: { max_tokens }`, capped below the request's `max_tokens`.
 * @param {any} body - Chat Completions request body.
 * @param {any} [context] - `{ state }`; `state.thinkingBudget` is the thinking budget of an Anthropic request.
 * @returns {any} Normalized body.
 */
export function request(body, context) {
	const { reasoning_effort: effort, ...rest } = noEmptyTools(body);
	if (rest.reasoning !== undefined && rest.reasoning !== null) return rest;
	const budget = context?.state?.thinkingBudget;
	if (Number.isInteger(budget) && budget > 0) {
		const limit = Number.isInteger(rest.max_tokens) ? Math.max(1, rest.max_tokens - 1) : budget;
		return { ...rest, reasoning: { max_tokens: Math.min(budget, limit) } };
	}
	return effort === undefined ? rest : { ...rest, reasoning: { effort } };
}

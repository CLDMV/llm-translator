/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/localai/response.mjs
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
 * @fileoverview LocalAI driver: response normalizer (Chat Completions body).
 * @module @cldmv/llm-translator/driver/localai
 */

/**
 * When the client asked for one tool call at a time, keep only the first call of each choice: LocalAI decides by model configuration
 * (`function.parallel_calls`) and ignores the request, so a model configured for parallel calls can still return several.
 * @param {any} body - Chat Completions response body.
 * @param {any} [ctx] - `{ state }`.
 * @returns {any} Normalized body.
 */
export function response(body, ctx) {
	if (ctx?.state?.convert?.localaiSingleCall !== true || !Array.isArray(body?.choices)) return body;
	return {
		...body,
		choices: body.choices.map((choice) => {
			const calls = choice?.message?.tool_calls;
			if (!Array.isArray(calls) || calls.length < 2) return choice;
			return { ...choice, message: { ...choice.message, tool_calls: calls.slice(0, 1) } };
		})
	};
}

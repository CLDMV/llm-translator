/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/tgi/response.mjs
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
 * @fileoverview Hugging Face TGI driver: response normalizer (Chat Completions body).
 * @module @cldmv/llm-translator/driver/tgi
 */
import { finish, toolCalls } from "../../../lib/tgi.mjs";

/**
 * Put TGI's historic deviations into the OpenAI shape: `tool_calls` as one object becomes a list, numeric tool-call ids become strings,
 * object `arguments` (or `parameters`) become a JSON string, `eos_token` and `stop_sequence` finish reasons become `stop` (or `tool_calls`
 * when the answer holds calls), and the `text_completion` object name becomes `chat.completion`. Current TGI already answers in the
 * standard shape, which passes through unchanged.
 * @param {any} body - Chat Completions response body.
 * @returns {any} Normalized body.
 */
export function response(body) {
	if (!Array.isArray(body?.choices)) return body;
	const out = {
		...body,
		choices: body.choices.map((choice) => {
			if (choice === null || typeof choice !== "object") return choice;
			const calls = toolCalls(choice.message?.tool_calls, true);
			const next = { ...choice, finish_reason: finish(choice.finish_reason, calls !== undefined && calls.length > 0) };
			if (calls !== undefined) next.message = { ...choice.message, tool_calls: calls };
			return next;
		})
	};
	if (out.object === "text_completion") out.object = "chat.completion";
	return out;
}

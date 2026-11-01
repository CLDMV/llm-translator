/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/llamacpp/response.mjs
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
 * @fileoverview llama.cpp driver: response normalizer (Chat Completions body).
 * @module @cldmv/llm-translator/driver/llamacpp
 */
import { callId } from "../../../lib/ids.mjs";
import { splitThink } from "../../../lib/thinking.mjs";

/**
 * Give tool calls without an id one, and remove the duplicate reasoning that `--reasoning-format deepseek-legacy` leaves in `content`.
 * `deepseek` puts reasoning in `reasoning_content` only; `none` leaves `<think>` tags in `content` only (read by `thinkTags`); `deepseek-legacy`
 * does both, so a leading `<think>...</think>` is cut from `content` when `reasoning_content` already carries the reasoning.
 * @param {any} body - Chat Completions response body.
 * @returns {any} Normalized body.
 */
export function response(body) {
	if (!Array.isArray(body?.choices)) return body;
	return {
		...body,
		choices: body.choices.map((choice) => {
			const message = choice?.message;
			if (!message || typeof message !== "object") return choice;
			let next = message;
			if (typeof message.reasoning_content === "string" && message.reasoning_content !== "" && typeof message.content === "string") {
				const text = splitThink(message.content).text;
				if (text !== message.content) next = { ...next, content: text };
			}
			if (Array.isArray(message.tool_calls)) {
				next = { ...next, tool_calls: message.tool_calls.map((call) => (call?.id ? call : { ...call, id: callId() })) };
			}
			return next === message ? choice : { ...choice, message: next };
		})
	};
}

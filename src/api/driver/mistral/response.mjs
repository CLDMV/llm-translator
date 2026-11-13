/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/mistral/response.mjs
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
 * @fileoverview Mistral driver: response normalizer (Chat Completions body).
 * @module @cldmv/llm-translator/driver/mistral
 */
import { flatten } from "../../../lib/typed.mjs";

/**
 * Flatten typed content chunks: a reasoning model answers with `content` as a list of `text` and `thinking` chunks. The text becomes the
 * string `content` and the thinking becomes `reasoning_content`.
 * @param {any} body - Chat Completions response body.
 * @returns {any} Normalized body.
 */
export function response(body) {
	if (!Array.isArray(body?.choices)) return body;
	return {
		...body,
		choices: body.choices.map((choice) => {
			const parts = flatten(choice?.message?.content);
			if (!parts) return choice;
			const message = { ...choice.message, content: parts.text };
			if (parts.thinking !== "") message.reasoning_content = parts.thinking;
			return { ...choice, message };
		})
	};
}

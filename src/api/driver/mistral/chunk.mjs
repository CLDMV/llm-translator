/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/mistral/chunk.mjs
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
 * @fileoverview Mistral driver: streaming chunk normalizer (Chat Completions chunk).
 * @module @cldmv/llm-translator/driver/mistral
 */
import { flatten } from "../../../lib/typed.mjs";

/**
 * Flatten typed content chunks in a streamed delta. While a reasoning model thinks, `delta.content` is a list holding a `thinking` chunk; the
 * switch to the answer is a list with the closing `thinking` chunk and the first `text` chunk; the answer then streams as a plain string.
 * The thinking goes to `reasoning_content` and the text to `content`.
 * @param {any} chunk - Parsed `chat.completion.chunk`.
 * @returns {any} Normalized chunk.
 */
export function chunk(chunk) {
	const parts = flatten(chunk?.choices?.[0]?.delta?.content);
	if (!parts) return chunk;
	const [first, ...rest] = chunk.choices;
	const delta = { ...first.delta, content: parts.text };
	if (parts.thinking !== "") delta.reasoning_content = parts.thinking;
	return { ...chunk, choices: [{ ...first, delta }, ...rest] };
}

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/openrouter/chunk.mjs
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
 * @fileoverview OpenRouter driver: streaming chunk normalizer (Chat Completions chunk).
 * @module @cldmv/llm-translator/driver/openrouter
 */

/**
 * Give an error that sits on a choice the top-level `error` the stream converter and OpenRouter's own mid-stream errors use, so the Anthropic
 * front ends the stream with an `error` event carrying the provider's message. A chunk that already has an `error` or no choice error passes unchanged.
 * @param {any} chunk - Parsed `chat.completion.chunk`.
 * @returns {any} Normalized chunk.
 */
export function chunk(chunk) {
	if (chunk?.error !== undefined) return chunk;
	const error = Array.isArray(chunk?.choices) ? chunk.choices.find((choice) => choice?.error)?.error : undefined;
	return error === undefined ? chunk : { ...chunk, error };
}

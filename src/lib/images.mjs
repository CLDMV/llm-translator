/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/images.mjs
 *	@Date: 2026-10-26T06:00:20-07:00 (1793019620)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-26T15:38:55-07:00 (1793054335)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Image handling for upstreams that turn out to be text-only: recognising the refusal, finding images in a
 * Chat Completions body and replacing them with a note.
 * @module @cldmv/llm-translator/lib/images
 */

/** Text that replaces an image when the model does not accept images. */
export const NOTE = "[An image was omitted because this model does not accept images.]";

/**
 * Wordings seen from servers that refuse image input:
 * - vLLM: `<model> is not a multimodal model`, and `At most 0 image(s) may be provided in one prompt` (`limit_mm_per_prompt`).
 * - OpenAI-compatible hosts: `image_url is only supported by certain models`, `Model does not support images`,
 *   `This model does not support image inputs`, and llama.cpp's `image input is not supported`.
 * Deliberately narrow: a 400 that merely mentions images (a bad data URL, an oversized image) must not match.
 */
const REFUSED = [
	/\bnot a multimodal\b/i,
	/\bat most 0 images?\b/i,
	/\bimage_url is only supported\b/i,
	/\b(?:does not|doesn't|do not|cannot|can't|not) (?:support|accept|handle)\b[^.]{0,30}\bimages?\b/i,
	/\bimages?(?: input| inputs| content)? (?:is|are) not (?:supported|enabled|accepted)\b/i,
	/\bimage input (?:is )?not (?:supported|enabled)\b/i
];

/**
 * Does an upstream error message say the model does not accept images?
 * @param {string} message - Upstream error message.
 * @returns {boolean} True for a known "no image input" wording.
 */
export function refused(message) {
	return REFUSED.some((pattern) => pattern.test(message));
}

/**
 * Does a Chat Completions body carry image parts?
 * @param {any} body - Upstream request body.
 * @returns {boolean} True when any message content has an `image_url` part.
 */
export function carries(body) {
	return (body?.messages ?? []).some(
		(message) => Array.isArray(message?.content) && message.content.some((part) => part?.type === "image_url")
	);
}

/**
 * Copy a Chat Completions body with every image part replaced by a short text note.
 * @param {any} body - Upstream request body.
 * @returns {any} New body; messages without images are shared with the input.
 */
export function strip(body) {
	const messages = (body.messages ?? []).map((message) =>
		Array.isArray(message?.content) && message.content.some((part) => part?.type === "image_url")
			? { ...message, content: message.content.map((part) => (part?.type === "image_url" ? { type: "text", text: NOTE } : part)) }
			: message
	);
	return { ...body, messages };
}

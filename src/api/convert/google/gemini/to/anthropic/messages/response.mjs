/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/google/gemini/to/anthropic/messages/response.mjs
 *	@Date: 2026-11-21T10:00:00-08:00 (1795284000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-21T10:00:00-08:00 (1795284000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Google Gemini `generateContent` reply to an Anthropic Messages response.
 * @module @cldmv/llm-translator/convert
 */
import { resolve } from "../../../../../../../lib/settings.mjs";
import { completion } from "../../../../../../../lib/gemini.mjs";
import { tagged } from "../../../../../../../lib/gemini-computer.mjs";
import { response as fromChat } from "../../../../../openai/chat/to/anthropic/messages/response.mjs";

/**
 * Convert a `generateContent` reply to an Anthropic message: the reply is read as a Chat Completions `chat.completion` (reasoning, tool calls with the
 * model's ids, thought signatures as `reasoning_details`, `finishReason` as `finish_reason`, `usageMetadata` as `usage`) and the Chat Completions conversion builds the message.
 * @param {any} reply - Parsed `generateContent` reply.
 * @param {any} [state] - State from the request converter.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {any} Anthropic message.
 * @throws {import("../../../../../../../lib/errors.mjs").TranslatorError} When the reply has no message or ends in a failure.
 */
export function response(reply, state, settings) {
	// Generated images have no place in an Anthropic message, so they are written into the text as markdown images.
	const message = fromChat(
		completion(reply, {
			citations: resolve(settings).citations,
			parallel: state?.parallel,
			images: "text",
			cacheCreated: state?.cache?.created,
			computer: state?.computer,
			confirm: state?.confirm
		}),
		state,
		settings
	);
	// The computer toolset's calls carry `toolset_name`.
	return { ...message, content: message.content.map((block) => tagged(block, state?.computer)) };
}

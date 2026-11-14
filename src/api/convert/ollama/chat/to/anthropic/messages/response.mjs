/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/ollama/chat/to/anthropic/messages/response.mjs
 *	@Date: 2026-11-13T11:00:00-08:00 (1794596400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-13T11:00:00-08:00 (1794596400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Ollama native `/api/chat` reply to an Anthropic Messages response.
 * @module @cldmv/llm-translator/convert
 */
import { completion } from "../../../../../../../lib/ollama.mjs";
import { response as fromChat } from "../../../../../openai/chat/to/anthropic/messages/response.mjs";

/**
 * Convert an Ollama reply to an Anthropic message: the reply is read as a Chat Completions `chat.completion` (thinking, tool calls with generated
 * ids, `done_reason` as `finish_reason`, the evaluation counts as `usage`) and the Chat Completions conversion builds the message.
 * @param {any} reply - Parsed Ollama reply.
 * @param {any} [state] - State from the request converter.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {any} Anthropic message.
 * @throws {import("../../../../../../../lib/errors.mjs").TranslatorError} When the reply is an error.
 */
export function response(reply, state, settings) {
	return fromChat(completion(reply), state, settings);
}

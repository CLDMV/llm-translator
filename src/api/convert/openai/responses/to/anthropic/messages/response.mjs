/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/openai/responses/to/anthropic/messages/response.mjs
 *	@Date: 2026-11-17T12:00:00-08:00 (1794945600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-17T12:00:00-08:00 (1794945600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview OpenAI Responses reply to Anthropic Messages reply.
 */

import { response as toAnthropic } from "../../../../chat/to/anthropic/messages/response.mjs";
import { response as toChat } from "../../../../../../../lib/responses-upstream.mjs";

/**
 * Convert a (non-streaming) Responses reply into an Anthropic message: read as a Chat Completions reply first, then converted from there.
 * @param {any} reply - Responses object.
 * @param {any} [state] - State from the request converter.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {any} Anthropic message.
 */
export function response(reply, state, settings) {
	return toAnthropic(toChat(reply, state, settings), state, settings);
}

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/anthropic/messages/to/openai/responses/request.mjs
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
 * @fileoverview Anthropic Messages request to OpenAI Responses request.
 */

import { request as toChat } from "../chat/request.mjs";
import { request as toResponses } from "../../../../../../../lib/responses-upstream.mjs";

/**
 * Convert an Anthropic Messages request body into a Responses request body (for an Anthropic-protocol client talking to an upstream on the
 * Responses API). The request goes through the Anthropic to Chat Completions converter first, so tool search, documents, thinking,
 * reasoning round trips and every other conversion apply as they do for Chat Completions, and the result is then written as a Responses
 * body (see `lib/responses-upstream.mjs`). The state is the Chat Completions one, which the reply converters read, with the fields the
 * second step dropped added to `dropped`.
 * @param {any} body - Anthropic `POST /v1/messages` body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @param {any} [context] - See the Anthropic to Chat Completions converter.
 * @returns {Promise<{ body: any, state: any }>} Responses request body and conversion state.
 * @throws {import("../../../../../../../lib/errors.mjs").TranslatorError} As the Anthropic to Chat Completions converter, and for fields the Responses API lacks when configured to error.
 */
export async function request(body, settings, context) {
	const chat = await toChat(body, settings, context);
	const out = toResponses(chat.body, settings);
	chat.state.dropped.push(...out.state.dropped.filter((name) => !chat.state.dropped.includes(name)));
	return { body: out.body, state: chat.state };
}

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/openai/chat/to/openai/responses/request.mjs
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
 * @fileoverview OpenAI Chat Completions request to OpenAI Responses request.
 */

import { request as toResponses } from "../../../../../../../lib/responses-upstream.mjs";

/**
 * Convert a Chat Completions request body into a Responses request body (for an OpenAI-protocol client talking to an upstream on the
 * Responses API). See `lib/responses-upstream.mjs` for the mapping.
 * @param {any} chatBody - OpenAI `POST /v1/chat/completions` body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {Promise<{ body: any, state: any }>} Responses request body and conversion state.
 * @throws {import("../../../../../../../lib/errors.mjs").TranslatorError} For malformed requests, `n` above 1 (`send` fans that out instead), unknown roles, or unknown fields when configured to error.
 */
export async function request(chatBody, settings) {
	return toResponses(chatBody, settings);
}

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/openai/responses/to/openai/chat/response.mjs
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
 * @fileoverview OpenAI Responses reply to OpenAI Chat Completions reply.
 */

import { response as convert } from "../../../../../../../lib/responses-upstream.mjs";

/**
 * Convert a (non-streaming) Responses reply into a Chat Completions reply. See `lib/responses-upstream.mjs` for the mapping.
 * @param {any} reply - Responses object.
 * @param {any} [state] - State from the request converter.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {any} Chat completion.
 */
export function response(reply, state, settings) {
	return convert(reply, state, settings);
}

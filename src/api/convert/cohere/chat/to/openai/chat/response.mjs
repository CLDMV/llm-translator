/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/cohere/chat/to/openai/chat/response.mjs
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
 * @fileoverview Cohere `/v2/chat` reply to a Chat Completions response.
 * @module @cldmv/llm-translator/convert
 */
import { resolve } from "../../../../../../../lib/settings.mjs";
import { completion, folded } from "../../../../../../../lib/cohere.mjs";

/**
 * Convert a Cohere reply to a Chat Completions `chat.completion` (see `completion`). The model name is the one the client asked for, and the
 * counts are kept on the state for the usage report.
 * @param {any} reply - Parsed Cohere reply.
 * @param {any} [state] - State from the request converter.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {any} `chat.completion` object.
 * @throws {import("../../../../../../../lib/errors.mjs").TranslatorError} When the reply has no message or ends in a failure.
 */
export function response(reply, state, settings) {
	const out = completion(reply, { reasoningField: resolve(settings).reasoningField, model: state?.model, state });
	if (state) state.upstreamUsage = folded(reply.usage);
	return out;
}

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/ollama/chat/to/openai/chat/response.mjs
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
 * @fileoverview Ollama native `/api/chat` reply to a Chat Completions response.
 * @module @cldmv/llm-translator/convert
 */
import { resolve } from "../../../../../../../lib/settings.mjs";
import { completion, folded } from "../../../../../../../lib/ollama.mjs";

/**
 * Convert an Ollama reply to a Chat Completions `chat.completion` (see `completion`). The model name is the one the client asked for, and the
 * counts are kept on the state for the usage report.
 * @param {any} reply - Parsed Ollama reply.
 * @param {any} [state] - State from the request converter.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {any} `chat.completion` object.
 * @throws {import("../../../../../../../lib/errors.mjs").TranslatorError} When the reply is an error.
 */
export function response(reply, state, settings) {
	const out = completion(reply, { reasoningField: resolve(settings).reasoningField });
	if (state) state.upstreamUsage = folded(out.usage);
	return state?.model === undefined ? out : { ...out, model: state.model };
}

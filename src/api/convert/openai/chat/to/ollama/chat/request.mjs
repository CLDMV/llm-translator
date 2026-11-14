/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/openai/chat/to/ollama/chat/request.mjs
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
 * @fileoverview Chat Completions request to an Ollama native `/api/chat` request.
 * @module @cldmv/llm-translator/convert
 */
import { resolve } from "../../../../../../../lib/settings.mjs";
import { TranslatorError } from "../../../../../../../lib/errors.mjs";
import { chatBody } from "../../../../../../../lib/ollama.mjs";

/**
 * Convert a Chat Completions request to an Ollama `/api/chat` body (see `chatBody`). A client may also send Ollama's own `think`, `options`,
 * `format` and `keep_alive`; they are used as sent. The upstream's `sampling` setting fills in `options` fields the request does not name.
 * @param {any} body - Chat Completions request body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {{body: any, state: any}} The Ollama body and the conversion state the response converters read.
 * @throws {TranslatorError} `invalid_request` when `messages` is missing.
 */
export function request(body, settings) {
	const s = resolve(settings);
	if (body === null || typeof body !== "object" || !Array.isArray(body.messages)) {
		throw new TranslatorError("messages: Field required", { code: "invalid_request", param: "messages" });
	}
	const state = {
		front: "openai",
		model: body.model,
		stream: body.stream === true,
		toolNames: {},
		toolIds: {},
		dropped: [],
		includeUsage: body.stream_options?.include_usage === true
	};
	return { body: chatBody(body, { dropped: state.dropped, sampling: s.sampling }), state };
}

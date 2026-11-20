/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/openai/chat/to/bedrock/converse/request.mjs
 *	@Date: 2026-11-19T09:00:00-08:00 (1795107600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-19T09:00:00-08:00 (1795107600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Chat Completions request to an Amazon Bedrock Converse request.
 * @module @cldmv/llm-translator/convert
 */
import { resolve } from "../../../../../../../lib/settings.mjs";
import { TranslatorError } from "../../../../../../../lib/errors.mjs";
import { chatBody } from "../../../../../../../lib/converse.mjs";

/**
 * Convert a Chat Completions request to a Converse body (see `chatBody`). The upstream's `sampling` setting becomes `additionalModelRequestFields`.
 * @param {any} body - Chat Completions request body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {{body: any, state: any}} The Converse body and the conversion state the response converters read.
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
	return {
		body: chatBody(body, { dropped: state.dropped, sampling: s.sampling, marker: s.toolErrors ? s.toolErrorMarker : undefined }),
		state
	};
}

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/openai/chat/to/google/gemini/request.mjs
 *	@Date: 2026-11-22T10:00:00-08:00 (1795370400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T10:00:00-08:00 (1795370400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Chat Completions request to a Google Gemini `generateContent` request.
 * @module @cldmv/llm-translator/convert
 */
import { resolve } from "../../../../../../../lib/settings.mjs";
import { TranslatorError } from "../../../../../../../lib/errors.mjs";
import { MAX_CANDIDATES, chatBody } from "../../../../../../../lib/gemini.mjs";
import { prepare } from "../../../../../../../lib/gemini-images.mjs";

/**
 * Convert a Chat Completions request to a `generateContent` body (see `chatBody`). The upstream's `sampling` setting becomes further
 * `generationConfig` fields and its `gemini` setting the safety settings, built-in tools and the rest it names. A GIF image becomes a PNG first.
 * @param {any} body - Chat Completions request body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @param {any} [context] - `{ model, signal, report }`: the model the request goes to (the body's `model` is the client's name for it), the caller's abort signal and a function that receives one event per image fetched.
 * @returns {Promise<{body: any, state: any}>} The Gemini body and the conversion state the response converters read.
 * @throws {TranslatorError} `invalid_request` when `messages` is missing.
 */
export async function request(body, settings, context) {
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
		includeUsage: body.stream_options?.include_usage === true,
		parallel: body.parallel_tool_calls !== false,
		candidates: body.n > 1 ? Math.min(body.n, MAX_CANDIDATES) : 1,
		audio: body.audio?.format
	};
	const prepared = await prepare(body, { options: s.documentUrls, report: context?.report, signal: context?.signal });
	return {
		body: chatBody(prepared, {
			dropped: state.dropped,
			sampling: s.sampling,
			marker: s.toolErrors ? s.toolErrorMarker : undefined,
			model: context?.model,
			gemini: s.gemini
		}),
		state
	};
}

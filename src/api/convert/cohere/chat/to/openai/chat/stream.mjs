/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/cohere/chat/to/openai/chat/stream.mjs
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
 * @fileoverview Cohere `/v2/chat` Server-Sent Events to Chat Completions chunks.
 * @module @cldmv/llm-translator/convert
 */
import { resolve } from "../../../../../../../lib/settings.mjs";
import { createChunker, folded } from "../../../../../../../lib/cohere.mjs";
import { messages } from "../../../../../../../lib/sse.mjs";

/**
 * Convert Cohere stream events (Server-Sent Events text, or `{ event, data }` messages) to Chat Completions chunks followed by `[DONE]`. Every
 * chunk carries one completion id, tool calls stream their arguments in pieces, and the `message-end` event gives the finish chunk and, unless
 * `state.includeUsage` is false, the usage chunk. A failure, an event that cannot be read and a stream that ends before `message-end` each
 * become an `{ error }` chunk followed by `[DONE]`.
 * @param {ReadableStream|AsyncIterable<unknown>|Iterable<unknown>|string|Uint8Array} source - The events.
 * @param {any} [state] - State from the request converter (model, `includeUsage`).
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {AsyncGenerator<{ data: any|string }, void, undefined>} Chat Completions chunks.
 */
export async function* stream(source, state, settings) {
	const chunker = createChunker({
		model: state?.model,
		reasoningField: resolve(settings).reasoningField,
		includeUsage: state?.includeUsage ?? true,
		state
	});
	const failure = (message, type = "api_error") => ({ data: { error: { message, type, param: null, code: null } } });
	try {
		for await (const message of messages(source)) {
			const chunks = chunker.event(message.event, message.data);
			// Known before the usage chunk goes out, so the usage report and the estimate for a missing side see it.
			if (state && chunker.usage() !== undefined) state.upstreamUsage = folded(chunker.usage());
			for (const chunk of chunks) {
				yield { data: chunk };
				if (chunk.error) {
					yield { data: "[DONE]" };
					return;
				}
			}
		}
	} catch (error) {
		yield failure(error.message, error.type ?? "api_error");
		yield { data: "[DONE]" };
		return;
	}
	if (!chunker.finished()) yield failure("Upstream stream ended before completion");
	yield { data: "[DONE]" };
}

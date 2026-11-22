/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/google/gemini/to/openai/chat/stream.mjs
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
 * @fileoverview Google Gemini `streamGenerateContent` chunks to Chat Completions chunks.
 * @module @cldmv/llm-translator/convert
 */
import { resolve } from "../../../../../../../lib/settings.mjs";
import { createChunker, folded } from "../../../../../../../lib/gemini.mjs";
import { messages } from "../../../../../../../lib/sse.mjs";

/**
 * Convert `streamGenerateContent` chunks (Server-Sent Events, each a whole `GenerateContentResponse`) to Chat Completions chunks followed by
 * `[DONE]`. Every chunk carries one completion id, a function call is one tool call, and the final `usageMetadata` gives the usage chunk unless
 * `state.includeUsage` is false. A failure message, a chunk that cannot be read and a stream that ends before a `finishReason` each become an
 * `{ error }` chunk followed by `[DONE]`.
 * @param {ReadableStream|AsyncIterable<unknown>|Iterable<unknown>|string|Uint8Array} source - The chunks.
 * @param {any} [state] - State from the request converter (model, `includeUsage`).
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {AsyncGenerator<{ data: any|string }, void, undefined>} Chat Completions chunks.
 */
export async function* stream(source, state, settings) {
	const chunker = createChunker({
		model: state?.model,
		reasoningField: resolve(settings).reasoningField,
		includeUsage: state?.includeUsage ?? true,
		candidates: state?.candidates ?? 1,
		parallel: state?.parallel,
		audio: state?.audio
	});
	const failure = (message, type = "api_error") => ({ data: { error: { message, type, param: null, code: null } } });
	try {
		for await (const message of messages(source)) {
			const chunks = chunker.event(message.data);
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

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/ollama/chat/to/openai/chat/stream.mjs
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
 * @fileoverview Ollama native `/api/chat` NDJSON stream to Chat Completions chunks.
 * @module @cldmv/llm-translator/convert
 */
import { resolve } from "../../../../../../../lib/settings.mjs";
import { createChunker, folded } from "../../../../../../../lib/ollama.mjs";
import { parse } from "../../../../../../../lib/ndjson.mjs";

/**
 * Convert an Ollama stream (one JSON object per line, possibly split anywhere across chunks) to Chat Completions chunks followed by `[DONE]`.
 * Every chunk carries one completion id, tool calls come whole with generated ids, and the final line gives the finish chunk and, unless
 * `state.includeUsage` is false, a usage chunk. A line that is not JSON, an `{ error }` line and a stream that ends before its final line
 * each become an `{ error }` chunk followed by `[DONE]`.
 * @param {ReadableStream|AsyncIterable<unknown>|Iterable<unknown>|string|Uint8Array} source - Ollama NDJSON bytes or text.
 * @param {any} [state] - State from the request converter (model, `includeUsage`).
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {AsyncGenerator<{ data: any|string }, void, undefined>} Chat Completions chunks.
 */
export async function* stream(source, state, settings) {
	const chunker = createChunker({
		model: state?.model,
		reasoningField: resolve(settings).reasoningField,
		includeUsage: state?.includeUsage ?? true
	});
	const failure = (message, type = "api_error") => ({ data: { error: { message, type, param: null, code: null } } });
	try {
		for await (const line of parse(source)) {
			const chunks = chunker.line(line);
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

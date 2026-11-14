/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/ollama/chat/to/anthropic/messages/stream.mjs
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
 * @fileoverview Ollama native `/api/chat` NDJSON stream to Anthropic Messages events.
 * @module @cldmv/llm-translator/convert
 */
import { createChunker } from "../../../../../../../lib/ollama.mjs";
import { parse } from "../../../../../../../lib/ndjson.mjs";
import { stream as fromChat } from "../../../../../openai/chat/to/anthropic/messages/stream.mjs";

/**
 * Convert an Ollama stream (one JSON object per line, possibly split anywhere across chunks) to Anthropic events. The lines become Chat
 * Completions chunks (one id for the reply, tool calls whole with generated ids, the final line as the finish and usage chunks) and the Chat
 * Completions conversion writes the events. A line that is not JSON, an `{ error }` line and a stream that ends before its final line each
 * end the stream with an `error` event.
 * @param {ReadableStream|AsyncIterable<unknown>|Iterable<unknown>|string|Uint8Array} source - Ollama NDJSON bytes or text.
 * @param {any} [state] - State from the request converter.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {AsyncGenerator<{ event: string, data: any }, void, undefined>} Anthropic events.
 */
export function stream(source, state, settings) {
	const chunker = createChunker();
	return fromChat(
		(async function* () {
			for await (const line of parse(source)) yield* chunker.line(line);
			if (chunker.finished()) yield { data: "[DONE]" };
		})(),
		state,
		settings
	);
}

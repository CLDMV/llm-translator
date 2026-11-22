/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/google/gemini/to/anthropic/messages/stream.mjs
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
 * @fileoverview Google Gemini `streamGenerateContent` chunks to Anthropic Messages events.
 * @module @cldmv/llm-translator/convert
 */
import { resolve } from "../../../../../../../lib/settings.mjs";
import { createChunker } from "../../../../../../../lib/gemini.mjs";
import { messages } from "../../../../../../../lib/sse.mjs";
import { stream as fromChat } from "../../../../../openai/chat/to/anthropic/messages/stream.mjs";

/**
 * Convert `streamGenerateContent` chunks (Server-Sent Events, each a whole `GenerateContentResponse`) to Anthropic events. The chunks become Chat
 * Completions chunks (one id for the reply, a function call as one tool call, the `finishReason` as the finish chunk, the `usageMetadata` as the
 * usage chunk) and the Chat Completions conversion writes the events. A failure message, a chunk that cannot be read and a stream that ends
 * before a `finishReason` each end the stream with an `error` event.
 * @param {ReadableStream|AsyncIterable<unknown>|Iterable<unknown>|string|Uint8Array} source - The chunks.
 * @param {any} [state] - State from the request converter.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {AsyncGenerator<{ event: string, data: any }, void, undefined>} Anthropic events.
 */
export function stream(source, state, settings) {
	const chunker = createChunker({
		reasoningField: resolve(settings).reasoningField,
		parallel: state?.parallel,
		images: "text",
		cacheCreated: state?.cache?.created
	});
	return fromChat(
		(async function* () {
			for await (const message of messages(source)) yield* chunker.event(message.data);
			if (chunker.finished()) yield { data: "[DONE]" };
		})(),
		state,
		settings
	);
}

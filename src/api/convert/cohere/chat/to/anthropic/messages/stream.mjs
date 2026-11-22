/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/cohere/chat/to/anthropic/messages/stream.mjs
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
 * @fileoverview Cohere `/v2/chat` Server-Sent Events to Anthropic Messages events.
 * @module @cldmv/llm-translator/convert
 */
import { resolve } from "../../../../../../../lib/settings.mjs";
import { createChunker } from "../../../../../../../lib/cohere.mjs";
import { messages } from "../../../../../../../lib/sse.mjs";
import { stream as fromChat } from "../../../../../openai/chat/to/anthropic/messages/stream.mjs";

/**
 * Convert Cohere stream events (Server-Sent Events text, or `{ event, data }` messages) to Anthropic events. The events become Chat Completions
 * chunks (one id for the reply, tool calls streamed in pieces, `finish_reason` as the finish chunk, the `message-end` usage as the usage chunk)
 * and the Chat Completions conversion writes the events. A failure, an event that cannot be read and a stream that ends before `message-end`
 * each end the stream with an `error` event.
 * @param {ReadableStream|AsyncIterable<unknown>|Iterable<unknown>|string|Uint8Array} source - The events.
 * @param {any} [state] - State from the request converter.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {AsyncGenerator<{ event: string, data: any }, void, undefined>} Anthropic events.
 */
export function stream(source, state, settings) {
	const chunker = createChunker({ reasoningField: resolve(settings).reasoningField });
	return fromChat(
		(async function* () {
			for await (const message of messages(source)) yield* chunker.event(message.event, message.data);
			if (chunker.finished()) yield { data: "[DONE]" };
		})(),
		state,
		settings
	);
}

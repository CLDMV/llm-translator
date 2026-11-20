/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/bedrock/converse/to/anthropic/messages/stream.mjs
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
 * @fileoverview Amazon Bedrock ConverseStream events to Anthropic Messages events.
 * @module @cldmv/llm-translator/convert
 */
import { resolve } from "../../../../../../../lib/settings.mjs";
import { createChunker } from "../../../../../../../lib/converse.mjs";
import { messages } from "../../../../../../../lib/sse.mjs";
import { stream as fromChat } from "../../../../../openai/chat/to/anthropic/messages/stream.mjs";

/**
 * Convert ConverseStream events (`{ event, data }` messages, as `lib/eventstream` makes them from the binary frames, or Server-Sent Events text
 * of the same events) to Anthropic events. The events become Chat Completions chunks (one id for the reply, tool calls streamed in pieces, the
 * stop reason as the finish chunk, the `metadata` usage as the usage chunk) and the Chat Completions conversion writes the events. A failure
 * message, an event that cannot be read and a stream that ends before `messageStop` each end the stream with an `error` event.
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

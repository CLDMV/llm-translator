/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/stream.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:01-07:00 (1792958341)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Root api: convert a streaming upstream reply to client events.
 * @module @cldmv/llm-translator/stream
 */
import { context, self } from "../lib/runtime.mjs";
import { capture } from "../lib/capture.mjs";
import { messages } from "../lib/sse.mjs";

/**
 * Rewrite the model name carried by a client event back to the name the client asked for.
 * @param {*} data - Event payload.
 * @param {string | undefined} model - Client model name.
 * @returns {*} Payload with the model restored.
 */
function restore(data, model) {
	if (!model || !data || typeof data !== "object") return data;
	if (data.message && typeof data.message === "object" && data.message.model !== undefined) {
		return { ...data, message: { ...data.message, model } };
	}
	return data.model === undefined ? data : { ...data, model };
}

/**
 * Convert an upstream SSE stream to client events: Anthropic events (`message_start`, `content_block_*`, ...) for the
 * Anthropic front, Chat Completions chunks followed by `"[DONE]"` for the OpenAI front. Pings are added by the SSE writer.
 * @param {ReadableStream | AsyncIterable<string | Uint8Array> | string} source - Upstream SSE bytes or text.
 * @param {any} state - The `state` returned by `request`.
 * @returns {AsyncIterable<{event?: string, data: *}>} Client events.
 */
export function stream(source, state) {
	const c = capture(self, context, state.front);
	const endpoint = c.endpoint(state.upstream);
	const driver = c.driver(endpoint);
	const settings = c.settings(endpoint);
	const convert = c.converters(endpoint);
	const normalize = driver.chunk;
	const ctx = { endpoint, settings, state };
	if (convert && !normalize) return convert.stream(source, state.convert, settings);
	if (convert) {
		return convert.stream(
			(async function* () {
				for await (const message of messages(source)) {
					if (message.data !== "[DONE]") yield await normalize(message.data, ctx);
				}
			})(),
			state.convert,
			settings
		);
	}
	return (async function* () {
		for await (const message of messages(source)) {
			if (message.data === "[DONE]") {
				yield message;
				continue;
			}
			const data = normalize ? await normalize(message.data, ctx) : message.data;
			yield { ...message, data: restore(data, state.model) };
		}
	})();
}

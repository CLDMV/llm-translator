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
import * as vllm from "../lib/vllm.mjs";

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
 * Does a Chat Completions chunk end the answer: a choice with a `finish_reason`, or the usage-only chunk (`choices: []`)?
 * Text a driver is still holding has to go out before it.
 * @param {*} data - Chunk payload.
 * @returns {boolean} True for a finish or usage-only chunk.
 */
function ends(data) {
	return (
		Boolean(data) && Array.isArray(data.choices) && (data.choices.length === 0 || data.choices.some((choice) => choice?.finish_reason))
	);
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
	const convert = state.native ? null : c.converters(endpoint);
	const normalize = driver.chunk;
	const ctx = { endpoint, settings, state };
	/**
	 * Chunks the driver's normalizer was still holding when the stream ended (`flush(ctx)`), as upstream messages.
	 * @returns {AsyncGenerator<{data: *}>} Messages to emit before the stream closes.
	 */
	async function* flushed() {
		for (const held of (await driver.flush?.(ctx)) ?? []) yield { data: held };
	}
	if (convert && !normalize) return convert.stream(source, state.convert, settings);
	if (convert) {
		return convert.stream(
			(async function* () {
				for await (const message of messages(source)) {
					if (message.data !== "[DONE]") yield await normalize(message.data, ctx);
				}
				for await (const message of flushed()) yield message.data;
			})(),
			state.convert,
			settings
		);
	}
	// A driver that can hold text back (it has `flush`) may still release some after the finish and usage chunks, so those two are kept
	// back until the stream ends and go out after the released text: the answer is complete before it is finished.
	const holding = Boolean(normalize && driver.flush);
	const native = (async function* () {
		const tail = [];
		let closed = false;
		for await (const message of messages(source)) {
			if (message.data === "[DONE]") {
				// Held text goes out before the sentinel.
				for await (const held of flushed()) yield { data: restore(held.data, state.model) };
				yield* tail.splice(0);
				closed = true;
				yield message;
				continue;
			}
			const data = normalize ? await normalize(message.data, ctx) : message.data;
			const out = { ...message, data: restore(data, state.model) };
			if (holding && ends(data)) tail.push(out);
			else yield out;
		}
		if (!closed) {
			for await (const held of flushed()) yield { data: restore(held.data, state.model) };
			yield* tail;
		}
	})();
	return state.messages ? vllm.stream(native) : native;
}

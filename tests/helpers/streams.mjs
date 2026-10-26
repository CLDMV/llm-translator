/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/helpers/streams.mjs
 *	@Date: 2026-10-25T12:19:58-07:00 (1792955998)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:04-07:00 (1792958344)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * Collect an async (or sync) iterable into an array.
 * @param {AsyncIterable<any>|Iterable<any>} iterable - Source.
 * @returns {Promise<any[]>} Items.
 */
export async function collect(iterable) {
	const out = [];
	for await (const item of iterable) out.push(item);
	return out;
}

/**
 * Async generator over the given items.
 * @param {any[]} list - Items.
 * @returns {AsyncGenerator<any>} Generator.
 */
export async function* asyncOf(list) {
	for (const item of list) yield item;
}

/**
 * ReadableStream over the given chunks.
 * @param {(string|Uint8Array)[]} chunks - Chunks.
 * @returns {ReadableStream} Stream.
 */
export function readable(chunks) {
	let i = 0;
	return new ReadableStream({
		pull(controller) {
			if (i < chunks.length) controller.enqueue(chunks[i++]);
			else controller.close();
		}
	});
}

/**
 * Encode OpenAI chunk objects (and "[DONE]") as SSE text.
 * @param {(object|string)[]} chunks - Chunks.
 * @returns {string} SSE text.
 */
export function openaiSse(chunks) {
	return chunks.map((c) => `data: ${typeof c === "string" ? c : JSON.stringify(c)}\n\n`).join("");
}

/**
 * Encode Anthropic events as SSE text.
 * @param {{ event?: string, data: object }[]} events - Events (`event` defaults to `data.type`).
 * @returns {string} SSE text.
 */
export function anthropicSse(events) {
	return events.map((e) => `event: ${e.event ?? e.data.type}\ndata: ${JSON.stringify(e.data)}\n\n`).join("");
}

/**
 * Split text into fixed-size chunks (to exercise chunk boundaries).
 * @param {string} text - Text.
 * @param {number} size - Chunk size.
 * @returns {string[]} Chunks.
 */
export function slices(text, size) {
	const out = [];
	for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
	return out;
}

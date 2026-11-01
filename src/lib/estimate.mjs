/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/estimate.mjs
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
 * @fileoverview Token estimates for upstreams that cannot count tokens or did not report usage.
 * @module @cldmv/llm-translator/lib/estimate
 */

/** Characters per token in every estimate. */
export const CHARS_PER_TOKEN = 4;

/**
 * Tokens for a number of characters, at one token per four characters.
 * @param {number} characters - Character count.
 * @returns {number} Estimated tokens.
 */
export const tokens = (characters) => Math.ceil(characters / CHARS_PER_TOKEN);

/**
 * Rough prompt size: one token per four characters of the serialized system prompt, messages and tools.
 * @param {any} body - Upstream request body.
 * @returns {number} Estimated tokens.
 */
export function estimate(body) {
	return tokens(JSON.stringify([body.system, body.messages, body.tools]).length);
}

/**
 * Total length of the string parts.
 * @param {...unknown} parts - Values; anything that is not a string counts as 0.
 * @returns {number} Character count.
 */
const length = (...parts) => {
	let total = 0;
	for (const part of parts) if (typeof part === "string") total += part.length;
	return total;
};

/**
 * Characters of generated output in one client-protocol stream event.
 * @param {"anthropic" | "openai"} front - Client protocol.
 * @param {any} data - Event data.
 * @returns {number} Character count.
 */
export function eventLength(front, data) {
	if (front === "anthropic") {
		if (data?.type === "content_block_start") return length(data.content_block?.name);
		const delta = data?.type === "content_block_delta" ? data.delta : null;
		return length(delta?.text, delta?.thinking, delta?.partial_json);
	}
	const delta = data?.choices?.[0]?.delta;
	let total = length(delta?.content, delta?.reasoning, delta?.reasoning_content);
	for (const call of delta?.tool_calls ?? []) total += length(call.function?.name, call.function?.arguments);
	return total;
}

/**
 * Characters of generated output in a complete client-protocol reply body.
 * @param {"anthropic" | "openai"} front - Client protocol.
 * @param {any} body - Reply body.
 * @returns {number} Character count.
 */
export function bodyLength(front, body) {
	let total = 0;
	if (front === "anthropic") {
		for (const block of body?.content ?? []) {
			total += length(block.text, block.thinking, block.name);
			if (block.type === "tool_use") total += JSON.stringify(block.input).length;
		}
		return total;
	}
	const message = body?.choices?.[0]?.message;
	total = length(message?.content, message?.reasoning, message?.reasoning_content);
	for (const call of message?.tool_calls ?? []) total += length(call.function?.name, call.function?.arguments);
	return total;
}

/**
 * Output tokens for a character count. A reply always ends with at least one generated token, so the result is never 0.
 * @param {number} characters - Generated characters.
 * @returns {number} Estimated output tokens (at least 1).
 */
export const output = (characters) => Math.max(1, tokens(characters));

/**
 * Write estimated counts into a client-protocol usage object, replacing the zeros a converter wrote for usage the upstream did not carry.
 * @param {"anthropic" | "openai"} front - Client protocol.
 * @param {any} usage - Client usage object (the converter's), or undefined.
 * @param {{ input_tokens: number, output_tokens: number }} counts - Estimates.
 * @returns {any} A new usage object.
 */
export function patch(front, usage, counts) {
	if (front === "anthropic") return { ...usage, input_tokens: counts.input_tokens, output_tokens: counts.output_tokens };
	return {
		...usage,
		prompt_tokens: counts.input_tokens,
		completion_tokens: counts.output_tokens,
		total_tokens: counts.input_tokens + counts.output_tokens
	};
}

/**
 * Pass a converted client stream through and, when the upstream reported no usage, write estimates into its final usage: the
 * `message_delta` event on the Anthropic front, the usage-only chunk on the OpenAI front. Nothing else changes. The input estimate is
 * resolved when that event arrives (it may call the server's tokenizer), so a stream with real usage never pays for it.
 * @param {"anthropic" | "openai"} front - Client protocol.
 * @param {AsyncIterable<any>} events - Client events from the converter.
 * @param {{ missing: () => boolean, input: () => Promise<number>, report: (counts: { input_tokens: number, output_tokens: number }) => void }} hooks - `missing()` is true when the upstream reported nothing (valid once the converter reached its final usage), `input()` resolves the input estimate and `report(counts)` receives the estimates that were written.
 * @returns {AsyncGenerator<any, void, undefined>} Equivalent events.
 */
export async function* stream(front, events, hooks) {
	let characters = 0;
	for await (const item of events) {
		const data = item?.data;
		characters += eventLength(front, data);
		const last =
			front === "anthropic" ? data?.type === "message_delta" : Array.isArray(data?.choices) && data.choices.length === 0 && data.usage;
		if (last && hooks.missing()) {
			const counts = { input_tokens: await hooks.input(), output_tokens: output(characters) };
			hooks.report(counts);
			yield { ...item, data: { ...data, usage: patch(front, data.usage, counts) } };
		} else {
			yield item;
		}
	}
}

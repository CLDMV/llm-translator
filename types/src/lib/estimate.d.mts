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
export declare const CHARS_PER_TOKEN = 4;
/**
 * Tokens for a number of characters, at one token per four characters.
 * @param {number} characters - Character count.
 * @returns {number} Estimated tokens.
 */
export declare const tokens: (characters: number) => number;
/**
 * Rough prompt size: one token per four characters of the serialized system prompt, messages and tools.
 * @param {any} body - Upstream request body.
 * @returns {number} Estimated tokens.
 */
export declare function estimate(body: any): number;
/**
 * Characters of generated output in one client-protocol stream event.
 * @param {"anthropic" | "openai"} front - Client protocol.
 * @param {any} data - Event data.
 * @returns {number} Character count.
 */
export declare function eventLength(front: "anthropic" | "openai", data: any): number;
/**
 * Characters of generated output in a complete client-protocol reply body.
 * @param {"anthropic" | "openai"} front - Client protocol.
 * @param {any} body - Reply body.
 * @returns {number} Character count.
 */
export declare function bodyLength(front: "anthropic" | "openai", body: any): number;
/**
 * Output tokens for a character count. A reply always ends with at least one generated token, so the result is never 0.
 * @param {number} characters - Generated characters.
 * @returns {number} Estimated output tokens (at least 1).
 */
export declare const output: (characters: number) => number;
/**
 * Write estimated counts into a client-protocol usage object, replacing the zeros a converter wrote for usage the upstream did not carry.
 * @param {"anthropic" | "openai"} front - Client protocol.
 * @param {any} usage - Client usage object (the converter's), or undefined.
 * @param {{ input_tokens: number, output_tokens: number }} counts - Estimates.
 * @returns {any} A new usage object.
 */
export declare function patch(front: "anthropic" | "openai", usage: any, counts: {
    input_tokens: number;
    output_tokens: number;
}): any;
/**
 * Pass a converted client stream through and, when the upstream reported no usage, write estimates into its final usage: the
 * `message_delta` event on the Anthropic front, the usage-only chunk on the OpenAI front. Nothing else changes. The input estimate is
 * resolved when that event arrives (it may call the server's tokenizer), so a stream with real usage never pays for it.
 * @param {"anthropic" | "openai"} front - Client protocol.
 * @param {AsyncIterable<any>} events - Client events from the converter.
 * @param {{ missing: () => boolean, input: () => Promise<number>, report: (counts: { input_tokens: number, output_tokens: number }) => void }} hooks - `missing()` is true when the upstream reported nothing (valid once the converter reached its final usage), `input()` resolves the input estimate and `report(counts)` receives the estimates that were written.
 * @returns {AsyncGenerator<any, void, undefined>} Equivalent events.
 */
export declare function stream(front: "anthropic" | "openai", events: AsyncIterable<any>, hooks: {
    missing: () => boolean;
    input: () => Promise<number>;
    report: (counts: {
        input_tokens: number;
        output_tokens: number;
    }) => void;
}): AsyncGenerator<any, void, undefined>;

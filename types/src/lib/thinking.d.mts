/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/thinking.mjs
 *	@Date: 2026-10-25T12:28:19-07:00 (1792956499)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:02-07:00 (1792958342)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * Create the signature attached to a thinking block produced from upstream reasoning. It is clearly marked as not
 * coming from Anthropic.
 * @returns {string} Signature string.
 */
export declare function sign(): string;
/**
 * Whether a signature was produced by {@link sign}.
 * @param {unknown} signature - Signature value.
 * @returns {boolean} True for translator-made signatures.
 */
export declare function isOurs(signature: unknown): boolean;
/**
 * Reasoning text carried by an OpenAI message or delta (`reasoning` or the older `reasoning_content`).
 * @param {{ reasoning?: unknown, reasoning_content?: unknown }|undefined} part - Message or delta.
 * @returns {string} Reasoning text ("" when absent).
 */
export declare function reasoningOf(part: {
    reasoning?: unknown;
    reasoning_content?: unknown;
} | undefined): string;
/**
 * Split a complete content string into reasoning and answer. Only a LEADING `<think>...</think>` is recognised
 * (whitespace before it and after it is ignored); an unterminated `<think>` treats everything as reasoning.
 * @param {string} content - Full message content.
 * @returns {{ reasoning: string, text: string }} Split result.
 */
export declare function splitThink(content: string): {
    reasoning: string;
    text: string;
};
/**
 * Incremental version of {@link splitThink} for streamed content. Feed content deltas to `push()` and call `end()`
 * once; each call returns `{ reasoning, text }` pieces that are safe to emit now (partial tags are held back).
 * @returns {{ push: (delta: string) => { reasoning: string, text: string }, end: () => { reasoning: string, text: string } }} Splitter.
 */
export declare function createThinkSplitter(): {
    push: (delta: string) => {
        reasoning: string;
        text: string;
    };
    end: () => {
        reasoning: string;
        text: string;
    };
};

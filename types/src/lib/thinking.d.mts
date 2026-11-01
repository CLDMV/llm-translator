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
 *
 * With `open` the output is taken to start inside a thought (the chat template already wrote `<think>` into the
 * generation prompt): everything before the first `</think>` is reasoning. When no `</think>` appears the whole
 * content is answer text. A literal leading `<think>` is still honoured.
 * @param {string} content - Full message content.
 * @param {boolean} [open] - The output starts inside a thought.
 * @returns {{ reasoning: string, text: string }} Split result.
 */
export declare function splitThink(content: string, open?: boolean): {
    reasoning: string;
    text: string;
};
/**
 * Incremental version of {@link splitThink} for streamed content. Feed content deltas to `push()` and call `end()`
 * once; each call returns `{ reasoning, text }` pieces that are safe to emit now (partial tags are held back).
 *
 * With `open` (see {@link splitThink}) nothing is emitted until the first `</think>` arrives, because only then is it known
 * that the content so far was reasoning; if the stream ends first, everything held is released as answer text.
 * @param {boolean} [open] - The output starts inside a thought.
 *
 * `release()` stops splitting: anything held is returned as text and all later content passes through as text (used once the server
 * sends reasoning in its own field, when content is never split). `pending()` is true while, with `open`, it is not yet known whether
 * the content so far is reasoning.
 * @returns {{ push: (delta: string) => { reasoning: string, text: string }, end: () => { reasoning: string, text: string }, release: () => { reasoning: string, text: string }, pending: () => boolean }} Splitter.
 */
export declare function createThinkSplitter(open?: boolean): {
    push: (delta: string) => {
        reasoning: string;
        text: string;
    };
    end: () => {
        reasoning: string;
        text: string;
    };
    release: () => {
        reasoning: string;
        text: string;
    };
    pending: () => boolean;
};

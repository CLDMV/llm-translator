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
/** `format` of the `reasoning_details` items that carry an Anthropic thinking block (text with its signature) or redacted thinking (data). */
export declare const ANTHROPIC_FORMAT = "anthropic-claude-v1";
/**
 * Create the signature attached to a thinking block produced from upstream reasoning. It is clearly marked as not coming from Anthropic.
 *
 * Format: `llmt:` followed by the base64url of a JSON payload `{"v":1}`, or `{"v":1,"d":{...}}` when provider reasoning data has to come
 * back with the block. `d` holds only `reasoning_content` and `reasoning` (strings) and `reasoning_details` (a list of JSON objects).
 * A payload longer than 512 characters is deflated and written as `llmt:~` plus base64url. When the result would exceed 256 KiB the data
 * is left out and the plain marker is returned.
 * @param {{ reasoning_content?: string, reasoning?: string, reasoning_details?: object[] }} [data] - Provider reasoning data to carry.
 * @returns {string} Signature string.
 */
export declare function sign(data?: {
    reasoning_content?: string;
    reasoning?: string;
    reasoning_details?: object[];
}): string;
/**
 * Whether a signature was produced by {@link sign}.
 * @param {unknown} signature - Signature value.
 * @returns {signature is string} True for translator-made signatures.
 */
export declare function isOurs(signature: unknown): signature is string;
/**
 * Read the provider reasoning data out of a signature made by {@link sign}. Strict: the signature must carry the mark, be within the size
 * limits and decode to `{"v":1,"d":{...}}` with only the known fields, each well formed; anything else (a real Anthropic signature, a plain
 * marker, a forged or garbled one) gives null and the caller falls back to the thinking text.
 * @param {unknown} signature - Signature value from a thinking block.
 * @returns {Promise<{ reasoning_content?: string, reasoning?: string, reasoning_details?: object[] } | null>} The data, or null.
 */
export declare function unsign(signature: unknown): Promise<{
    reasoning_content?: string;
    reasoning?: string;
    reasoning_details?: object[];
} | null>;
/**
 * The `reasoning_details` item for an Anthropic thinking block or redacted thinking block, in the form an OpenAI client replays.
 * @param {any} block - Anthropic `thinking` or `redacted_thinking` content block (with its signature or data).
 * @param {number} index - Position among the message's reasoning items.
 * @returns {object | null} The item, or null for a block that cannot be replayed (no signature or data).
 */
export declare function detailOf(block: any, index: number): object | null;
/**
 * Anthropic thinking and redacted thinking blocks from the `reasoning_details` an OpenAI client replayed. Strict: only items in this
 * translator's Anthropic format with the expected string fields become blocks, only their known fields are copied, and at most 64 items
 * totalling 1 MiB of text are taken; anything else is ignored.
 * @param {unknown} details - `reasoning_details` of an assistant message.
 * @returns {any[]} Anthropic content blocks (possibly empty).
 */
export declare function blocksOf(details: unknown): any[];
/**
 * Which field of an OpenAI message or delta carries its reasoning text (`reasoning` or the older `reasoning_content`), if any.
 * @param {{ reasoning?: unknown, reasoning_content?: unknown }|undefined} part - Message or delta.
 * @returns {"reasoning"|"reasoning_content"|null} Field name.
 */
export declare function reasoningKey(part: {
    reasoning?: unknown;
    reasoning_content?: unknown;
} | undefined): "reasoning" | "reasoning_content" | null;
/**
 * Readable text of a `reasoning_details` list (`reasoning.text` and `reasoning.summary` items), for a thinking block whose reasoning
 * arrived only as structured details.
 * @param {unknown} details - `reasoning_details` value.
 * @returns {string} Concatenated text ("" for encrypted-only details).
 */
export declare function detailsText(details: unknown): string;
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

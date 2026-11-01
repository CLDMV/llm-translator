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
 * Format: `llmt:` followed by the base64url of a JSON payload `{"v":1}`, or `{"v":1,"p":"<producer>","d":{...}}` when provider reasoning data has to
 * come back with the block. `p` names the driver and protocol that produced the data (so it is restored only for the same producer) and `d` holds
 * one text field (`reasoning_content` or `reasoning`) and/or `reasoning_details`. A payload longer than 512 bytes is deflated and written
 * as `llmt:~` plus base64url, unless that would not shrink it or would exceed the 30:1 inflation ratio {@link unsign} accepts. Data that
 * {@link unsign} would reject (over the size limits, unknown shape) or a result over 256 KiB leaves the plain marker.
 * @param {{ reasoning_content?: string, reasoning?: string, reasoning_details?: object[] }} [data] - Provider reasoning data to carry.
 * @param {string} [producer] - Producer binding, `driver:protocol:host`.
 * @returns {string} Signature string.
 */
export declare function sign(data?: {
    reasoning_content?: string;
    reasoning?: string;
    reasoning_details?: object[];
}, producer?: string): string;
/**
 * Whether a signature was produced by {@link sign}.
 * @param {unknown} signature - Signature value.
 * @returns {signature is string} True for translator-made signatures.
 */
export declare function isOurs(signature: unknown): signature is string;
/**
 * The limits on decoding signatures within one request, shared by every conversion of it (retries and failover included): how many bytes may be
 * inflated or decoded in total, how many marked signatures may be decoded, and how many decodes may fail before decoding stops for the rest of the
 * request. Bytes are charged before a signature is inflated (the most it could produce) and refunded down to what it did produce, so a signature that
 * fails still costs. Results are cached by producer and signature, so converting the same request again costs nothing. Once the budget is spent the
 * caller falls back to the thinking text.
 * Decodes on one budget run one at a time (each waits for the one before it), so concurrent callers cannot get past the checks together.
 * @returns {{ bytes: number, signatures: number, failures: number, cache: Map<string, any>, queue: Promise<void> }} A fresh budget for one request.
 */
export declare function createBudget(): {
    bytes: number;
    signatures: number;
    failures: number;
    cache: Map<string, any>;
    queue: Promise<void>;
};
/**
 * Read the provider reasoning data out of a signature made by {@link sign}. Strict: the signature must carry the mark, be within the size
 * limits and decode to `{"v":1,"p":...,"d":{...}}` with only the known fields, each well formed, and its producer must equal `producer`
 * (a payload with no producer is returned only when none is given). Anything else (a real Anthropic signature, a plain marker, a forged, garbled or
 * foreign one) gives null and the caller falls back to the thinking text. Inflation is bounded while it runs: by 1 MiB per signature, by the rest of
 * the per-request budget, and by a 30:1 ratio of output to compressed input, so a small signature cannot expand into a large allocation; after a few
 * failed decodes the rest of the request is not decoded at all. Calls that share a budget are queued, so they are safe to make concurrently.
 * @param {unknown} signature - Signature value from a thinking block.
 * @param {{ producer?: string, budget?: ReturnType<typeof createBudget> }} [options] - `producer` is the current `driver:protocol:host`; `budget` is shared by all signatures of one request (see {@link createBudget}).
 * @returns {Promise<{ reasoning_content?: string, reasoning?: string, reasoning_details?: object[] } | null>} The data, or null.
 */
export declare function unsign(signature: unknown, { producer, budget }?: {
    producer?: string;
    budget?: ReturnType<typeof createBudget>;
}): Promise<{
    reasoning_content?: string;
    reasoning?: string;
    reasoning_details?: object[];
} | null>;
/**
 * The `reasoning_details` item for an Anthropic thinking block or redacted thinking block, in the form an OpenAI client replays.
 * @param {any} block - Anthropic `thinking` or `redacted_thinking` content block (with its signature or data).
 * @param {number} index - Position among what the OpenAI message shows: 0 before the text, 1 after it (or before the first tool call when there is no text), then one more for each tool call.
 * @returns {object | null} The item, or null for a block that cannot be replayed (no signature or data).
 */
export declare function detailOf(block: any, index: number): object | null;
/**
 * Anthropic thinking and redacted thinking blocks from the `reasoning_details` an OpenAI client replayed. Strict: only items in this
 * translator's Anthropic format with the expected string fields become blocks, only their known fields are copied, and at most 64 items
 * totalling 1 MiB of text are taken; anything else is ignored.
 * @param {unknown} details - `reasoning_details` of an assistant message.
 * @returns {{ at: number, block: any }[]} Anthropic content blocks with the position (`index`) they had in the original message, which the caller uses to keep thinking in place between the text and the tool calls (possibly empty).
 */
export declare function blocksOf(details: unknown): {
    at: number;
    block: any;
}[];
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
 * Add a streamed `reasoning_details` fragment to the list being built, so a stream yields the same items as a JSON reply. Fragments with the
 * same `index` and `type` are one item: `text` and `summary` are concatenated and `signature`, `data`, `format` and `id` are taken from the
 * fragment that carries them. A fragment without an `index`, or a new one, is appended; anything that is not an object is skipped.
 * @param {any[]} list - Items so far (mutated).
 * @param {any} fragment - One element of a streamed `reasoning_details` array.
 * @returns {any[]} The same list.
 */
export declare function mergeDetail(list: any[], fragment: any): any[];
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

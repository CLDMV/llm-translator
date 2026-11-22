/**
 * The base URL without the Compatibility API's path root, which is where the native API (`/v2/chat`) and the model list (`/v1/models`) live.
 * @param {string} base - The upstream's base URL.
 * @returns {string} The URL without a trailing `/compatibility`.
 */
export function rootOf(base: string): string;
/**
 * Whether a client request uses something only Cohere's own protocol has, so an `auto` upstream sends it over `cohere.chat` instead of the
 * Compatibility API: a thinking budget, a reasoning effort other than `none` and `high` (the two the Compatibility API takes), one of Cohere's
 * own fields (`documents`, `citation_options`, `safety_mode`, `priority`, `strict_tools`, `logprobs`), a tool choice, a switch against parallel tool
 * calls, structured output next to tools, or a `document` or `search_result` block that asks for citations.
 * @param {any} body - Client request body (either front).
 * @returns {boolean} True when the request needs `cohere.chat`.
 */
export function needsNative(body: any): boolean;
/**
 * Convert a Chat Completions request body to a Cohere `/v2/chat` body. `max_tokens` is the same field, `top_p` is `p`, `top_k` is `k`, `stop`
 * is `stop_sequences`, tools keep their JSON schema, `tool_choice` `required` and `none` are `REQUIRED` and `NONE`, and a named tool is `REQUIRED`
 * with only that tool offered (Cohere cannot force one of several any other way). `response_format` `json_object` and `json_schema` are a
 * `json_object` format with the schema; Cohere does not take it with tools or documents, so there it is a system instruction to answer in that
 * JSON. `logprobs` is `logprobs`, and `parallel_tool_calls: false` is kept on the state for the reply converters (Cohere has no such field, so they
 * keep the first tool call only). Thinking comes from `context` or `reasoning_effort` (see `thinkingOf`), sampling values are moved into Cohere's
 * ranges (named in `context.clamped`), and `documents`, `citation_options`, `safety_mode`, `priority` and `strict_tools` on the body are Cohere's own
 * fields and go through. Content parts tagged as request sources (`lib/citations.mjs`) that asked for citations are `documents` of their own, or
 * `document` blocks in a tool result, and a tool result that failed (the tool error marker) is `{ "error": ... }`. The extension sampling fields
 * (`sampling`) are Cohere's own field names and go in as given; anything the request names wins. What Cohere has no field for (`n` above 1, which the
 * translator answers by fan-out, `logit_bias`, `top_logprobs`, ...) is left out and named in `dropped`.
 * @param {any} body - Chat Completions request body.
 * @param {{ dropped?: string[], clamped?: string[], sampling?: Record<string, any>, thinking?: string | null, thinkingBudget?: number, marker?: string, state?: any }} [context] - `dropped` collects the names of what was left out and `clamped` the names of the values that were moved into Cohere's ranges; `sampling` are extension fields; `thinking` and `thinkingBudget` are an Anthropic request's thinking mode and token budget; `marker` is the text that marks a failed tool result; `state` is the conversion state, which gets `documents` (what each document id was), `tools` (the position of each tool result) and `singleCall`.
 * @returns {any} Cohere request body.
 */
export function chatBody(body: any, context?: {
    dropped?: string[];
    clamped?: string[];
    sampling?: Record<string, any>;
    thinking?: string | null;
    thinkingBudget?: number;
    marker?: string;
    state?: any;
}): any;
/**
 * Chat Completions `finish_reason` for a Cohere `finish_reason`: `COMPLETE` and `STOP_SEQUENCE` are `stop`, `MAX_TOKENS` is `length` and
 * `TOOL_CALL` is `tool_calls`. A reply that called tools is `tool_calls`.
 * @param {string | undefined} reason - Cohere `finish_reason`.
 * @param {boolean} calls - Whether the reply carried tool calls.
 * @returns {string} `finish_reason`.
 */
export function finishOf(reason: string | undefined, calls: boolean): string;
/**
 * The failure a finished Cohere reply reports: `ERROR` (502) and `TIMEOUT` (504) as finish reasons, or an `error` in the stream's final event.
 * @param {string | undefined} reason - Cohere `finish_reason`.
 * @param {any} [error] - The `error` the final event carries, when it has one.
 * @returns {TranslatorError | null} The error, or null for a reply that finished.
 */
export function failureOf(reason: string | undefined, error?: any): TranslatorError | null;
/**
 * Chat Completions usage from a Cohere `usage` object: the model's own token counts (`tokens`), else the billed ones (`billed_units`), and the
 * cached prompt tokens (`cached_tokens`) as `prompt_tokens_details.cached_tokens`. The input count is taken to include the cached tokens, as
 * Chat Completions' `prompt_tokens` does.
 * @param {any} usage - Cohere `usage`.
 * @returns {{prompt_tokens: number, completion_tokens: number, total_tokens: number, prompt_tokens_details?: {cached_tokens: number}} | undefined} Usage, or undefined when there are no counts.
 */
export function usageOf(usage: any): {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: {
        cached_tokens: number;
    };
} | undefined;
/**
 * The same counts as Anthropic usage, which is what the OpenAI front's usage report reads from a converted reply (the cached tokens are not in
 * `input_tokens`, as for Anthropic).
 * @param {any} usage - Cohere `usage`.
 * @returns {{input_tokens: number, output_tokens: number, cache_read_input_tokens: number, cache_creation_input_tokens: number} | undefined} Anthropic usage, or undefined when there are no counts.
 */
export function folded(usage: any): {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
} | undefined;
/**
 * Chat Completions `logprobs` entries for the log probabilities Cohere reports. Cohere gives, for a piece of the reply, its text, the token ids and one
 * log probability per token; the tokens' own strings are not given, so the text is the first token's and the others are empty strings (the tokens
 * join back to the text), and there are no top alternatives.
 * @param {any} items - Cohere `logprobs` (a list of `{ token_ids, text, logprobs }`) or one item.
 * @returns {{ token: string, logprob: number, bytes: number[], top_logprobs: [] }[]} Entries.
 */
export function logprobsOf(items: any): {
    token: string;
    logprob: number;
    bytes: number[];
    top_logprobs: [];
}[];
/**
 * The neutral citations of one Cohere citation: one for each source it names. `document` sources are the documents of the request (the state says
 * what each id was: a `document` or `search_result` block, with its position) or documents a client sent itself, and `tool` sources are tool results
 * (a `search_result` whose `source` is the tool call id).
 * @param {any} citation - Cohere citation (`start`, `end`, `sources`).
 * @param {number} base - Where the text the citation's offsets count from starts in the reply text.
 * @param {any} [state] - Conversion state (`documents`, `tools`).
 * @returns {import("./citations.mjs").Citation[]} Neutral citations spanning the cited text.
 */
export function citationsOf(citation: any, base: number, state?: any): import("./citations.mjs").Citation[];
/**
 * Convert a (non-streaming) Cohere reply to a Chat Completions `chat.completion`: text blocks are joined into the content, `thinking` blocks go
 * in the settings' reasoning field, `tool_calls` become tool calls, `finish_reason` becomes `finish_reason`, `usage` becomes `usage` and `logprobs`
 * become `choices[0].logprobs`. The `tool_plan` (the sentence the model writes before a tool call) is the start of the content, and `citations`
 * are `annotations` (neutral citations, see `lib/citations.mjs`) spanning the text they cite; a citation of the model's thinking has no place in
 * Chat Completions and is left out.
 * @param {any} reply - Parsed Cohere reply.
 * @param {{ reasoningField?: string, model?: string, state?: any }} [options] - `reasoningField` is where the reasoning goes (default `reasoning`); `model` is the model name on the completion; `state` is the conversion state (`documents`, `tools`, `singleCall`).
 * @returns {any} `chat.completion` object.
 * @throws {TranslatorError} `invalid_upstream_response` (502) when the reply has no message, `upstream_error` (502) or `upstream_timeout` (504) when it ended in a failure.
 */
export function completion(reply: any, options?: {
    reasoningField?: string;
    model?: string;
    state?: any;
}): any;
/**
 * Create the converter of a Cohere stream's events into Chat Completions chunks. One chunker is for one reply: it keeps the completion id (so
 * every chunk carries the same one), whether any tool was called and how much text has been sent (citations count from it). The `tool-plan-delta`
 * events are content text (a blank line separates the plan from content that follows it), `citation-start` events are `annotations` chunks,
 * `content-delta` log probabilities are `logprobs`, and the `debug` events are not carried over.
 * @param {{ model?: string, reasoningField?: string, includeUsage?: boolean, state?: any }} [options] - `model` is the model name on the chunks; `reasoningField` is where the reasoning goes (default `reasoning`); `includeUsage` (default true) adds the final usage chunk; `state` is the conversion state (`documents`, `tools`, `singleCall`).
 * @returns {{ event: (name: string | undefined, data: any) => any[], finished: () => boolean, usage: () => any }} `event` gives the chunks one event produces (a failure gives one `{ error }` chunk), `finished` says whether the reply ended (`message-end`, or a failure) and `usage` is the Cohere `usage` of the `message-end` event.
 */
export function createChunker(options?: {
    model?: string;
    reasoningField?: string;
    includeUsage?: boolean;
    state?: any;
}): {
    event: (name: string | undefined, data: any) => any[];
    finished: () => boolean;
    usage: () => any;
};
/**
 * The text of a request body that the model reads, for a tokenizer: system, user, assistant and tool message text, reasoning, tool plans, tool
 * call names and arguments, tool definitions and documents. It reads a Cohere body and a Chat Completions body alike.
 * @param {any} body - Request body.
 * @returns {string[]} The pieces of text, in order.
 */
export function promptText(body: any): string[];
/**
 * Cut a text into pieces of at most `size` characters, never between the two halves of a surrogate pair.
 * @param {string} text - The text.
 * @param {number} size - Most characters in a piece.
 * @returns {string[]} The pieces (none for an empty text).
 */
export function chunksOf(text: string, size: number): string[];
/** Host names Cohere's API answers on. */
export const HOSTS: string[];
/** Path root of the OpenAI Compatibility API. */
export const COMPATIBILITY: "/compatibility";
/**
 * What the messages of one request leave for the body and the conversion state: the Cohere documents made from request sources, and the
 * facts the reply converters need to name them again.
 */
export type Gathered = {
    /**
     * - Documents by id: the Cohere document, the texts it is made of and whether it goes in the request's `documents`.
     */
    documents: Map<string, {
        doc: {
            id: string;
            data: Record<string, any>;
        };
        texts: string[];
        top: boolean;
    }>;
    /**
     * - What each document was, by id (JSON-safe, kept in the state).
     */
    info: Record<string, {
        kind: string;
        index: number;
        title?: string;
        source?: string;
        length: number;
        blocks?: number;
    }>;
    /**
     * - Position of each tool result, by tool call id.
     */
    tools: Record<string, number>;
    /**
     * - Text that marks a failed tool result.
     */
    marker: string | undefined;
};
import { TranslatorError } from "./errors.mjs";

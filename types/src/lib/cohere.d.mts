/**
 * The base URL without the Compatibility API's path root, which is where the native API (`/v2/chat`) and the model list (`/v1/models`) live.
 * @param {string} base - The upstream's base URL.
 * @returns {string} The URL without a trailing `/compatibility`.
 */
export function rootOf(base: string): string;
/**
 * Convert a Chat Completions request body to a Cohere `/v2/chat` body. `max_tokens` is the same field, `top_p` is `p`, `top_k` is `k`, `stop`
 * is `stop_sequences`, tools keep their JSON schema, `tool_choice` `required` and `none` are `REQUIRED` and `NONE`, `response_format`
 * `json_object` and `json_schema` are a `json_object` format with the schema, and thinking comes from `context` or `reasoning_effort`. The
 * extension sampling fields (`sampling`) are Cohere's own field names and go in as given; anything the request names wins. What Cohere has
 * no field for (forcing one named tool, `n`, `parallel_tool_calls`, `logit_bias`, `response_format` together with tools, reasoning from an
 * unsigned history, ...) is left out and named in `dropped`.
 * @param {any} body - Chat Completions request body.
 * @param {{ dropped?: string[], sampling?: Record<string, any>, thinking?: string | null, thinkingBudget?: number }} [context] - `dropped` collects the names of what was left out; `sampling` are extension fields; `thinking` and `thinkingBudget` are an Anthropic request's thinking mode and token budget.
 * @returns {any} Cohere request body.
 */
export function chatBody(body: any, context?: {
    dropped?: string[];
    sampling?: Record<string, any>;
    thinking?: string | null;
    thinkingBudget?: number;
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
 * Chat Completions usage from a Cohere `usage` object: the model's own token counts (`tokens`), else the billed ones (`billed_units`).
 * @param {any} usage - Cohere `usage`.
 * @returns {{prompt_tokens: number, completion_tokens: number, total_tokens: number} | undefined} Usage, or undefined when there are no counts.
 */
export function usageOf(usage: any): {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
} | undefined;
/**
 * The same counts as Anthropic usage, which is what the OpenAI front's usage report reads from a converted reply.
 * @param {any} usage - Cohere `usage`.
 * @returns {{input_tokens: number, output_tokens: number} | undefined} Anthropic usage, or undefined when there are no counts.
 */
export function folded(usage: any): {
    input_tokens: number;
    output_tokens: number;
} | undefined;
/**
 * Convert a (non-streaming) Cohere reply to a Chat Completions `chat.completion`: text blocks are joined into the content, `thinking` blocks go
 * in the settings' reasoning field, `tool_calls` become tool calls, `finish_reason` becomes `finish_reason` and `usage` becomes `usage`. The
 * `tool_plan` (the sentence the model writes before a tool call) and `citations` are not carried over.
 * @param {any} reply - Parsed Cohere reply.
 * @param {{ reasoningField?: string, model?: string }} [options] - `reasoningField` is where the reasoning goes (default `reasoning`); `model` is the model name on the completion.
 * @returns {any} `chat.completion` object.
 * @throws {TranslatorError} `invalid_upstream_response` (502) when the reply has no message, `upstream_error` (502) or `upstream_timeout` (504) when it ended in a failure.
 */
export function completion(reply: any, options?: {
    reasoningField?: string;
    model?: string;
}): any;
/**
 * Create the converter of a Cohere stream's events into Chat Completions chunks. One chunker is for one reply: it keeps the completion id (so
 * every chunk carries the same one) and whether any tool was called. The `tool-plan-delta`, citation and `debug` events are not carried over.
 * @param {{ model?: string, reasoningField?: string, includeUsage?: boolean }} [options] - `model` is the model name on the chunks; `reasoningField` is where the reasoning goes (default `reasoning`); `includeUsage` (default true) adds the final usage chunk.
 * @returns {{ event: (name: string | undefined, data: any) => any[], finished: () => boolean, usage: () => any }} `event` gives the chunks one event produces (a failure gives one `{ error }` chunk), `finished` says whether the reply ended (`message-end`, or a failure) and `usage` is the Cohere `usage` of the `message-end` event.
 */
export function createChunker(options?: {
    model?: string;
    reasoningField?: string;
    includeUsage?: boolean;
}): {
    event: (name: string | undefined, data: any) => any[];
    finished: () => boolean;
    usage: () => any;
};
/** Host names Cohere's API answers on. */
export const HOSTS: string[];
/** Path root of the OpenAI Compatibility API. */
export const COMPATIBILITY: "/compatibility";
import { TranslatorError } from "./errors.mjs";

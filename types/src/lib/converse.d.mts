/**
 * Convert a Chat Completions request body to a Converse body (`messages`, `system`, `inferenceConfig`, `toolConfig` and
 * `additionalModelRequestFields`; the model id and the choice of streaming belong to the URL, so neither is in the body). `max_tokens`,
 * `temperature`, `top_p` and `stop` become `inferenceConfig`, tools become `toolConfig` (`tool_choice` `auto`, `required` and one named function
 * map to `auto`, `any` and `tool`), images are sent as bytes, and `top_k`, the extension sampling fields and a thinking budget go in
 * `additionalModelRequestFields`, which carries a model's own parameters. Converse has no field for `response_format`, so a `json_schema` (or
 * `json_object`, as any object) is sent as one more tool whose input schema is the schema, with the tool choice forced to it (to any tool when the
 * request has tools of its own, so those still work); the reply converters read a call of that tool as the answer text (`jsonTool`, see `completion`).
 * Signed reasoning in an assistant message (`reasoning_details`) is sent back as `reasoningContent`. What Converse has no field for (`n`,
 * `parallel_tool_calls`, `seed`, penalties, images given by URL, reasoning text without a signature, ...) is left out and named in `dropped`.
 * Converse needs a `toolConfig` whenever the history has tool blocks and has no "none" choice, so: a request without tools has its past tool calls
 * and results written as text, and `tool_choice: "none"` with tools sends the `toolConfig` and adds a system instruction not to call tools.
 * @param {any} body - Chat Completions request body.
 * @param {{ dropped?: string[], sampling?: Record<string, any>, thinkingBudget?: number, marker?: string, cache?: boolean, state?: any }} [context] - `dropped` collects the names of what was left out; `sampling` are extension fields for `additionalModelRequestFields`; `thinkingBudget` is the token budget of enabled thinking, sent as `thinking: { type: "enabled", budget_tokens }`; `marker` is the text that marks a failed tool result; `cache` turns the `cache_point` markers of the messages, system message and tools into `cachePoint` blocks (at most four are kept); `state` gets `jsonTool`, the name of the tool a `response_format` is sent as.
 * @returns {any} Converse request body.
 */
export function chatBody(body: any, context?: {
    dropped?: string[];
    sampling?: Record<string, any>;
    thinkingBudget?: number;
    marker?: string;
    cache?: boolean;
    state?: any;
}): any;
/**
 * Chat Completions `finish_reason` for a Converse `stopReason`: `end_turn` and `stop_sequence` are `stop`, `max_tokens` and
 * `model_context_window_exceeded` are `length`, `tool_use` is `tool_calls`, `content_filtered` and `guardrail_intervened` are `content_filter`,
 * and `malformed_model_output` and `malformed_tool_use` are `error` (a failure, not an answer). A reply that called tools is `tool_calls`.
 * @param {string | undefined} reason - Converse `stopReason`.
 * @param {boolean} calls - Whether the reply carried tool calls.
 * @returns {string} `finish_reason`.
 */
export function finishOf(reason: string | undefined, calls: boolean): string;
/**
 * Chat Completions usage from a Converse `usage` object. Converse counts cache reads and writes apart from `inputTokens`; the prompt is all three.
 * @param {any} usage - Converse `usage`.
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
 * The same counts as Anthropic usage, which is what the OpenAI front's usage report reads from a converted reply (Converse reports them the
 * way Anthropic does: `inputTokens` leaves out the cache).
 * @param {any} usage - Converse `usage`.
 * @returns {{input_tokens: number, output_tokens: number, cache_read_input_tokens: number, cache_creation_input_tokens: number} | undefined} Anthropic usage, or undefined when there are no counts.
 */
export function folded(usage: any): {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
} | undefined;
/**
 * Convert a (non-streaming) Converse reply to a Chat Completions `chat.completion`: text blocks are joined into the content, reasoning blocks go
 * in the settings' reasoning field and, with their signatures (and redacted blocks), in `reasoning_details` so they can be sent back, `toolUse` blocks become tool calls, `stopReason` becomes `finish_reason` and
 * `usage` becomes `usage`.
 * @param {any} reply - Parsed Converse reply.
 * @param {{ reasoningField?: string, model?: string, jsonTool?: string }} [options] - `reasoningField` is where the reasoning goes (default `reasoning`); `model` is the model name on the completion; `jsonTool` is the name of the tool a `response_format` was sent as (see `chatBody`), whose call becomes the content.
 * @returns {any} `chat.completion` object.
 * @throws {TranslatorError} `invalid_upstream_response` (502) when the reply has no message.
 */
export function completion(reply: any, options?: {
    reasoningField?: string;
    model?: string;
    jsonTool?: string;
}): any;
/**
 * Create the converter of a ConverseStream's events into Chat Completions chunks. One chunker is for one reply: it keeps the completion id
 * (so every chunk carries the same one), the numbering of tool calls and which content block each belongs to.
 * @param {{ model?: string, reasoningField?: string, includeUsage?: boolean, jsonTool?: string }} [options] - `model` is the model name on the chunks; `reasoningField` is where the reasoning goes (default `reasoning`); `includeUsage` (default true) adds the final usage chunk; `jsonTool` is the name of the tool a `response_format` was sent as, whose call streams as content text.
 * @returns {{ event: (name: string | undefined, data: any) => any[], finished: () => boolean, usage: () => any }} `event` gives the chunks one event produces (an Anthropic-shaped `error` message gives one `{ error }` chunk), `finished` says whether the reply ended (`messageStop`, or a failure) and `usage` is the Converse `usage` of the `metadata` event.
 */
export function createChunker(options?: {
    model?: string;
    reasoningField?: string;
    includeUsage?: boolean;
    jsonTool?: string;
}): {
    event: (name: string | undefined, data: any) => any[];
    finished: () => boolean;
    usage: () => any;
};

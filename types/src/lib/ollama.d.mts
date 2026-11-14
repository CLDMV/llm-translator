/**
 * Convert a Chat Completions request body to an Ollama `/api/chat` body. Ollama streams unless told not to, so `stream` is always set. Tool
 * arguments become objects, tool results name their tool, images go in `images` as base64, `max_tokens` becomes `options.num_predict`, the
 * sampling fields go in `options`, `response_format` becomes `format` and the effort or thinking switch becomes `think`. What Ollama has no
 * field for (`tool_choice` other than `auto`, `n`, `logit_bias`, `logprobs`, images given by URL, ...) is left out and named in `dropped`;
 * `tool_choice: "none"` also removes the tools, so a call the client forbade cannot happen.
 * @param {any} body - Chat Completions request body.
 * @param {{ dropped?: string[], sampling?: Record<string, any> }} [context] - `dropped` collects the names of what was left out; `sampling` are extension sampling fields for `options`.
 * @returns {any} Ollama request body.
 */
export function chatBody(body: any, context?: {
    dropped?: string[];
    sampling?: Record<string, any>;
}): any;
/**
 * The tool calls of an Ollama reply as Chat Completions calls. Ollama sends no id (and an object for `arguments`), so each call gets one
 * here, unless the server sent its own.
 * @param {any[] | undefined} calls - `message.tool_calls`.
 * @param {number} [first] - Index of the first call (a stream numbers calls across chunks).
 * @returns {any[]} Calls with `index`, `id`, `type` and `function` (`arguments` as JSON text).
 */
export function callsOfReply(calls: any[] | undefined, first?: number): any[];
/**
 * Chat Completions `finish_reason` for a finished Ollama reply: `tool_calls` when the model called tools, `length` when it ran out of tokens, else `stop`
 * (also for the `load` and `unload` reasons of a request that generated nothing).
 * @param {any} reply - Ollama reply or final stream line.
 * @param {boolean} calls - Whether the reply carried tool calls.
 * @returns {string} `finish_reason`.
 */
export function finishOf(reply: any, calls: boolean): string;
/**
 * Chat Completions usage from the counters of a finished Ollama reply.
 * @param {any} reply - Ollama reply or final stream line.
 * @returns {{prompt_tokens: number, completion_tokens: number, total_tokens: number} | undefined} Usage, or undefined when the reply has no counters.
 */
export function usageOf(reply: any): {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
} | undefined;
/**
 * The same counts as Anthropic usage, which is what the OpenAI front's usage report reads from a converted reply.
 * @param {{prompt_tokens: number, completion_tokens: number} | undefined} usage - Chat Completions usage.
 * @returns {{input_tokens: number, output_tokens: number} | undefined} Anthropic usage.
 */
export function folded(usage: {
    prompt_tokens: number;
    completion_tokens: number;
} | undefined): {
    input_tokens: number;
    output_tokens: number;
} | undefined;
/**
 * The error an Ollama reply carries in `error` (also sent with HTTP 200 in a stream).
 * @param {any} reply - Ollama reply or stream line.
 * @returns {string | null} The message, or null when the reply has none.
 */
export function errorOf(reply: any): string | null;
/**
 * Convert a (non-streaming) Ollama `/api/chat` reply to a Chat Completions `chat.completion`: the thinking goes in the settings' reasoning
 * field, the tool calls get ids, `done_reason` becomes `finish_reason` and the evaluation counts become `usage`.
 * @param {any} reply - Parsed Ollama reply.
 * @param {{ reasoningField?: string }} [options] - `reasoningField` is where the thinking goes (default `reasoning`).
 * @returns {any} `chat.completion` object.
 * @throws {TranslatorError} `upstream_error` (502) when the reply is an error.
 */
export function completion(reply: any, options?: {
    reasoningField?: string;
}): any;
/**
 * Create the converter of an Ollama stream's lines into Chat Completions chunks. One chunker is for one reply: it keeps the completion id (so every
 * chunk carries the same one), the tool-call numbering across lines and whether any tool was called.
 * @param {{ model?: string, reasoningField?: string, includeUsage?: boolean }} [options] - `model` overrides the model name on the chunks; `reasoningField` is where the thinking goes (default `reasoning`); `includeUsage` (default true) adds the final usage chunk.
 * @returns {{ line: (line: any) => any[], finished: () => boolean, usage: () => any }} `line` gives the chunks one line produces (an error line gives one `{ error }` chunk), `finished` says whether the final line was seen and `usage` is the Chat Completions usage of it.
 */
export function createChunker(options?: {
    model?: string;
    reasoningField?: string;
    includeUsage?: boolean;
}): {
    line: (line: any) => any[];
    finished: () => boolean;
    usage: () => any;
};
/** Protocol name of an endpoint that talks to Ollama's native chat API. */
export const PROTOCOL: "ollama.chat";

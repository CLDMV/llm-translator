/**
 * The model's resource name as it goes in a URL: `models/<id>`, with the id percent-encoded. A `models/` prefix the caller already put on is not doubled.
 * @param {string} model - Model id, for example `gemini-2.5-flash` or `models/gemini-2.5-flash`.
 * @returns {string} `models/gemini-2.5-flash`.
 */
export function modelPath(model: string): string;
/**
 * The path of a call: under `/v1beta`, unless the upstream URL already ends in it.
 * @param {any} endpoint - Runtime endpoint.
 * @param {string} rest - Path after the version, without the leading slash (`models/gemini-2.5-flash:generateContent`).
 * @returns {string} Path starting with `/`.
 */
export function route(endpoint: any, rest: string): string;
/**
 * The path of the `countTokens` call that goes with the path of a `generateContent` or `streamGenerateContent` call. A model id has its colons
 * encoded, so the first colon is the method's.
 * @param {string} path - Path of a native call, `.../models/<model>:<method>`.
 * @returns {string} The same path with the `countTokens` method.
 */
export function countPath(path: string): string;
/**
 * The body of a `countTokens` call for a `generateContent` body: the same prompt, as a `generateContentRequest` (which names the model).
 * @param {any} request - `generateContent` body.
 * @param {string} model - Model id.
 * @returns {any} `countTokens` body.
 */
export function countBody(request: any, model: string): any;
/**
 * Convert a Chat Completions request body to a `generateContent` body (`contents`, `systemInstruction`, `generationConfig`, `tools`, `toolConfig`,
 * `safetySettings` and `cachedContent`; the model and the choice of streaming belong to the URL, so neither is in the body). `max_tokens`,
 * `temperature`, `top_p`, `top_k`, `stop`, `seed`, the penalties and `n` become `generationConfig` fields, `response_format` becomes
 * `responseMimeType` with `responseJsonSchema`, tools become function declarations with their JSON Schema as `parametersJsonSchema`,
 * `tool_choice` becomes the calling mode, images, files and audio are sent as bytes or as references to files at URLs, `reasoning_effort`
 * or a thinking budget becomes `thinkingConfig`, `logprobs` and `top_logprobs` become `responseLogprobs` and `logprobs`, and `modalities` and `audio` become
 * `responseModalities` and `speechConfig`. What Gemini has no field for (`logit_bias`, reasoning text in history that has no signature, ...) is left out and named
 * in `dropped`. A request without tools has its past tool calls and results written as text.
 * @param {any} body - Chat Completions request body.
 * @param {{ dropped?: string[], sampling?: Record<string, any>, thinkingBudget?: number, thinkingDynamic?: boolean, marker?: string, model?: string, gemini?: any }} [context] - `model` is the model the request goes to (default: the body's `model`), which decides between a thinking budget and a level; `dropped` collects the names of what was left out; `sampling` are extension fields for `generationConfig`; `thinkingBudget` is the token budget of enabled thinking and `thinkingDynamic` says the client asked for the model to decide; `marker` is the text that marks a failed tool result; `gemini` is the `gemini` setting (safety settings, built-in tools, a cached content, output modalities and the thinking control) with `builtin`, the built-in tools the request itself asked for.
 * @returns {any} `generateContent` request body.
 * @throws {TranslatorError} `invalid_request` for an audio output format Gemini cannot produce.
 */
export function chatBody(body: any, context?: {
    dropped?: string[];
    sampling?: Record<string, any>;
    thinkingBudget?: number;
    thinkingDynamic?: boolean;
    marker?: string;
    model?: string;
    gemini?: any;
}): any;
/**
 * Chat Completions `finish_reason` for a Gemini `finishReason`: `STOP` is `stop`, `MAX_TOKENS` is `length`, the safety, recitation, blocklist,
 * prohibited content, SPII and image safety reasons are `content_filter`, and every other reason (a malformed function call, a missing thought
 * signature, `OTHER`, one this table does not know) is `stop`: the reply ends there, with the text and the calls it has and a note saying why
 * (see `noteOf`). A reply that called tools is `tool_calls`.
 * @param {string | undefined} reason - Gemini `finishReason`.
 * @param {boolean} calls - Whether the reply carried tool calls.
 * @returns {string} `finish_reason`.
 */
export function finishOf(reason: string | undefined, calls: boolean): string;
/**
 * Chat Completions usage from a Gemini `usageMetadata`. Gemini counts cached tokens inside `promptTokenCount` and thinking tokens apart from
 * `candidatesTokenCount`; the completion is both, and tokens of tool use prompts count as prompt.
 * @param {any} meta - Gemini `usageMetadata`.
 * @returns {{prompt_tokens: number, completion_tokens: number, total_tokens: number, prompt_tokens_details?: {cached_tokens: number}, completion_tokens_details?: {reasoning_tokens: number}} | undefined} Usage, or undefined when there are no counts.
 */
export function usageOf(meta: any): {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens_details?: {
        cached_tokens: number;
    };
    completion_tokens_details?: {
        reasoning_tokens: number;
    };
} | undefined;
/**
 * The same counts as Anthropic usage, which is what the OpenAI front's usage report reads from a converted reply (cached tokens are not in `input_tokens`).
 * @param {any} meta - Gemini `usageMetadata`.
 * @returns {{input_tokens: number, output_tokens: number, cache_read_input_tokens: number, cache_creation_input_tokens: number} | undefined} Anthropic usage, or undefined when there are no counts.
 */
export function folded(meta: any): {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
} | undefined;
/**
 * Convert a (non-streaming) `generateContent` reply to a Chat Completions `chat.completion`: text parts are joined into the content, thought
 * parts go in the settings' reasoning field, `functionCall` parts become tool calls (with Gemini's call id when it sent one), thought signatures
 * become `reasoning_details` items (see `FORMAT`) that are sent back with the next request, generated images are `images` (or markdown in the text),
 * audio is `audio`, code and its output are fenced blocks in the text, `logprobsResult` is `logprobs`, `finishReason` becomes `finish_reason` and
 * `usageMetadata` becomes `usage`. A prompt Gemini blocked (`promptFeedback.blockReason`, no candidates) is an empty reply that was filtered.
 * @param {any} reply - Parsed `generateContent` reply.
 * @param {{ reasoningField?: string, model?: string, parallel?: boolean, images?: "images" | "text", audio?: string }} [options] - `reasoningField` is where the reasoning goes (default `reasoning`); `model` is the model name on the completion; `parallel` false keeps only the first function call; `images` says where generated images go (default `images`); `audio` is the format asked for.
 * @returns {any} `chat.completion` object.
 * @throws {TranslatorError} `invalid_upstream_response` (502) when the reply has no candidate and no block reason.
 */
export function completion(reply: any, options?: {
    reasoningField?: string;
    model?: string;
    parallel?: boolean;
    images?: "images" | "text";
    audio?: string;
}): any;
/**
 * Create the converter of a `streamGenerateContent` reply's chunks into Chat Completions chunks. Every chunk of the reply is a whole
 * `GenerateContentResponse`: its parts become deltas (a function call arrives whole, so it is one delta), and the chunk with a `finishReason`
 * ends that candidate. One chunker is for one reply: it keeps the completion id (so every chunk carries the same one) and the numbering of tool
 * calls of each candidate. The signatures of text and thought are given at the end of a candidate, when the length of its text is known. An
 * `error` object in the stream gives one `{ error }` chunk.
 * @param {{ model?: string, reasoningField?: string, includeUsage?: boolean, candidates?: number, parallel?: boolean, images?: "images" | "text", audio?: string }} [options] - `model` is the model name on the chunks; `reasoningField` is where the reasoning goes (default `reasoning`); `includeUsage` (default true) adds the final usage chunk; `candidates` is how many candidates are streamed (default 1; the others are ignored); `parallel` false keeps only the first function call of a candidate; `images` says where generated images go; `audio` is the format asked for.
 * @returns {{ event: (data: any) => any[], finished: () => boolean, usage: () => any }} `event` gives the chunks one stream chunk produces, `finished` says whether every candidate ended (a `finishReason`, a blocked prompt, or a failure) and `usage` is the latest `usageMetadata`.
 */
export function createChunker(options?: {
    model?: string;
    reasoningField?: string;
    includeUsage?: boolean;
    candidates?: number;
    parallel?: boolean;
    images?: "images" | "text";
    audio?: string;
}): {
    event: (data: any) => any[];
    finished: () => boolean;
    usage: () => any;
};
/** `format` of the `reasoning_details` items that carry a Gemini `thoughtSignature` (`data`) and the part it belongs to (`for`: `text`, `thought` or `call`, with the tool call `id` for a call, and `rest` for text and thought: the characters of the text that follow the part). */
export const FORMAT: "google-gemini-v1";
/** The `thoughtSignature` Google documents for a function call part that has no real signature (history written by another model, or a client that dropped them). */
export const SKIP_SIGNATURE: "skip_thought_signature_validator";
/** Most candidates one request asks for (Gemini's own limit); more are answered by fan-out. */
export const MAX_CANDIDATES: 8;

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/settings.mjs
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
export type Settings = {
    /**
     * - How mid-conversation `role:"system"` messages are handled. `user` folds them into the adjacent user turn as `<system-reminder>` text, `keep` forwards them as system messages, `hoist` appends them to the leading system message, `drop` discards them. `auto` behaves like `user` unless a driver probed the chat template and resolved it.
     */
    inlineSystem: "auto" | "keep" | "hoist" | "user" | "drop";
    /**
     * - Remove the `x-anthropic-billing-header` system block.
     */
    stripBillingHeader: boolean;
    /**
     * - Field used when SENDING reasoning to an OpenAI-style server (reading accepts both).
     */
    reasoningField: "reasoning" | "reasoning_content";
    /**
     * - Parse a leading `<think>...</think>` in content as reasoning.
     */
    thinkTags: boolean;
    /**
     * - How Anthropic `thinking` is requested from the server.
     */
    thinking: "chat_template_kwargs" | "reasoning_effort" | "none";
    /**
     * - Send `thinking_token_budget` for `thinking.type = "enabled"`.
     */
    thinkingBudget: boolean;
    /**
     * - Map `output_config.effort` to `reasoning_effort`.
     */
    effort: boolean;
    /**
     * - The model accepts images. When false images are replaced by a text note.
     */
    images: boolean;
    /**
     * - How `document` blocks are handled.
     */
    documents: "extract" | "note" | "error";
    /**
     * - Override for `document` conversion; returns Anthropic content blocks.
     */
    documentConverter: ((block: object, ctx: object) => Promise<object[]> | object[]) | null;
    /**
     * - PDF handling: render page images, Anthropic-like limits, image budget and render scale.
     */
    pdf: {
        pages: boolean;
        maxPages: number;
        maxBytes: number;
        maxImages: number;
        scale: number;
    };
    /**
     * - Sanitize tool JSON Schemas (drop `$schema`, remove unbounded integer limits).
     */
    toolSchema: "pass" | "sanitize";
    /**
     * - Forward `defer_loading` tools as plain function tools or drop them.
     */
    deferredTools: "forward" | "drop";
    /**
     * - Prefix `is_error` tool results with `[error] `.
     */
    toolErrors: boolean;
    /**
     * - Field used for the output cap.
     */
    maxTokensField: "max_completion_tokens" | "max_tokens";
    /**
     * - Request `stream_options.include_usage` on streamed requests.
     */
    streamUsage: boolean;
    /**
     * - Also request `stream_options.continuous_usage_stats` (vLLM extension; real OpenAI may reject it).
     */
    continuousUsage: boolean;
    /**
     * - Map a trailing assistant message to `continue_final_message`.
     */
    prefill: "continue_final_message" | "none";
    /**
     * - Forward `top_k`.
     */
    topK: boolean;
    /**
     * - Map `output_config.format` to `response_format`.
     */
    responseFormat: boolean;
    /**
     * - Map `disable_parallel_tool_use` to `parallel_tool_calls: false`.
     */
    parallelToolCalls: boolean;
    /**
     * - Unknown request fields are dropped (and listed in `state.dropped`) or rejected.
     */
    unknownFields: "drop" | "error";
    /**
     * - Milliseconds of upstream silence before the SSE writer emits a `ping` (0 disables).
     */
    pingInterval: number;
    /**
     * - vLLM driver: send `xhigh` and `max` reasoning effort unchanged instead of clamping them to `high`.
     */
    effortPassthrough: boolean;
    /**
     * - Restrict bodies forwarded from the OpenAI front to an OpenAI-protocol upstream to standard Chat Completions fields plus documented vLLM extensions. Off in the library; the server turns it on unless set to false.
     */
    passthroughFilter: boolean;
    /**
     * - `max_tokens` used when an OpenAI request has none (Anthropic requires one).
     */
    defaultMaxTokens: number;
};
/**
 * Settings understood by the converters. Every key is optional when passed in; `resolve()` fills the rest.
 * @typedef {object} Settings
 * @property {"auto"|"keep"|"hoist"|"user"|"drop"} inlineSystem - How mid-conversation `role:"system"` messages are handled. `user` folds them into the adjacent user turn as `<system-reminder>` text, `keep` forwards them as system messages, `hoist` appends them to the leading system message, `drop` discards them. `auto` behaves like `user` unless a driver probed the chat template and resolved it.
 * @property {boolean} stripBillingHeader - Remove the `x-anthropic-billing-header` system block.
 * @property {"reasoning"|"reasoning_content"} reasoningField - Field used when SENDING reasoning to an OpenAI-style server (reading accepts both).
 * @property {boolean} thinkTags - Parse a leading `<think>...</think>` in content as reasoning.
 * @property {"chat_template_kwargs"|"reasoning_effort"|"none"} thinking - How Anthropic `thinking` is requested from the server.
 * @property {boolean} thinkingBudget - Send `thinking_token_budget` for `thinking.type = "enabled"`.
 * @property {boolean} effort - Map `output_config.effort` to `reasoning_effort`.
 * @property {boolean} images - The model accepts images. When false images are replaced by a text note.
 * @property {"extract"|"note"|"error"} documents - How `document` blocks are handled.
 * @property {((block: object, ctx: object) => Promise<object[]>|object[])|null} documentConverter - Override for `document` conversion; returns Anthropic content blocks.
 * @property {{ pages: boolean, maxPages: number, maxBytes: number, maxImages: number, scale: number }} pdf - PDF handling: render page images, Anthropic-like limits, image budget and render scale.
 * @property {"pass"|"sanitize"} toolSchema - Sanitize tool JSON Schemas (drop `$schema`, remove unbounded integer limits).
 * @property {"forward"|"drop"} deferredTools - Forward `defer_loading` tools as plain function tools or drop them.
 * @property {boolean} toolErrors - Prefix `is_error` tool results with `[error] `.
 * @property {"max_completion_tokens"|"max_tokens"} maxTokensField - Field used for the output cap.
 * @property {boolean} streamUsage - Request `stream_options.include_usage` on streamed requests.
 * @property {boolean} continuousUsage - Also request `stream_options.continuous_usage_stats` (vLLM extension; real OpenAI may reject it).
 * @property {"continue_final_message"|"none"} prefill - Map a trailing assistant message to `continue_final_message`.
 * @property {boolean} topK - Forward `top_k`.
 * @property {boolean} responseFormat - Map `output_config.format` to `response_format`.
 * @property {boolean} parallelToolCalls - Map `disable_parallel_tool_use` to `parallel_tool_calls: false`.
 * @property {"drop"|"error"} unknownFields - Unknown request fields are dropped (and listed in `state.dropped`) or rejected.
 * @property {number} pingInterval - Milliseconds of upstream silence before the SSE writer emits a `ping` (0 disables).
 * @property {boolean} effortPassthrough - vLLM driver: send `xhigh` and `max` reasoning effort unchanged instead of clamping them to `high`.
 * @property {boolean} passthroughFilter - Restrict bodies forwarded from the OpenAI front to an OpenAI-protocol upstream to standard Chat Completions fields plus documented vLLM extensions. Off in the library; the server turns it on unless set to false.
 * @property {number} defaultMaxTokens - `max_tokens` used when an OpenAI request has none (Anthropic requires one).
 */
/** @type {Readonly<Settings>} */
export declare const DEFAULTS: Readonly<Settings>;
/**
 * Merge settings layers (later layers win, `undefined` values are skipped, `pdf` merges key by key) and validate
 * the enumerated keys. The result is a fresh object; inputs are never mutated.
 * @param {...(Partial<Settings>|null|undefined)} layers - Layers in increasing precedence.
 * @returns {Settings} Resolved settings.
 */
export declare function resolve(...layers: (Partial<Settings> | null | undefined)[]): Settings;

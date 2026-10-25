/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/errors.mjs
 *	@Date: 2026-10-25T12:29:30-07:00 (1792956570)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:01-07:00 (1792958341)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * @fileoverview Error type shared by every converter, plus helpers that render an error in either wire protocol.
 */
/**
 * Error raised for requests or upstream replies the translator cannot (or will not) convert. Carries enough
 * information to be rendered as an Anthropic or an OpenAI error body.
 */
export declare class TranslatorError extends Error {
    code: string;
    status: number;
    type: string;
    param: string;
    details: unknown;
    /**
     * @param {string} message - Human readable message (sent to the client).
     * @param {object} [options] - Error metadata.
     * @param {string} [options.code] - Stable machine readable code (for example `"unsupported_field"`).
     * @param {number} [options.status] - HTTP status to answer with.
     * @param {string} [options.type] - Anthropic style error type.
     * @param {string|null} [options.param] - Offending request parameter, when known.
     * @param {unknown} [options.details] - Extra data for logs and tests.
     */
    constructor(message: string, options?: {
        code?: string;
        status?: number;
        type?: string;
        param?: string | null;
        details?: unknown;
    });
    /**
     * Render as an Anthropic error body.
     * @returns {{ type: "error", error: { type: string, message: string } }} Anthropic error body.
     */
    toAnthropic(): {
        type: "error";
        error: {
            type: string;
            message: string;
        };
    };
    /**
     * Render as an OpenAI error body.
     * @returns {{ error: { message: string, type: string, param: string|null, code: string|number|null } }} OpenAI error body.
     */
    toOpenAI(): {
        error: {
            message: string;
            type: string;
            param: string | null;
            code: string | number | null;
        };
    };
}
/**
 * Anthropic error type for an HTTP status.
 * @param {number} status - HTTP status code.
 * @returns {string} Anthropic error type.
 */
export declare function statusToAnthropicType(status: number): string;
/**
 * HTTP status for an Anthropic error type.
 * @param {string} type - Anthropic error type.
 * @returns {number} HTTP status code.
 */
export declare function anthropicTypeToStatus(type: string): number;
/**
 * OpenAI style error type for an Anthropic error type.
 * @param {string} type - Anthropic error type.
 * @returns {string} OpenAI error type.
 */
export declare function anthropicToOpenAIType(type: string): string;
/**
 * Anthropic error type for an OpenAI style error object (type and/or numeric code and/or HTTP status).
 * @param {{ type?: string|null, code?: string|number|null }} error - OpenAI error object.
 * @param {number} [status] - HTTP status of the reply, when known.
 * @returns {string} Anthropic error type.
 */
export declare function openaiToAnthropicType(error: {
    type?: string | null;
    code?: string | number | null;
}, status?: number): string;
/**
 * Build an Anthropic error body.
 * @param {string} type - Anthropic error type.
 * @param {string} message - Error message.
 * @returns {{ type: "error", error: { type: string, message: string } }} Anthropic error body.
 */
export declare function anthropicError(type: string, message: string): {
    type: "error";
    error: {
        type: string;
        message: string;
    };
};
/**
 * Build an OpenAI error body.
 * @param {string} message - Error message.
 * @param {{ type?: string, param?: string|null, code?: string|number|null }} [fields] - Optional fields.
 * @returns {{ error: { message: string, type: string, param: string|null, code: string|number|null } }} OpenAI error body.
 */
export declare function openaiError(message: string, { type, param, code }?: {
    type?: string;
    param?: string | null;
    code?: string | number | null;
}): {
    error: {
        message: string;
        type: string;
        param: string | null;
        code: string | number | null;
    };
};
/**
 * Detect an OpenAI/vLLM "context length exceeded" message and rewrite it in Anthropic's wording
 * (`prompt is too long: <n> tokens > <max> maximum`), which Claude Code recognises and answers with
 * auto-compaction. `n` is the total the request asked for (prompt plus requested completion) when the message
 * reports it, otherwise the prompt size, and `max + 1` when the message gives no size, so `n` always exceeds the maximum.
 * @param {string} message - Upstream error message.
 * @returns {string|null} Rewritten message, or null when the message is not a context overflow.
 */
export declare function rewriteContextOverflow(message: string): string | null;
/**
 * Token counts from a context-overflow message.
 * @param {string} message - Upstream error message.
 * @returns {{ prompt: number, max: number }|null} Counts (`prompt` is the requested total, or the prompt size, or `max + 1`), or null when not an overflow.
 */
export declare function contextOverflow(message: string): {
    prompt: number;
    max: number;
} | null;

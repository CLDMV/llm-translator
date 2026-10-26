/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/upstream-error.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
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
 * Anthropic error type for an HTTP status.
 * @param {number} status - HTTP status.
 * @returns {string} Anthropic `error.type`.
 */
export declare function anthropicType(status: number): string;
/**
 * OpenAI error type for an HTTP status.
 * @param {number} status - HTTP status.
 * @returns {string} OpenAI `error.type`.
 */
export declare function openaiType(status: number): string;
/**
 * Pull `{ message, type, code, param }` out of any known upstream error body shape: nested OpenAI/vLLM
 * (`{error:{message,type,param,code}}`), flat old vLLM (`{message,type,param,code}`), Anthropic
 * (`{type:"error",error:{type,message}}`), `{error:"text"}`, a bare string, or nothing.
 * @param {*} body - Parsed upstream body.
 * @param {number} status - HTTP status, used for the fallback message.
 * @returns {{message: string, type?: string, code?: *, param?: *}} Normalized error.
 */
export declare function parse(body: any, status: number): {
    message: string;
    type?: string;
    code?: any;
    param?: any;
};
/**
 * Render an error body in the client protocol.
 * @param {"anthropic" | "openai"} front - Client protocol.
 * @param {number} status - HTTP status.
 * @param {{message: string, type?: string, code?: *, param?: *}} info - Normalized error.
 * @param {any} [options] - `{ native: boolean }`: keep the upstream `type` when it is already valid for this protocol.
 * @returns {{status: number, body: any}} Status and body in the client shape.
 */
export declare function render(front: "anthropic" | "openai", status: number, info: {
    message: string;
    type?: string;
    code?: any;
    param?: any;
}, options?: any): {
    status: number;
    body: any;
};

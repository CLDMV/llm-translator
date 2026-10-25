/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/error/build.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:00-07:00 (1792958340)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * Build `{ status, headers, body }` in the client protocol.
 * @param {number} status - HTTP status.
 * @param {string} message - Error message.
 * @param {any} [options] - `{ type, code, param, front }` overrides; `type` is an Anthropic error type (mapped for the OpenAI front) and `front` defaults to the configured front.
 * @returns {{status: number, headers: Record<string,string>, body: any}} Client-shaped error reply.
 */
export declare function build(status: number, message: string, options?: any): {
    status: number;
    headers: Record<string, string>;
    body: any;
};

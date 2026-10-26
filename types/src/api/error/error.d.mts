/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/error/error.mjs
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
 * Convert an upstream error reply into `{ status, headers, body }` in the client protocol. Context-window overflows
 * become Anthropic's "prompt is too long: N tokens > MAX maximum" (which triggers Claude Code's compaction); status codes
 * map 1:1; `retry-after` is kept.
 * @param {number} status - Upstream HTTP status.
 * @param {*} upstreamBody - Parsed upstream error body (object or text).
 * @param {Record<string,string>} [headers] - Lowercase upstream response headers.
 * @param {any} [state] - The `state` returned by `request` (selects the driver normalizer and native handling).
 * @returns {Promise<{status: number, headers: Record<string,string>, body: any}>} Client-shaped error reply.
 */
export default function error(status: number, upstreamBody: any, headers?: Record<string, string>, state?: any): Promise<{
    status: number;
    headers: Record<string, string>;
    body: any;
}>;

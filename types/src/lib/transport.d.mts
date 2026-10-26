/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/transport.mjs
 *	@Date: 2026-10-25T21:38:02-07:00 (1792989482)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-26T15:38:58-07:00 (1793054338)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * `fetch`-style request.
 * @param {string|URL} url - Absolute http(s) URL.
 * @param {{ method?: string, headers?: Record<string, string>, body?: string|Uint8Array, signal?: AbortSignal, redirect?: string }} [init] - Request options.
 * @param {{ http: any, https: any }} [modules] - Protocol modules (overridable for tests).
 * @returns {Promise<Response>} Response whose `body` is a web `ReadableStream`.
 */
export declare function transport(url: string | URL, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array;
    signal?: AbortSignal;
    redirect?: string;
}, modules?: {
    http: any;
    https: any;
}): Promise<Response>;

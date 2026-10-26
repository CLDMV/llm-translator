/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/http.mjs
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
 * @fileoverview Small HTTP helpers shared by the api leaves: URL joining, auth headers, JSON requests.
 * @module @cldmv/llm-translator/lib/http
 */
/**
 * Join an endpoint base URL and a path.
 * @param {string} base - Base URL without trailing slash.
 * @param {string} path - Path starting with `/`.
 * @returns {string} Absolute URL.
 */
export declare function join(base: string, path: string): string;
/**
 * Whether a listen address only accepts connections from this machine.
 * @param {string} host - Host or address.
 * @returns {boolean} True for `localhost`, `127.x.x.x` and `::1`.
 */
export declare function isLoopback(host: string): boolean;
/**
 * Build the request headers for an upstream call.
 * @param {any} endpoint - Runtime endpoint.
 * @param {string} [auth] - `"bearer"` (default) or `"x-api-key"`.
 * @param {Record<string,string>} [extra] - Extra headers applied last.
 * @returns {Record<string,string>} Header map.
 */
export declare function headers(endpoint: any, auth?: string, extra?: Record<string, string>): Record<string, string>;
/**
 * Convert a fetch `Headers` object (or plain object) to a lowercase plain object.
 * @param {Headers | Record<string,string> | undefined} source - Header source.
 * @returns {Record<string,string>} Plain header map.
 */
export declare function plain(source: Headers | Record<string, string> | undefined): Record<string, string>;
/**
 * Perform a request and parse the JSON body. Never throws: network failures and non-JSON bodies are reported in the result.
 * @param {Function} transport - fetch-compatible function.
 * @param {string} url - Absolute URL.
 * @param {any} [options] - `{ method, headers, body, signal, timeout }`.
 * @returns {Promise<{ok: boolean, status: number, body: any, error?: Error}>} Outcome.
 */
export declare function json(transport: Function, url: string, options?: any): Promise<{
    ok: boolean;
    status: number;
    body: any;
    error?: Error;
}>;

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
export function join(base: string, path: string): string;
/**
 * The path (with any query) of a call on an upstream. A driver that has a `path(kind, { endpoint, model })` leaf builds it from the endpoint
 * and the model (Azure OpenAI puts the deployment and `api-version` there); otherwise `info().paths[kind]` is used, with the standard
 * OpenAI path for `embeddings` and `models` when the driver does not name one.
 * @param {any} driver - Driver record (`info` and the optional `path` leaf).
 * @param {"chat" | "messages" | "embeddings" | "models"} kind - Which call.
 * @param {any} endpoint - Runtime endpoint.
 * @param {string} [model] - The upstream's model name for the request.
 * @returns {Promise<string>} Path starting with `/`.
 */
export function pathOf(driver: any, kind: "chat" | "messages" | "embeddings" | "models", endpoint: any, model?: string): Promise<string>;
/**
 * Whether a listen address only accepts connections from this machine.
 * @param {string} host - Host or address.
 * @returns {boolean} True for `localhost`, `127.x.x.x` and `::1`.
 */
export function isLoopback(host: string): boolean;
/**
 * Build the request headers for an upstream call.
 * @param {any} endpoint - Runtime endpoint.
 * @param {string} [auth] - `"bearer"` (default), `"x-api-key"` or `"api-key"` (Azure OpenAI).
 * @param {Record<string,string>} [extra] - Extra headers applied last.
 * @returns {Record<string,string>} Header map.
 */
export function headers(endpoint: any, auth?: string, extra?: Record<string, string>): Record<string, string>;
/**
 * GET a path of the endpoint for detection. Within one detection pass (`context.probes` is a shared `Map`) each path is requested
 * once and every driver that asks for it gets the same result, so a path fetched for one backend (for example `/v1/models`) is
 * not fetched again for the next. Never rejects; treat the result as read-only.
 *
 * Without `driver` the request carries the upstream's bearer key. A driver whose `info()` says `auth: "x-api-key"` or `"api-key"`, or carries
 * `headers` passes its `info()` so the probe is sent the way the driver talks to its own backend; that request is a different
 * request from the bearer one, so it is cached under its own key.
 * @param {any} context - `{ endpoint, transport, signal, timeout, probes? }`.
 * @param {string} path - Path starting with `/`.
 * @param {any} [driver] - A driver's `info()`; its `auth` and `headers` shape the request.
 * @returns {Promise<{ok: boolean, status: number, body: any, error?: Error}>} Outcome (see `json`).
 */
export function probe({ endpoint, transport, signal, timeout, probes }: any, path: string, driver?: any): Promise<{
    ok: boolean;
    status: number;
    body: any;
    error?: Error;
}>;
/**
 * Convert a fetch `Headers` object (or plain object) to a lowercase plain object.
 * @param {Headers | Record<string,string> | undefined} source - Header source.
 * @returns {Record<string,string>} Plain header map.
 */
export function plain(source: Headers | Record<string, string> | undefined): Record<string, string>;
/**
 * Perform a request and parse the JSON body. Never throws: network failures and non-JSON bodies are reported in the result.
 * @param {Function} transport - fetch-compatible function.
 * @param {string} url - Absolute URL.
 * @param {any} [options] - `{ method, headers, body, signal, timeout }`.
 * @returns {Promise<{ok: boolean, status: number, body: any, headers?: Record<string,string>, error?: Error}>} Outcome (`headers` only when a response arrived).
 */
export function json(transport: Function, url: string, options?: any): Promise<{
    ok: boolean;
    status: number;
    body: any;
    headers?: Record<string, string>;
    error?: Error;
}>;

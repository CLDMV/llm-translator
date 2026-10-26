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
export function join(base, path) {
	return base + path;
}

/**
 * Whether a listen address only accepts connections from this machine.
 * @param {string} host - Host or address.
 * @returns {boolean} True for `localhost`, `127.x.x.x` and `::1`.
 */
export function isLoopback(host) {
	return host === "localhost" || host === "::1" || /^127\./.test(host);
}

/**
 * Build the request headers for an upstream call.
 * @param {any} endpoint - Runtime endpoint.
 * @param {string} [auth] - `"bearer"` (default) or `"x-api-key"`.
 * @param {Record<string,string>} [extra] - Extra headers applied last.
 * @returns {Record<string,string>} Header map.
 */
export function headers(endpoint, auth = "bearer", extra) {
	const out = { ...endpoint.headers };
	if (endpoint.apiKey) {
		if (auth === "x-api-key") out["x-api-key"] = endpoint.apiKey;
		else out.authorization = `Bearer ${endpoint.apiKey}`;
	}
	return { ...out, ...extra };
}

/**
 * Convert a fetch `Headers` object (or plain object) to a lowercase plain object.
 * @param {Headers | Record<string,string> | undefined} source - Header source.
 * @returns {Record<string,string>} Plain header map.
 */
export function plain(source) {
	const out = {};
	if (!source) return out;
	if (typeof source.forEach === "function") {
		source.forEach((value, key) => {
			out[key.toLowerCase()] = value;
		});
		return out;
	}
	for (const [key, value] of Object.entries(source)) out[key.toLowerCase()] = String(value);
	return out;
}

/**
 * Perform a request and parse the JSON body. Never throws: network failures and non-JSON bodies are reported in the result.
 * @param {Function} transport - fetch-compatible function.
 * @param {string} url - Absolute URL.
 * @param {any} [options] - `{ method, headers, body, signal, timeout }`.
 * @returns {Promise<{ok: boolean, status: number, body: any, error?: Error}>} Outcome.
 */
export async function json(transport, url, options = {}) {
	const { timeout, signal, body, ...rest } = options;
	const signals = [];
	if (signal) signals.push(signal);
	if (timeout > 0) signals.push(AbortSignal.timeout(timeout));
	try {
		const res = await transport(url, {
			...rest,
			redirect: "error",
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0]
		});
		const text = await res.text();
		let parsed = null;
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = text === "" ? null : text;
		}
		return { ok: res.ok, status: res.status, body: parsed };
	} catch (error) {
		return { ok: false, status: 0, body: null, error };
	}
}

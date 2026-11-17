/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/guard.mjs
 *	@Date: 2026-11-17T09:00:00-08:00 (1794934800)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-17T09:00:00-08:00 (1794934800)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Optional server hardening: TLS options, CORS and a per-client rate limit. All of it is off unless configured.
 * @module @cldmv/llm-translator/lib/guard
 */
import { readFile } from "node:fs/promises";
import { TranslatorError } from "./errors.mjs";

const invalid = (message) => new TranslatorError(message, { code: "invalid_config", status: 500 });

/**
 * Read the TLS files named by `options.tls` into the `https` options of Fastify / `node:https`.
 * @param {any} tls - `{ key, cert, ca, passphrase }`: file paths (`ca` may be a list), `passphrase` a string; or undefined for plain HTTP.
 * @returns {Promise<object | null>} `https` options, or null when TLS is not configured.
 */
export async function tlsOptions(tls) {
	if (tls === undefined || tls === null) return null;
	if (typeof tls !== "object" || Array.isArray(tls)) throw invalid("tls must be an object with key and cert file paths");
	const { key, cert, ca, passphrase } = tls;
	if (!key && !cert && !ca && !passphrase) return null;
	if (!key || !cert) throw invalid(`tls needs both key and cert (got ${key ? "key" : "cert"} only)`);
	const read = async (name, path) => {
		if (typeof path !== "string") throw invalid(`tls.${name} must be a file path`);
		try {
			return await readFile(path);
		} catch (cause) {
			throw invalid(`tls.${name}: cannot read ${path} (${/** @type {any} */ (cause).code ?? cause})`);
		}
	};
	const out = { key: await read("key", key), cert: await read("cert", cert) };
	if (ca) out.ca = await Promise.all([ca].flat().map((path) => read("ca", path)));
	if (passphrase !== undefined) {
		if (typeof passphrase !== "string") throw invalid("tls.passphrase must be a string");
		out.passphrase = passphrase;
	}
	return out;
}

const PREFLIGHT_HEADERS = "authorization, x-api-key, content-type, anthropic-version, anthropic-beta";

/**
 * Normalize a CORS origin for comparison (case-insensitive, no trailing slash).
 * @param {string} origin - Origin as sent or configured.
 * @returns {string} Comparable form.
 */
const comparable = (origin) => origin.toLowerCase().replace(/\/+$/, "");

/**
 * Build the CORS policy.
 * @param {any} option - A list of origins, or `{ origins }`. `"*"` allows every origin. Undefined, null or an empty list turns CORS off.
 * @returns {{ headers: (origin: string | undefined) => Record<string,string>, preflight: (origin: string | undefined, requested: string | undefined) => Record<string,string> } | null} Policy, or null when off.
 */
export function cors(option) {
	if (option === undefined || option === null || option === false) return null;
	const list = [Array.isArray(option) || typeof option === "string" ? option : (option.origins ?? [])].flat();
	if (list.some((origin) => typeof origin !== "string" || origin === "")) throw invalid("cors origins must be non-empty strings");
	if (list.length === 0) return null;
	const any = list.includes("*");
	const allowed = new Set(list.map(comparable));
	/**
	 * Response headers for a request's origin: none for a request without an Origin header or an origin that is not allowed (`vary` is still set when there is an Origin).
	 * @param {string | undefined} origin - Request `Origin` header.
	 * @returns {Record<string,string>} Headers to add to the response.
	 */
	const headers = (origin) => {
		if (!origin) return {};
		if (!any && !allowed.has(comparable(origin))) return { vary: "origin" };
		return {
			"access-control-allow-origin": any ? "*" : origin,
			"access-control-expose-headers": "retry-after, request-id, x-request-id",
			vary: "origin"
		};
	};
	return {
		headers,
		preflight: (origin, requested) => {
			const base = headers(origin);
			if (!base["access-control-allow-origin"]) return base;
			return {
				...base,
				"access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
				"access-control-allow-headers": requested || PREFLIGHT_HEADERS,
				"access-control-max-age": "600"
			};
		}
	};
}

/**
 * Build a fixed-window rate limiter.
 * @param {any} option - `{ requests, windowMs = 60000 }` (requests per window per client); undefined, null or false turns it off.
 * @param {() => number} [now] - Clock in ms (tests).
 * @returns {{ take: (key: string) => number, size: () => number } | null} Limiter, or null when off. `take(key)` returns 0 when the request may go on, else the seconds to wait.
 */
export function rateLimit(option, now = Date.now) {
	if (option === undefined || option === null || option === false) return null;
	const requests = option.requests;
	const windowMs = option.windowMs ?? 60000;
	if (!Number.isInteger(requests) || requests < 1)
		throw invalid(`rateLimit.requests must be a positive integer (got ${JSON.stringify(requests)})`);
	if (!Number.isInteger(windowMs) || windowMs < 1)
		throw invalid(`rateLimit.windowMs must be a positive integer (got ${JSON.stringify(windowMs)})`);
	/** @type {Map<string, { start: number, count: number }>} */
	const buckets = new Map();
	let swept = now();
	return {
		take: (key) => {
			const at = now();
			// Stale buckets are dropped at most once per window, while requests arrive; there is no timer to keep the process alive or to clear on stop.
			if (at - swept >= windowMs) {
				for (const [name, bucket] of buckets) if (at - bucket.start >= windowMs) buckets.delete(name);
				swept = at;
			}
			let bucket = buckets.get(key);
			if (!bucket || at - bucket.start >= windowMs) {
				bucket = { start: at, count: 0 };
				buckets.set(key, bucket);
			}
			if (bucket.count >= requests) return Math.max(1, Math.ceil((bucket.start + windowMs - at) / 1000));
			bucket.count++;
			return 0;
		},
		size: () => buckets.size
	};
}

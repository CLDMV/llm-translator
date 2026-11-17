/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/cache.mjs
 *	@Date: 2026-11-14T12:00:00-08:00 (1794344400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-14T12:00:00-08:00 (1794344400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Prompt-cache hints for OpenAI-protocol upstreams: vLLM's `cache_salt` and OpenAI's `prompt_cache_key`.
 * @module @cldmv/llm-translator/lib/cache
 */
import { TranslatorError } from "./errors.mjs";

/** Drivers whose servers take `cache_salt` (vLLM's per-tenant prefix-cache isolation). */
export const SALT_DRIVERS = ["vllm"];

/** Drivers whose servers take `prompt_cache_key` (OpenAI's cache routing hint). */
export const KEY_DRIVERS = ["openai"];

/**
 * Is a salt or key value usable?
 * @param {any} value - Setting or request value.
 * @returns {boolean} True for a non-empty string, or an absent value.
 */
export function valid(value) {
	return value === undefined || value === null || (typeof value === "string" && value !== "");
}

/**
 * Add the cache hints to an OpenAI-protocol body.
 *
 * - `cache_salt` comes only from trusted places: the `cacheSalt` call option (the server passes the `authorize` hook's `cacheSalt`) or the upstream's `cacheSalt` setting,
 *   in that order. It always replaces a `cache_salt` the body carries, so a client cannot choose its own tenant. A backend without the feature
 *   follows `unknownFields`: dropped (listed in `dropped`) or rejected.
 * - `prompt_cache_key` comes from the client (`metadata.prompt_cache_key` on the Anthropic front; the OpenAI front's own field is kept) or the upstream's `promptCacheKey` setting. A
 *   key the body already carries wins over the setting.
 * @param {any} body - Converted or forwarded Chat Completions body.
 * @param {{ salt?: any, key?: any }} asked - The call's `cacheSalt` option and the request's prompt cache key.
 * @param {any} settings - Resolved settings (`cacheSalt`, `promptCacheKey`, `unknownFields`).
 * @param {string} driver - Driver name of the upstream.
 * @param {string[]} [dropped] - Receives the names that were left out.
 * @returns {any} The body, with the fields added (a copy when anything was added).
 * @throws {TranslatorError} `invalid_request` for a malformed salt or key; `unsupported_field` when the backend lacks the feature and `unknownFields` is `"error"`.
 */
export function addCache(body, asked, settings, driver, dropped = []) {
	if (!valid(asked.salt))
		throw new TranslatorError("cacheSalt: expected a non-empty string", { code: "invalid_request", param: "cacheSalt" });
	if (!valid(asked.key))
		throw new TranslatorError("metadata.prompt_cache_key: expected a non-empty string", {
			code: "invalid_request",
			param: "metadata.prompt_cache_key"
		});
	let out = body;
	const refuse = (name) => {
		if (settings.unknownFields === "error")
			throw new TranslatorError(`${name}: is not accepted by this upstream`, { code: "unsupported_field", param: name });
		if (!dropped.includes(name)) dropped.push(name);
	};
	const salt = asked.salt ?? settings.cacheSalt;
	if (salt !== undefined && salt !== null) {
		if (SALT_DRIVERS.includes(driver)) out = { ...out, cache_salt: salt };
		else refuse("cache_salt");
	}
	const key = asked.key ?? settings.promptCacheKey;
	if (key !== undefined && key !== null && !Object.hasOwn(body, "prompt_cache_key")) {
		if (KEY_DRIVERS.includes(driver)) out = { ...out, prompt_cache_key: key };
		else refuse("prompt_cache_key");
	}
	return out;
}

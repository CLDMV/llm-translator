/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/bedrock-settings.mjs
 *	@Date: 2026-11-22T09:00:00-08:00 (1795370400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T09:00:00-08:00 (1795370400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The `bedrock` setting: request options an operator sets for an Amazon Bedrock upstream, checked when the settings are resolved.
 * @module @cldmv/llm-translator/lib/bedrock-settings
 */

/** The keys of the `bedrock` setting and what each expects. */
const EXPECTED = {
	cache: "true or false"
};

/**
 * Check the `bedrock` setting: `cache` (false stops `cache_control` from becoming Converse cache points) is the only key.
 * @param {any} value - The setting.
 * @returns {string | null} What is wrong with it, or null when it is fine.
 */
export function check(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return "expected an object";
	for (const [key, entry] of Object.entries(value)) {
		if (!Object.hasOwn(EXPECTED, key)) return `unknown key ${key}`;
		if (typeof entry !== "boolean") return `${key} must be ${EXPECTED[key]}`;
	}
	return null;
}

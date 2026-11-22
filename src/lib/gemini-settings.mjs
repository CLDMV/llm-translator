/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/gemini-settings.mjs
 *	@Date: 2026-11-22T10:00:00-08:00 (1795370400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T10:00:00-08:00 (1795370400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The `gemini` setting: Gemini request fields an operator sets for an upstream (safety settings, built-in tools, a cached content, the thinking control, output modalities), checked when the settings are resolved.
 * @module @cldmv/llm-translator/lib/gemini-settings
 */

/** The keys of the `gemini` setting and the check each value has to pass. */
const CHECKS = {
	safetySettings: (value) =>
		Array.isArray(value) &&
		value.every((entry) => isObject(entry) && typeof entry.category === "string" && typeof entry.threshold === "string"),
	tools: (value) => Array.isArray(value) && value.every(isObject),
	cachedContent: (value) => typeof value === "string" && value !== "",
	cache: (value) => typeof value === "boolean",
	thinking: (value) => value === "auto" || value === "level" || value === "budget",
	responseModalities: (value) => Array.isArray(value) && value.every((entry) => typeof entry === "string" && entry !== ""),
	imageConfig: isObject,
	speechConfig: isObject,
	mediaResolution: (value) => typeof value === "string" && value !== ""
};

/** What each key expects, for the error message. */
const EXPECTED = {
	safetySettings: "a list of { category, threshold } objects",
	tools: "a list of tool objects such as { googleSearch: {} }",
	cachedContent: 'a cached content name such as "cachedContents/abc"',
	cache: "true or false",
	thinking: '"auto", "level" or "budget"',
	responseModalities: 'a list such as ["TEXT", "IMAGE"]',
	imageConfig: "an object",
	speechConfig: "an object",
	mediaResolution: "a string"
};

/**
 * Whether a value is a plain object.
 * @param {unknown} value - Value.
 * @returns {boolean} True for an object that is not an array or null.
 */
function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Check the `gemini` setting.
 * @param {any} value - The setting.
 * @returns {string | null} What is wrong with it, or null when it is fine.
 */
export function check(value) {
	if (!isObject(value)) return "expected an object";
	for (const [key, entry] of Object.entries(value)) {
		if (!Object.hasOwn(CHECKS, key)) return `unknown key ${key}`;
		if (!CHECKS[key](entry)) return `${key} must be ${EXPECTED[key]}`;
	}
	return null;
}

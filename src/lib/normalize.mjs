/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/normalize.mjs
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
 * @fileoverview Request normalizers shared by the OpenAI-protocol drivers.
 * @module @cldmv/llm-translator/lib/normalize
 */

/**
 * Remove tool fields that strict OpenAI-compatible servers reject when no tools are present.
 * @param {any} body - Chat Completions request body (mutated copy is returned).
 * @returns {any} Normalized body.
 */
export function noEmptyTools(body) {
	if (Array.isArray(body.tools) && body.tools.length > 0) return body;
	const rest = { ...body };
	delete rest.tools;
	delete rest.tool_choice;
	delete rest.parallel_tool_calls;
	return rest;
}

/**
 * Parse a server version string (`0.19.0rc1`, `0.32.0+cu126`) into numeric parts.
 * @param {string | undefined} version - Version string.
 * @returns {number[] | null} `[major, minor, patch]`, or null when unparseable.
 */
export function semver(version) {
	const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(version ?? ""));
	return match ? [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)] : null;
}

/**
 * Is `version` at least `minimum`? An unknown version counts as new (latest behavior).
 * @param {string | undefined} version - Version under test.
 * @param {string} minimum - Minimum version such as `"0.19.0"`.
 * @returns {boolean} True when the version is unknown or >= minimum.
 */
export function atLeast(version, minimum) {
	const have = semver(version);
	if (!have) return true;
	const need = semver(minimum);
	for (let index = 0; index < 3; index++) {
		if (have[index] !== need[index]) return have[index] > need[index];
	}
	return true;
}

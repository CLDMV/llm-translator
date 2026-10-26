/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/arguments.mjs
 *	@Date: 2026-10-25T12:28:19-07:00 (1792956499)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:01-07:00 (1792958341)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Tool-call argument parsing.
 */

/**
 * Decode arguments into a JSON object.
 * @param {unknown} args - JSON string or already-parsed value.
 * @returns {object|undefined} The object, or undefined when the value is not a JSON object.
 */
function decode(args) {
	let value = args;
	if (typeof args === "string") {
		try {
			value = JSON.parse(args);
		} catch {
			return undefined;
		}
	}
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

/**
 * Whether tool-call arguments are complete: empty, or a JSON object. Truncated JSON (a `length` stop in the middle
 * of a call) is not.
 * @param {unknown} args - Arguments as received.
 * @returns {boolean} True when the arguments parse (or are empty).
 */
export function isComplete(args) {
	return args === undefined || args === null || args === "" || decode(args) !== undefined;
}

/**
 * Parse OpenAI tool-call `arguments` into the JSON object Anthropic requires for `tool_use.input`. Anything that is
 * not a JSON object (truncated JSON from a `length` stop, a bare array, plain text) is preserved verbatim under
 * `_raw_arguments`, so the client's own input validation reports an error the model can recover from instead of the
 * translator silently inventing arguments.
 * @param {unknown} args - JSON string (or already-parsed value) from the upstream.
 * @returns {object} Input object.
 */
export function parseArguments(args) {
	if (args === undefined || args === null || args === "") return {};
	return decode(args) ?? { _raw_arguments: typeof args === "string" ? args : JSON.stringify(args) };
}

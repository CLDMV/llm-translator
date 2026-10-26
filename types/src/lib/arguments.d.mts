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
 * Whether tool-call arguments are complete: empty, or a JSON object. Truncated JSON (a `length` stop in the middle
 * of a call) is not.
 * @param {unknown} args - Arguments as received.
 * @returns {boolean} True when the arguments parse (or are empty).
 */
export declare function isComplete(args: unknown): boolean;
/**
 * Parse OpenAI tool-call `arguments` into the JSON object Anthropic requires for `tool_use.input`. Anything that is
 * not a JSON object (truncated JSON from a `length` stop, a bare array, plain text) is preserved verbatim under
 * `_raw_arguments`, so the client's own input validation reports an error the model can recover from instead of the
 * translator silently inventing arguments.
 * @param {unknown} args - JSON string (or already-parsed value) from the upstream.
 * @returns {object} Input object.
 */
export declare function parseArguments(args: unknown): object;

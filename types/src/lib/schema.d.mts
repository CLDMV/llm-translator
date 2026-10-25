/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/schema.mjs
 *	@Date: 2026-10-25T12:28:19-07:00 (1792956499)
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
 * Return a sanitized deep copy of a JSON Schema: drops `$schema` and numeric bounds at or beyond +-(2^53 - 1)
 * (Claude Code emits `maximum: 9007199254740991` on integers, which strict grammar backends dislike). The input is
 * never mutated.
 * @param {unknown} schema - JSON Schema (or any JSON value found inside one).
 * @returns {unknown} Sanitized copy.
 */
export declare function sanitize(schema: unknown): unknown;

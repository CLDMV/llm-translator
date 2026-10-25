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
 * @fileoverview JSON Schema cleanup for tool definitions.
 */

const UNBOUNDED = Number.MAX_SAFE_INTEGER;
const LIMITS = ["maximum", "minimum", "exclusiveMaximum", "exclusiveMinimum"];

/**
 * Return a sanitized deep copy of a JSON Schema: drops `$schema` and numeric bounds at or beyond +-(2^53 - 1)
 * (Claude Code emits `maximum: 9007199254740991` on integers, which strict grammar backends dislike). The input is
 * never mutated.
 * @param {unknown} schema - JSON Schema (or any JSON value found inside one).
 * @returns {unknown} Sanitized copy.
 */
export function sanitize(schema) {
	if (Array.isArray(schema)) return schema.map(sanitize);
	if (schema === null || typeof schema !== "object") return schema;
	const out = {};
	for (const [key, value] of Object.entries(schema)) {
		if (key === "$schema") continue;
		if (LIMITS.includes(key) && typeof value === "number" && Math.abs(value) >= UNBOUNDED) continue;
		out[key] = sanitize(value);
	}
	return out;
}

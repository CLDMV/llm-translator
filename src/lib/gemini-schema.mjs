/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/gemini-schema.mjs
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
 * @fileoverview JSON Schema as Gemini takes it: the keywords Gemini reads are kept, the ones it does not are removed or rewritten so a tool schema from any client does not make Google answer 400.
 * @module @cldmv/llm-translator/lib/gemini-schema
 */

/** The `format` values Gemini reads on a string. */
const FORMATS = new Set(["date-time", "date", "time"]);

/** Keywords Gemini reads that hold one schema, a list of schemas, or a map of schemas. */
const SCHEMA = new Set(["items", "additionalProperties"]);
const LISTS = new Set(["anyOf", "prefixItems"]);

/** The deepest nesting that is rewritten; a schema deeper than this (or recursive without `$ref`) is cut off with a bare object. */
const DEPTH = 24;

/**
 * Resolve a local `$ref` (`#/$defs/Name`, `#/definitions/Name`) against the root.
 * @param {any} root - The root schema.
 * @param {string} ref - The reference.
 * @returns {any} The target schema, or undefined when it does not exist or is not local.
 */
function target(root, ref) {
	const match = /^#\/(\$defs|definitions)\/(.+)$/.exec(ref);
	const found = match === null ? undefined : root?.[match[1]]?.[match[2].replaceAll("~1", "/").replaceAll("~0", "~")];
	return found !== null && typeof found === "object" ? found : undefined;
}

/**
 * Rewrite one schema node.
 * @param {any} input - The node.
 * @param {any} root - The root schema, for `$ref`.
 * @param {string[]} seen - The `$ref`s being expanded on the way down, so a recursive type is expanded once and then left as `$ref`.
 * @param {number} depth - Nesting so far.
 * @returns {any} The node as Gemini takes it.
 */
function node(input, root, seen, depth) {
	if (input === true) return {};
	if (input === null || typeof input !== "object" || Array.isArray(input) || depth > DEPTH) return {};
	let own = input;
	if (typeof own.$ref === "string") {
		const found = target(root, own.$ref);
		if (found === undefined || seen.includes(own.$ref)) return typeof own.description === "string" ? { description: own.description } : {};
		const { $ref: ___ref, ...rest } = own;
		return node({ ...found, ...rest }, root, [...seen, own.$ref], depth + 1);
	}
	const out = {};
	if (own.allOf !== undefined && Array.isArray(own.allOf)) {
		// The parts of an allOf are merged into the node: properties and required add up, the first value of anything else wins.
		const merged = { ...own };
		delete merged.allOf;
		for (const part of own.allOf.map((entry) => node(entry, root, seen, depth + 1))) {
			for (const [key, value] of Object.entries(part)) {
				if (key === "properties") merged.properties = { ...value, ...merged.properties };
				else if (key === "required") merged.required = [...new Set([...(merged.required ?? []), ...value])];
				else if (merged[key] === undefined) merged[key] = value;
			}
		}
		own = merged;
	}
	if (own.oneOf !== undefined && own.anyOf === undefined) own = { ...own, anyOf: own.oneOf };
	let type = own.type;
	if (own.nullable === true) type = [...(Array.isArray(type) ? type : type === undefined ? [] : [type]), "null"];
	if (own.const !== undefined) own = { ...own, enum: [own.const] };
	if (type !== undefined) out.type = Array.isArray(type) ? [...new Set(type)] : type;
	for (const key of ["title", "description", "minimum", "maximum", "minItems", "maxItems"]) if (own[key] !== undefined) out[key] = own[key];
	if (Array.isArray(own.enum)) out.enum = own.enum;
	if (typeof own.format === "string" && FORMATS.has(own.format)) out.format = own.format;
	if (Array.isArray(own.required)) out.required = own.required;
	if (own.properties !== null && typeof own.properties === "object" && !Array.isArray(own.properties)) {
		out.properties = Object.fromEntries(Object.entries(own.properties).map(([name, value]) => [name, node(value, root, seen, depth + 1)]));
	}
	for (const key of SCHEMA) {
		if (own[key] === undefined) continue;
		out[key] = typeof own[key] === "boolean" ? own[key] : node(own[key], root, seen, depth + 1);
	}
	for (const key of LISTS) if (Array.isArray(own[key])) out[key] = own[key].map((entry) => node(entry, root, seen, depth + 1));
	return out;
}

/**
 * A JSON Schema as Gemini takes it. Kept: `type` (a list too), `title`, `description`, `properties`, `required`, `additionalProperties`,
 * `enum`, `format` (`date-time`, `date`, `time`), `minimum`, `maximum`, `items`, `prefixItems`, `minItems`, `maxItems` and `anyOf`.
 * Rewritten: `oneOf` is `anyOf`, `const` is a one-value `enum`, `nullable: true` adds `"null"` to the type, `allOf` is merged into the node,
 * and a local `$ref` into `$defs` or `definitions` is replaced by its target (a recursive one is expanded once and then left out, since
 * Gemini's schemas are not recursive here). Removed: `$schema`, `$id`, `$comment`, `$defs`, `definitions`, `default`, `examples`,
 * `exclusiveMinimum`, `exclusiveMaximum`, `pattern`, `patternProperties`, `propertyNames`, `uniqueItems`, `not`, `if`, `then`, `else`,
 * unknown formats and every other keyword. The input is never changed.
 * @param {unknown} schema - JSON Schema.
 * @returns {any} The schema for Gemini.
 */
export function gemini(schema) {
	return node(schema, schema, [], 0);
}

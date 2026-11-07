/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/strict.mjs
 *	@Date: 2026-11-06T09:00:00-08:00 (1793984400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-06T09:00:00-08:00 (1793984400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Strict tool use: the JSON Schema subset strict backends accept, and the strict tools in an upstream body.
 * @module @cldmv/llm-translator/lib/strict
 */

/** Keywords strict schema modes (OpenAI structured outputs, Anthropic strict tool use, vLLM's grammar) do not support. */
const UNSUPPORTED = [
	"allOf",
	"not",
	"if",
	"then",
	"else",
	"dependentRequired",
	"dependentSchemas",
	"patternProperties",
	"propertyNames",
	"unevaluatedProperties",
	"contains",
	"minProperties",
	"maxProperties",
	"uniqueItems"
];

/** Keywords whose value is one subschema, a list of subschemas, or a map of subschemas. */
const ONE = ["items", "additionalProperties"];
const LIST = ["anyOf", "oneOf", "prefixItems"];
const MAP = ["properties", "$defs", "definitions"];

/**
 * Walk a schema and list what falls outside the strict subset: an object schema must say `additionalProperties: false` and list every
 * property in `required`, and the keywords in `UNSUPPORTED` are not allowed anywhere.
 * @param {any} schema - A tool's JSON Schema.
 * @param {string} [at] - Path of `schema` within the tool's schema.
 * @param {string[]} [out] - Problems found so far.
 * @returns {string[]} One line per problem, each starting with its path (`$` is the schema's root).
 */
export function problems(schema, at = "$", out = []) {
	if (schema === null || typeof schema !== "object" || Array.isArray(schema)) return out;
	const properties = schema.properties !== null && typeof schema.properties === "object" ? Object.keys(schema.properties) : [];
	if (schema.type === "object" || properties.length > 0) {
		if (schema.additionalProperties !== false) out.push(`${at}: object without additionalProperties: false`);
		const required = Array.isArray(schema.required) ? schema.required : [];
		const missing = properties.filter((name) => !required.includes(name));
		if (missing.length > 0) out.push(`${at}: properties not in required: ${missing.join(", ")}`);
	}
	for (const key of UNSUPPORTED) if (key in schema) out.push(`${at}: unsupported keyword ${key}`);
	for (const key of ONE) problems(schema[key], `${at}.${key}`, out);
	for (const key of LIST) if (Array.isArray(schema[key])) schema[key].forEach((entry, i) => problems(entry, `${at}.${key}[${i}]`, out));
	for (const key of MAP) {
		const map = schema[key];
		if (map === null || typeof map !== "object") continue;
		for (const [name, entry] of Object.entries(map)) problems(entry, `${at}.${key}.${name}`, out);
	}
	return out;
}

/**
 * The tools of an upstream body that ask for strict use, with the problems of their schemas. Reads both wire shapes: Chat Completions
 * (`function.strict`, `function.parameters`) and Anthropic Messages (`strict`, `input_schema`).
 * @param {any} body - Upstream request body.
 * @returns {{name: string, problems: string[]}[]} Strict tools in request order.
 */
export function strictTools(body) {
	const out = [];
	for (const tool of Array.isArray(body?.tools) ? body.tools : []) {
		const fn = tool?.function ?? tool;
		if (fn?.strict !== true) continue;
		out.push({ name: String(fn.name), problems: problems(fn.parameters ?? fn.input_schema) });
	}
	return out;
}

/**
 * Send the tools whose schema is outside the strict subset without `strict` (the key is removed, not set to false). Reads both wire shapes
 * like `strictTools`. Nothing in `body` is modified: tools that change are rebuilt, and the body is copied only when one did.
 * @param {any} body - Upstream request body.
 * @returns {any} `body` itself when every strict tool conforms, otherwise a copy with the rebuilt `tools`.
 */
export function relax(body) {
	if (!Array.isArray(body?.tools)) return body;
	let changed = false;
	const tools = body.tools.map((tool) => {
		const fn = tool?.function ?? tool;
		if (fn?.strict !== true || problems(fn.parameters ?? fn.input_schema).length === 0) return tool;
		changed = true;
		if (tool.function) {
			const { strict: _, ...rest } = tool.function;
			return { ...tool, function: rest };
		}
		const { strict: _, ...rest } = tool;
		return rest;
	});
	return changed ? { ...body, tools } : body;
}

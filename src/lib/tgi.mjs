/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/tgi.mjs
 *	@Date: 2026-11-13T09:00:00-08:00 (1794589200)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-13T09:00:00-08:00 (1794589200)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Text Generation Inference quirks shared by the TGI driver's request, response and chunk normalizers.
 * @module @cldmv/llm-translator/lib/tgi
 */

/** Finish reasons TGI names itself that OpenAI clients do not know: `eos_token` and `stop_sequence` are both a plain stop. */
const STOPS = new Set(["eos_token", "stop_sequence"]);

/**
 * One tool call in the OpenAI shape. Historic TGI sent the id as a number, the arguments as an object (under `parameters` in some
 * releases) and omitted `type`; current TGI sends string arguments.
 * @param {any} call - Tool call as TGI sent it.
 * @param {number} [position] - Position in the call list, the id when TGI sent none. Left out for streamed fragments, whose missing id
 * means the fragment continues the open call.
 * @returns {any} Tool call with a string id, `type: "function"` and string `arguments`.
 */
export function toolCall(call, position) {
	if (call === null || typeof call !== "object") return call;
	const out = { ...call };
	if (out.id === undefined || out.id === null) {
		if (position !== undefined) out.id = String(position);
	} else if (typeof out.id !== "string") out.id = String(out.id);
	if (out.type === undefined) out.type = "function";
	if (out.function !== null && typeof out.function === "object") out.function = functionOf(out.function);
	return out;
}

/**
 * A `function` object with its arguments as a JSON string (`parameters` is TGI's older name for them).
 * @param {any} fn - `function` as TGI sent it.
 * @returns {any} Function with string `arguments`.
 */
function functionOf(fn) {
	const { parameters, ...rest } = fn;
	const args = rest.arguments ?? parameters;
	if (args === undefined) return rest;
	return { ...rest, arguments: typeof args === "string" ? args : JSON.stringify(args) };
}

/**
 * The tool calls of a message or delta as a list: historic TGI sent one object instead of an array.
 * @param {any} value - `tool_calls` as TGI sent it.
 * @param {boolean} [fill] - Give a call without an id its position as the id (whole answers; not streamed fragments).
 * @returns {any[] | undefined} The list, or undefined when there is none.
 */
export function toolCalls(value, fill = false) {
	if (value === undefined || value === null) return undefined;
	return (Array.isArray(value) ? value : [value]).map((call, position) => toolCall(call, fill ? position : undefined));
}

/**
 * The OpenAI `finish_reason` for one TGI sent: `eos_token` and `stop_sequence` become `stop`, or `tool_calls` when the answer holds tool calls
 * (historic TGI reported `eos_token` for those).
 * @param {any} reason - `finish_reason` as TGI sent it.
 * @param {boolean} hasToolCalls - Whether the answer holds tool calls.
 * @returns {any} Finish reason.
 */
export function finish(reason, hasToolCalls) {
	if (typeof reason !== "string") return reason;
	if (STOPS.has(reason) || reason === "stop") return hasToolCalls ? "tool_calls" : "stop";
	return reason;
}

/**
 * TGI's grammar as `response_format` takes it: `{ type: "json" | "json_object" | "regex", value }` or `{ type: "json_schema", value: { name?, schema } }`.
 * An OpenAI `json_schema` format (`{ type: "json_schema", json_schema: { name, schema, strict } }`) becomes TGI's `json_schema` with
 * the name and schema; a bare `json_object` has no schema to constrain with, so it asks for any JSON object. Shapes TGI already
 * understands pass through.
 * @param {any} format - A `response_format` (or `grammar`) value.
 * @returns {any} The format in TGI's shape.
 */
export function grammar(format) {
	if (format === null || typeof format !== "object") return format;
	if (format.type === "json_schema" && format.value === undefined && format.json_schema?.schema !== undefined) {
		const { name, schema } = format.json_schema;
		return { type: "json_schema", value: name === undefined ? { schema } : { name, schema } };
	}
	if (format.type === "json_object" && format.value === undefined) return { type: "json", value: { type: "object" } };
	return format;
}

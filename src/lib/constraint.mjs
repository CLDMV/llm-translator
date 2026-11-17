/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/constraint.mjs
 *	@Date: 2026-11-14T09:00:00-08:00 (1794333600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-14T09:00:00-08:00 (1794333600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Neutral constrained-decoding description (`json`, `regex`, `choice`, `grammar`) and its translation to each backend's native request fields.
 * @module @cldmv/llm-translator/lib/constraint
 */
import { atLeast } from "./normalize.mjs";
import { TranslatorError } from "./errors.mjs";

/** The constraint kinds a client can ask for. */
export const KINDS = ["json", "regex", "choice", "grammar"];

/** First vLLM release whose Chat Completions endpoint takes `structured_outputs`; older releases take `guided_json`, `guided_regex`, `guided_choice` and `guided_grammar`. */
export const STRUCTURED_OUTPUTS_VERSION = "0.11.0";

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * What is wrong with a constraint value, if anything.
 * @param {any} value - A `constraint` setting or request value.
 * @returns {string | null} A message, or null when the value is a valid constraint (or absent).
 */
export function check(value) {
	if (value === undefined || value === null) return null;
	if (typeof value !== "object" || Array.isArray(value)) return `expected an object with one of ${KINDS.join(", ")}`;
	const kinds = Object.keys(value).filter((key) => value[key] !== undefined && value[key] !== null);
	if (kinds.length !== 1 || !KINDS.includes(kinds[0])) return `expected exactly one of ${KINDS.join(", ")}`;
	const [kind] = kinds;
	const given = value[kind];
	if (kind === "json" && (typeof given !== "object" || Array.isArray(given))) return "json must be a JSON Schema object";
	if ((kind === "regex" || kind === "grammar") && (typeof given !== "string" || given === "")) return `${kind} must be a non-empty string`;
	if (kind === "choice" && !(Array.isArray(given) && given.length > 0 && given.every((item) => typeof item === "string" && item !== "")))
		return "choice must be a non-empty list of non-empty strings";
	return null;
}

/**
 * The fields to add to a Chat Completions body for one constraint, or null when the backend cannot enforce that kind.
 * @param {string} driver - Driver name.
 * @param {string | undefined} version - Server version (vLLM), when known.
 * @param {string} kind - One of {@link KINDS}.
 * @param {any} value - The constraint's value.
 * @returns {Record<string, any> | null} Body fields, or null when unsupported.
 */
export function fields(driver, version, kind, value) {
	const alternation = () => `(?:${value.map(escape).join("|")})`;
	const schema = { type: "json_schema", json_schema: { name: "constraint", schema: value, strict: true } };
	switch (driver) {
		case "vllm":
		case "compatible":
			return atLeast(version, STRUCTURED_OUTPUTS_VERSION) ? { structured_outputs: { [kind]: value } } : { [`guided_${kind}`]: value };
		case "sglang":
			if (kind === "json") return { response_format: schema };
			if (kind === "regex") return { regex: value };
			if (kind === "choice") return { regex: alternation() };
			return { ebnf: value };
		case "llamacpp":
			if (kind === "json") return { json_schema: value };
			if (kind === "grammar") return { grammar: value };
			if (kind === "choice") return { grammar: `root ::= ${value.map((item) => JSON.stringify(item)).join(" | ")}` };
			return null;
		case "tgi":
			if (kind === "json") return { response_format: { type: "json", value } };
			if (kind === "regex") return { response_format: { type: "regex", value } };
			if (kind === "choice") return { response_format: { type: "regex", value: alternation() } };
			return null;
		default:
			return kind === "json" ? { response_format: schema } : null;
	}
}

/**
 * Add a constraint to an OpenAI-protocol body in the backend's own fields. The request's constraint (`constraint` on the OpenAI front,
 * `metadata.constraint` on the Anthropic front) replaces the upstream's `constraint` setting. A body that already carries the native field
 * keeps it. vLLM applies a constraint to the whole generation, so with tools on offer the constraint is dropped and recorded (the tools win).
 * A kind the backend cannot enforce follows `unknownFields`: dropped (listed in `dropped`) or rejected.
 * @param {any} body - Converted or forwarded Chat Completions body.
 * @param {any} asked - The request's constraint, if any.
 * @param {any} settings - Resolved settings (`constraint`, `unknownFields`).
 * @param {{ name: string, version?: string }} target - The upstream's driver name and server version.
 * @param {string[]} [dropped] - Receives `constraint` names that were left out.
 * @returns {any} The body, with the fields added (a copy when anything was added).
 * @throws {TranslatorError} `invalid_request` for a malformed request constraint; `unsupported_field` when the backend cannot enforce the kind and `unknownFields` is `"error"`.
 */
export function addConstraint(body, asked, settings, target, dropped = []) {
	const problem = check(asked);
	if (problem !== null) throw new TranslatorError(`constraint: ${problem}`, { code: "invalid_request", param: "constraint" });
	const wanted = asked ?? settings.constraint;
	if (wanted === undefined || wanted === null) return body;
	const kind = KINDS.find((name) => wanted[name] !== undefined && wanted[name] !== null);
	const note = (name) => {
		if (!dropped.includes(name)) dropped.push(name);
	};
	const native = fields(target.name, target.version, kind, wanted[kind]);
	if (native === null) {
		if (settings.unknownFields === "error")
			throw new TranslatorError(`constraint.${kind}: is not accepted by this upstream`, {
				code: "unsupported_field",
				param: `constraint.${kind}`
			});
		note(`constraint.${kind}`);
		return body;
	}
	if (["vllm", "compatible"].includes(target.name) && Array.isArray(body.tools) && body.tools.length > 0 && body.tool_choice !== "none") {
		note(`constraint.${kind}`);
		return body;
	}
	if (Object.keys(native).some((name) => Object.hasOwn(body, name))) return body;
	return { ...body, ...native };
}

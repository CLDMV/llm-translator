/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/prompts.mjs
 *	@Date: 2026-11-23T12:00:00-08:00 (1795550400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-23T12:00:00-08:00 (1795550400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Stored prompts of the Responses API (`prompt: { id, version?, variables? }`): the `responses.prompts` setting, looking a prompt up and
 * filling in its `{{name}}` variables.
 * @module @cldmv/llm-translator/lib/prompts
 */
import { TranslatorError } from "./errors.mjs";

const TOKEN = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;
const WHOLE = /^\s*\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}\s*$/;
/** The content parts a variable can be. */
const PARTS = ["input_text", "input_image", "input_file"];

/**
 * Throw an invalid `responses.prompts` setting.
 * @param {string} key - Setting key.
 * @param {any} value - The value.
 * @param {string} expected - What was expected.
 * @throws {TranslatorError} `invalid_setting`.
 */
function invalid(key, value, expected) {
	throw new TranslatorError(`Invalid setting ${key}: ${JSON.stringify(value)} (${expected})`, {
		code: "invalid_setting",
		status: 500,
		details: { key }
	});
}

/**
 * A client error about the `prompt` parameter.
 * @param {string} message - Message.
 * @param {string} code - Error code.
 * @returns {TranslatorError} 400 with param `prompt`.
 */
function fail(message, code) {
	return new TranslatorError(message, { code, status: 400, type: "invalid_request_error", param: "prompt" });
}

/**
 * Whether a configured value is one prompt (it has `instructions` or `input`) and not a map of versions.
 * @param {any} value - Configured value.
 * @returns {boolean} True for a prompt.
 */
function single(value) {
	return value !== null && typeof value === "object" && (Object.hasOwn(value, "instructions") || Object.hasOwn(value, "input"));
}

/**
 * Check one prompt of the setting.
 * @param {any} value - The prompt.
 * @param {string} key - Setting key, for errors.
 * @throws {TranslatorError} `invalid_setting`.
 */
function check(value, key) {
	if (!single(value)) invalid(key, value, "expected a prompt with instructions and/or input");
	for (const name of Object.keys(value))
		if (name !== "instructions" && name !== "input")
			invalid(`${key}.${name}`, value[name], "not a prompt field; expected instructions or input");
	if (value.instructions !== undefined && typeof value.instructions !== "string")
		invalid(`${key}.instructions`, value.instructions, "expected a string");
	if (value.input !== undefined && typeof value.input !== "string" && !Array.isArray(value.input))
		invalid(`${key}.input`, value.input, "expected a string or a list of input items");
}

/**
 * Check the `responses.prompts` setting: an object that maps a prompt id to one prompt (`{ instructions?, input? }`, at least one of them) or to a
 * map of versions, each a prompt.
 * @param {any} value - The setting.
 * @returns {Record<string, any>} The setting.
 * @throws {TranslatorError} `invalid_setting`.
 */
export function normalize(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		invalid("responses.prompts", value, "expected an object that maps prompt ids to prompts");
	for (const [id, entry] of Object.entries(value)) {
		const key = `responses.prompts.${id}`;
		if (entry !== null && typeof entry === "object" && !Array.isArray(entry) && !single(entry)) {
			const versions = Object.entries(entry);
			if (versions.length === 0) invalid(key, entry, "a map of versions needs at least one version");
			for (const [version, prompt] of versions) check(prompt, `${key}.${version}`);
		} else {
			check(entry, key);
		}
	}
	return value;
}

/**
 * Find the prompt a request asks for and check its variables.
 * @param {Record<string, any>} prompts - The `responses.prompts` setting.
 * @param {any} reference - The request's `prompt`.
 * @returns {{ id: string, version: string | null, variables: Record<string, any>, prompt: { instructions?: string, input?: string | any[] } }} The prompt and what to echo.
 * @throws {TranslatorError} 400 with param `prompt` for a malformed reference, an unknown id or version, or bad variables.
 */
export function lookup(prompts, reference) {
	if (reference === null || typeof reference !== "object" || Array.isArray(reference) || typeof reference.id !== "string") {
		throw fail("prompt: expected an object with the prompt's id", "invalid_prompt");
	}
	const { id } = reference;
	if (!Object.hasOwn(prompts, id)) throw fail(`Prompt with id '${id}' not found.`, "prompt_not_found");
	const entry = prompts[id];
	const asked = reference.version === undefined || reference.version === null ? null : String(reference.version);
	let version = null;
	let prompt = entry;
	if (single(entry)) {
		if (asked !== null) throw fail(`Prompt '${id}' has no versions, so version '${asked}' does not exist.`, "prompt_version_not_found");
	} else {
		// With no version asked for, the last one in the map is used (the highest, for numeric versions).
		version = asked ?? Object.keys(entry).at(-1);
		if (!Object.hasOwn(entry, version)) throw fail(`Version '${version}' of prompt '${id}' not found.`, "prompt_version_not_found");
		prompt = entry[version];
	}
	const variables = reference.variables ?? {};
	if (typeof variables !== "object" || Array.isArray(variables)) throw fail("prompt.variables: expected an object", "invalid_prompt");
	for (const [name, value] of Object.entries(variables)) {
		const part =
			value !== null &&
			typeof value === "object" &&
			PARTS.includes(value.type) &&
			(value.type !== "input_text" || typeof value.text === "string");
		if (typeof value !== "string" && !part)
			throw fail(`prompt.variables.${name}: expected a string or an input_text, input_image or input_file part`, "invalid_prompt");
	}
	return { id, version, variables, prompt };
}

/**
 * Fill in a prompt's variables.
 * @param {{ instructions?: string, input?: string | any[] }} prompt - The prompt.
 * @param {Record<string, any>} variables - Values by name: strings, or content parts.
 * @returns {{ instructions: string | null, items: any[] }} The prompt's instructions (null when it has none) and its input as items.
 * @throws {TranslatorError} 400 with param `prompt` for a variable that is not given, or a content part used inside other text.
 */
export function apply(prompt, variables) {
	const valueOf = (name) => {
		if (!Object.hasOwn(variables, name)) throw fail(`Variable '${name}' is not provided.`, "prompt_variable_missing");
		return variables[name];
	};
	const text = (string) =>
		string.replace(TOKEN, (_, name) => {
			const value = valueOf(name);
			if (typeof value !== "string") {
				throw fail(`Variable '${name}' is a content part: it can only stand alone as a whole input_text part`, "invalid_prompt");
			}
			return value;
		});
	const parts = (list) =>
		list.map((part) => {
			if ((part?.type !== "input_text" && part?.type !== "output_text") || typeof part.text !== "string") return part;
			const whole = WHOLE.exec(part.text);
			const value = whole === null ? "" : valueOf(whole[1]);
			return typeof value === "string" ? { ...part, text: text(part.text) } : { ...value };
		});
	const content = (value) => {
		if (!Array.isArray(value)) {
			if (typeof value !== "string") return value;
			const [part] = parts([{ type: "input_text", text: value }]);
			return part.type === "input_text" ? part.text : [part];
		}
		return parts(value);
	};
	const input = prompt.input ?? [];
	const list = typeof input === "string" ? [{ type: "message", role: "user", content: input }] : input;
	return {
		instructions: prompt.instructions === undefined ? null : text(prompt.instructions),
		items: list.map((item) =>
			item !== null && typeof item === "object" && Object.hasOwn(item, "content") ? { ...item, content: content(item.content) } : item
		)
	};
}

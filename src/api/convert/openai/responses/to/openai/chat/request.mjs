/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/convert/openai/responses/to/openai/chat/request.mjs
 *	@Date: 2026-11-17T12:00:00-08:00 (1794945600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-17T12:00:00-08:00 (1794945600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview OpenAI Responses request to OpenAI Chat Completions request.
 */

import { resolve } from "../../../../../../../lib/settings.mjs";
import { TranslatorError } from "../../../../../../../lib/errors.mjs";
import { unpack } from "../../../../../../../lib/responses.mjs";

/** Request fields with a mapping (see `docs/protocol-support.md`). */
const HANDLED = new Set([
	"model",
	"input",
	"instructions",
	"tools",
	"tool_choice",
	"parallel_tool_calls",
	"text",
	"reasoning",
	"max_output_tokens",
	"temperature",
	"top_p",
	"stream",
	"user",
	"safety_identifier",
	"metadata",
	"service_tier",
	"prompt_cache_key",
	"include",
	"stream_options",
	"store",
	"background",
	"previous_response_id",
	"conversation",
	"prompt",
	"truncation"
]);
/** Fields that only make sense with a response store: any value other than the stateless default is refused. */
const STATEFUL = ["previous_response_id", "conversation", "prompt"];

/**
 * Convert an OpenAI Responses request body into a Chat Completions request body, the pivot every upstream is reached through.
 *
 * The core is stateless: `previous_response_id`, `conversation`, `store: true`, `background: true` and stored prompts are refused, and so are hosted tools,
 * non-function `tool_choice` values and input items other than messages, function calls, function call outputs and reasoning items.
 * `instructions` becomes the first system message. Reasoning items are replayed to the upstream only with `reasoningRoundTrip` (their
 * `encrypted_content` carries the `reasoning_details` the converter put there); otherwise they are dropped. Fields without a mapping are
 * dropped and listed in `state.dropped`, or refused when `unknownFields` is `"error"`.
 * @param {any} body - OpenAI `POST /v1/responses` body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {{ body: any, state: any }} Chat Completions body and the state the reply converters need (`model`, `stream`, `echo`, `dropped`).
 * @throws {TranslatorError} `invalid_request` for a malformed body, `unsupported_field` for stateful parameters and unmapped fields under `unknownFields: "error"`, `unsupported_tool` and `unsupported_content` for what has no counterpart.
 */
export function request(body, settings) {
	const s = resolve(settings);
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		throw new TranslatorError("The request body must be a JSON object", { code: "invalid_request", param: null });
	}
	if (typeof body.input !== "string" && !Array.isArray(body.input)) {
		throw new TranslatorError("input is a required property and must be a string or an array of items", {
			code: "invalid_request",
			param: "input"
		});
	}
	const state = { model: body.model, stream: body.stream === true, dropped: [], echo: {} };
	for (const name of STATEFUL) {
		if (body[name] !== undefined && body[name] !== null)
			refuse(`${name}: stateful requests are not supported (there is no response store)`, name);
	}
	if (body.store === true) refuse("store: responses are not stored; send store: false or omit it", "store");
	if (body.background === true) refuse("background: background responses are not supported", "background");
	for (const key of Object.keys(body)) {
		if (HANDLED.has(key)) continue;
		skip(state, s, key, `${key}: Unrecognized request argument`);
	}
	if (typeof body.truncation === "string" && body.truncation !== "disabled")
		skip(state, s, "truncation", 'truncation: only "disabled" is supported');

	const messages = [];
	if (typeof body.instructions === "string" && body.instructions !== "") messages.push({ role: "system", content: body.instructions });
	const carried = s.reasoningRoundTrip;
	/** Reasoning waiting for the assistant output it belongs to. */
	let pending = null;
	/**
	 * Hand the waiting reasoning to an assistant message; reasoning it already has is kept and the new one follows it.
	 * @param {any} target - Chat assistant message.
	 */
	const give = (target) => {
		if (pending === null) return;
		if (pending.text !== "")
			target[s.reasoningField] = target[s.reasoningField] ? `${target[s.reasoningField]}\n\n${pending.text}` : pending.text;
		if (pending.details !== null) target.reasoning_details = [...(target.reasoning_details ?? []), ...pending.details];
		pending = null;
	};
	/**
	 * The assistant message a function call belongs to: the one just written when the input continues it, else a new one.
	 * @returns {any} Chat assistant message.
	 */
	const assistant = () => {
		let target = messages.at(-1);
		if (target?.role !== "assistant") {
			target = { role: "assistant", content: null };
			messages.push(target);
		}
		give(target);
		return target;
	};
	const items = typeof body.input === "string" ? [{ type: "message", role: "user", content: body.input }] : body.input;
	items.forEach((item, position) => {
		const at = `input[${position}]`;
		if (item === null || typeof item !== "object" || Array.isArray(item)) {
			throw new TranslatorError(`${at}: an input item must be an object`, { code: "invalid_request", param: at });
		}
		const type = item.type ?? (item.role === undefined ? undefined : "message");
		if (type === "message") {
			const message = messageOf(item, at);
			if (message.role === "assistant") {
				messages.push(message);
				give(message);
			} else {
				pending = null;
				messages.push(message);
			}
		} else if (type === "function_call") {
			const target = assistant();
			(target.tool_calls ??= []).push({
				id: required(item.call_id, `${at}.call_id`),
				type: "function",
				function: { name: required(item.name, `${at}.name`), arguments: typeof item.arguments === "string" ? item.arguments : "{}" }
			});
		} else if (type === "function_call_output") {
			pending = null;
			messages.push({ role: "tool", tool_call_id: required(item.call_id, `${at}.call_id`), content: outputText(item.output, at) });
		} else if (type === "reasoning") {
			const summary = (item.summary ?? []).filter((part) => typeof part?.text === "string").map((part) => part.text);
			const content = (item.content ?? []).filter((part) => typeof part?.text === "string").map((part) => part.text);
			const details = unpack(item.encrypted_content);
			if (carried) pending = { text: (summary.length > 0 ? summary : content).join("\n\n"), details };
			else if (!state.dropped.includes("reasoning")) state.dropped.push("reasoning");
		} else {
			throw new TranslatorError(`${at}: unsupported input item type ${JSON.stringify(type ?? null)}`, {
				code: "unsupported_content",
				param: at
			});
		}
	});

	const out = { model: body.model, messages };
	if (state.stream) {
		out.stream = true;
		out.stream_options = { include_usage: true };
	}
	if (body.max_output_tokens !== undefined && body.max_output_tokens !== null) out.max_completion_tokens = body.max_output_tokens;
	if (body.temperature !== undefined && body.temperature !== null) out.temperature = body.temperature;
	if (body.top_p !== undefined && body.top_p !== null) out.top_p = body.top_p;
	if (typeof (body.user ?? body.safety_identifier) === "string") out.user = body.user ?? body.safety_identifier;
	if (body.metadata !== undefined && body.metadata !== null) out.metadata = body.metadata;
	if (typeof body.service_tier === "string") out.service_tier = body.service_tier;
	if (typeof body.prompt_cache_key === "string") out.prompt_cache_key = body.prompt_cache_key;
	if (typeof body.reasoning?.effort === "string") out.reasoning_effort = body.reasoning.effort;

	const tools = (body.tools ?? []).map((tool, position) => toolOf(tool, `tools[${position}]`));
	if (tools.length > 0) {
		out.tools = tools;
		if (body.tool_choice !== undefined && body.tool_choice !== null) out.tool_choice = choiceOf(body.tool_choice);
		if (typeof body.parallel_tool_calls === "boolean") out.parallel_tool_calls = body.parallel_tool_calls;
	}
	const format = body.text?.format;
	if (format?.type === "json_object") out.response_format = { type: "json_object" };
	else if (format?.type === "json_schema") {
		if (typeof format.name !== "string" || format.schema === null || typeof format.schema !== "object") {
			throw new TranslatorError("text.format: a json_schema format needs a name and a schema", {
				code: "invalid_request",
				param: "text.format"
			});
		}
		const { type: _, schema, ...rest } = format;
		out.response_format = { type: "json_schema", json_schema: { ...rest, schema } };
	} else if (format !== undefined && format?.type !== "text") {
		throw new TranslatorError(`text.format: unsupported format type ${JSON.stringify(format?.type ?? null)}`, {
			code: "unsupported_field",
			param: "text.format"
		});
	}
	if (typeof body.text?.verbosity === "string") out.verbosity = body.text.verbosity;

	state.echo = {
		instructions: typeof body.instructions === "string" ? body.instructions : null,
		max_output_tokens: body.max_output_tokens ?? null,
		parallel_tool_calls: body.parallel_tool_calls ?? true,
		previous_response_id: null,
		reasoning: { effort: body.reasoning?.effort ?? null, summary: body.reasoning?.summary ?? null },
		store: false,
		temperature: body.temperature ?? null,
		text: { format: body.text?.format ?? { type: "text" } },
		tool_choice: body.tool_choice ?? "auto",
		tools: body.tools ?? [],
		top_p: body.top_p ?? null,
		truncation: "disabled",
		user: out.user ?? null,
		metadata: body.metadata ?? {}
	};
	return { body: out, state };
}

/**
 * Refuse a request for a feature the stateless core does not have.
 * @param {string} message - Error message.
 * @param {string} param - Offending parameter.
 * @throws {TranslatorError} Always, `unsupported_field`.
 */
function refuse(message, param) {
	throw new TranslatorError(message, { code: "unsupported_field", param });
}

/**
 * Handle a field that has no mapping: refuse it under `unknownFields: "error"`, else record it once as dropped.
 * @param {{ dropped: string[] }} state - Conversion state.
 * @param {any} s - Resolved settings.
 * @param {string} key - Field name.
 * @param {string} message - Message for the refusal.
 */
function skip(state, s, key, message) {
	if (s.unknownFields === "error") refuse(message, key);
	state.dropped.push(key);
}

/**
 * A required string field of an item.
 * @param {unknown} value - Field value.
 * @param {string} at - Path of the field, for the error.
 * @returns {string} The value.
 * @throws {TranslatorError} `invalid_request` when it is not a non-empty string.
 */
function required(value, at) {
	if (typeof value !== "string" || value === "") throw new TranslatorError(`${at} is required`, { code: "invalid_request", param: at });
	return value;
}

/**
 * Text of a function call output: a string, or input text parts.
 * @param {unknown} output - `output` of a `function_call_output` item.
 * @param {string} at - Path of the item.
 * @returns {string} Output text.
 * @throws {TranslatorError} `unsupported_content` for a part other than text.
 */
function outputText(output, at) {
	if (typeof output === "string") return output;
	if (!Array.isArray(output))
		throw new TranslatorError(`${at}.output must be a string or an array of text parts`, {
			code: "invalid_request",
			param: `${at}.output`
		});
	return output
		.map((part) => {
			if (part?.type === "input_text" && typeof part.text === "string") return part.text;
			throw new TranslatorError(`${at}.output: unsupported part type ${JSON.stringify(part?.type ?? null)}`, {
				code: "unsupported_content",
				param: `${at}.output`
			});
		})
		.join("");
}

/**
 * A Chat message for a Responses `message` item.
 * @param {any} item - Message item.
 * @param {string} at - Path of the item.
 * @returns {any} Chat message.
 * @throws {TranslatorError} For an unknown role or a content part that has no Chat counterpart.
 */
function messageOf(item, at) {
	const role = item.role;
	if (role !== "user" && role !== "assistant" && role !== "system" && role !== "developer") {
		throw new TranslatorError(`${at}.role: unsupported role ${JSON.stringify(role ?? null)}`, {
			code: "invalid_request",
			param: `${at}.role`
		});
	}
	if (typeof item.content === "string") return { role, content: item.content };
	if (!Array.isArray(item.content))
		throw new TranslatorError(`${at}.content must be a string or an array of parts`, { code: "invalid_request", param: `${at}.content` });
	const parts = [];
	let refusal;
	item.content.forEach((part, position) => {
		const where = `${at}.content[${position}]`;
		if ((part?.type === "input_text" || part?.type === "output_text") && typeof part.text === "string")
			parts.push({ type: "text", text: part.text });
		else if (part?.type === "refusal" && role === "assistant" && typeof part.refusal === "string") refusal = (refusal ?? "") + part.refusal;
		else if (part?.type === "input_image" && role === "user") {
			// A stored file (`file_id`) goes on as the image's url: the translator's file store reads it before conversion (Chat Completions has no file id for images).
			const url = typeof part.image_url === "string" ? part.image_url : part.file_id;
			if (typeof url !== "string") {
				throw new TranslatorError(`${where}: an image must carry image_url or file_id`, {
					code: "unsupported_content",
					param: where
				});
			}
			parts.push({
				type: "image_url",
				image_url: { url, ...(typeof part.detail === "string" && part.detail !== "auto" ? { detail: part.detail } : {}) }
			});
		} else if (part?.type === "input_file" && role === "user") {
			// The same `file` part Chat Completions has: a stored file by `file_id`, the bytes as a `file_data` data URL, or a `file_url` (which only counts when
			// it is the only source, and which the root api fetches like a URL document).
			const file = {};
			for (const key of ["file_id", "file_data", "filename"]) if (typeof part[key] === "string") file[key] = part[key];
			if (file.file_id === undefined && file.file_data === undefined && typeof part.file_url === "string") file.file_url = part.file_url;
			if (file.file_id === undefined && file.file_data === undefined && file.file_url === undefined) {
				throw new TranslatorError(`${where}: a file must carry file_id, file_data or file_url`, {
					code: "unsupported_content",
					param: where
				});
			}
			parts.push({ type: "file", file });
		} else {
			throw new TranslatorError(`${where}: unsupported content part type ${JSON.stringify(part?.type ?? null)}`, {
				code: "unsupported_content",
				param: where
			});
		}
	});
	if (role === "user") return { role, content: parts };
	const text = parts.map((part) => part.text).join("");
	return { role, content: text === "" && refusal !== undefined ? null : text, ...(refusal === undefined ? {} : { refusal }) };
}

/**
 * A Chat tool for a Responses function tool.
 * @param {any} tool - Responses tool.
 * @param {string} at - Path of the tool.
 * @returns {any} Chat tool.
 * @throws {TranslatorError} `unsupported_tool` for hosted tools and custom tools.
 */
function toolOf(tool, at) {
	if (tool?.type !== "function") {
		throw new TranslatorError(`${at}: unsupported tool type ${JSON.stringify(tool?.type ?? null)} (only function tools are supported)`, {
			code: "unsupported_tool",
			param: at
		});
	}
	const fn = { name: required(tool.name, `${at}.name`) };
	if (typeof tool.description === "string") fn.description = tool.description;
	if (tool.parameters !== undefined && tool.parameters !== null) fn.parameters = tool.parameters;
	if (typeof tool.strict === "boolean") fn.strict = tool.strict;
	return { type: "function", function: fn };
}

/**
 * Chat `tool_choice` for a Responses one.
 * @param {any} choice - Responses `tool_choice`.
 * @returns {any} Chat `tool_choice`.
 * @throws {TranslatorError} `unsupported_field` for allowed-tools and hosted tool choices.
 */
function choiceOf(choice) {
	if (choice === "auto" || choice === "none" || choice === "required") return choice;
	if (choice?.type === "function" && typeof choice.name === "string") return { type: "function", function: { name: choice.name } };
	throw new TranslatorError(`tool_choice: unsupported value ${JSON.stringify(choice?.type ?? choice)}`, {
		code: "unsupported_field",
		param: "tool_choice"
	});
}

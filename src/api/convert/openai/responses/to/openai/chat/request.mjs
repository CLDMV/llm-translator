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
import { unpack, unsummarize, COMPACTED } from "../../../../../../../lib/responses.mjs";
import { rowOf, refusal, functionOf, shellText, argumentsOf, mcpItem } from "../../../../../../../lib/responses-tools.mjs";

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
 * The core is stateless: `previous_response_id`, `conversation`, `store: true`, `background: true` and stored prompts are refused (the routes resolve
 * them first when a response store is on). Tools are classified by the table in `lib/responses-tools.mjs`: function and custom tools map, `web_search`,
 * `code_interpreter` and `tool_search` become function tools marked for the hosted tool runner (`lib/hostedtools.mjs`, which needs a `serverTools`
 * executor and refuses the request without one), `shell` and `apply_patch` become functions whose calls the reply converters return as their client-executed
 * items, and every other type is refused with `unsupported_tool`. Input items other than messages, function and custom calls and their outputs, `shell` and
 * `apply_patch` calls and outputs, hosted `web_search_call`, `code_interpreter_call` and `tool_search` items, `compaction` items and reasoning items are refused.
 * `instructions` becomes the first system message. Reasoning items are replayed to the upstream only with `reasoningRoundTrip` (their
 * `encrypted_content` carries the `reasoning_details` the converter put there); otherwise they are dropped. Fields without a mapping are
 * dropped and listed in `state.dropped`, or refused when `unknownFields` is `"error"`.
 * @param {any} body - OpenAI `POST /v1/responses` body.
 * @param {Partial<import("../../../../../../../lib/settings.mjs").Settings>} [settings] - Translator settings.
 * @returns {{ body: any, state: any }} Chat Completions body and the state the reply converters need (`model`, `stream`, `echo`, `dropped`).
 * @throws {TranslatorError} `invalid_request` for a malformed body, `unsupported_field` for stateful parameters, a `context_management` entry that is not a compaction and unmapped fields under `unknownFields: "error"`, `unsupported_tool` and `unsupported_content` for what has no counterpart.
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
	const state = { model: body.model, stream: body.stream === true, dropped: [], echo: {}, clientTools: {} };
	// With `hostedTools: "native"` the tools, items and tool choice the translator cannot emulate are kept in marked form: `send` refuses them unless the
	// request goes to an upstream on the Responses API, which gets them as they are (see `lib/hostedtools.mjs`).
	const native = s.hostedTools === "native";
	for (const name of STATEFUL) {
		if (body[name] !== undefined && body[name] !== null)
			refuse(`${name}: stateful requests are not supported (there is no response store)`, name);
	}
	if (body.store === true) refuse("store: responses are not stored; send store: false or omit it", "store");
	if (body.background === true) refuse("background: background responses are not supported", "background");
	const compact = compactionOf(body.context_management);
	for (const key of Object.keys(body)) {
		if (HANDLED.has(key) || (key === "context_management" && compact !== null)) continue;
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
		if (target?.role !== "assistant" || target.llmt_native !== undefined) {
			target = { role: "assistant", content: null };
			messages.push(target);
		}
		give(target);
		return target;
	};
	/**
	 * Add the call and the (marked) result messages of a hosted item the client replays.
	 * @param {string} type - Item type.
	 * @param {any} item - The item.
	 * @param {string} at - Path of the item.
	 * @returns {void}
	 */
	const replay = (type, item, at) => {
		const kind = type === "web_search_call" ? "web_search" : type === "code_interpreter_call" ? "code_interpreter" : "tool_search";
		const id = typeof item.call_id === "string" && item.call_id !== "" ? item.call_id : required(item.id, `${at}.id`);
		if (type !== "tool_search_output") {
			const input =
				kind === "web_search"
					? { query: item.action?.query ?? item.action?.queries?.[0] ?? "" }
					: kind === "code_interpreter"
						? { code: typeof item.code === "string" ? item.code : "" }
						: item.arguments;
			(assistant().tool_calls ??= []).push({
				id,
				type: "function",
				function: { name: kind, arguments: argumentsOf(input) },
				llmt_item: item
			});
		}
		// The tool_search call has no result of its own: its output item carries it. `paired` says the call's own item is already on the call.
		if (type !== "tool_search_call") {
			pending = null;
			messages.push({ role: "tool", tool_call_id: id, content: "", llmt_hosted: { kind, item, paired: type !== "tool_search_output" } });
		}
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
		} else if (type === "custom_tool_call") {
			const target = assistant();
			(target.tool_calls ??= []).push({
				id: required(item.call_id, `${at}.call_id`),
				type: "custom",
				custom: { name: required(item.name, `${at}.name`), input: typeof item.input === "string" ? item.input : "" }
			});
		} else if (type === "custom_tool_call_output") {
			pending = null;
			messages.push({ role: "tool", tool_call_id: required(item.call_id, `${at}.call_id`), content: outputText(item.output, at) });
		} else if (type === "shell_call" || type === "apply_patch_call") {
			const shell = type === "shell_call";
			const target = assistant();
			(target.tool_calls ??= []).push({
				id: required(item.call_id, `${at}.call_id`),
				type: "function",
				function: { name: shell ? "shell" : "apply_patch", arguments: argumentsOf(shell ? item.action : item.operation) }
			});
		} else if (type === "shell_call_output") {
			pending = null;
			messages.push({ role: "tool", tool_call_id: required(item.call_id, `${at}.call_id`), content: shellText(item.output) });
		} else if (type === "apply_patch_call_output") {
			pending = null;
			const status = typeof item.status === "string" ? item.status : "completed";
			const note = typeof item.output === "string" && item.output !== "" ? `\n${item.output}` : "";
			messages.push({ role: "tool", tool_call_id: required(item.call_id, `${at}.call_id`), content: `${status}${note}` });
		} else if (
			type === "web_search_call" ||
			type === "code_interpreter_call" ||
			type === "tool_search_call" ||
			type === "tool_search_output"
		) {
			// A hosted call the client replays. The runner turns it into the function call and the result the upstream reads (it has the executor's `read`).
			replay(type, item, at);
		} else if (type === "compaction") {
			const summary = unsummarize(item.encrypted_content);
			if (summary === null) {
				throw new TranslatorError(`${at}: a compaction item must be one this translator wrote (its encrypted_content is not)`, {
					code: "unsupported_content",
					param: at
				});
			}
			pending = null;
			messages.push({ role: "user", content: `${COMPACTED}\n\n${summary}` });
		} else if (type === "reasoning") {
			const summary = (item.summary ?? []).filter((part) => typeof part?.text === "string").map((part) => part.text);
			const content = (item.content ?? []).filter((part) => typeof part?.text === "string").map((part) => part.text);
			const details = unpack(item.encrypted_content);
			if (carried) pending = { text: (summary.length > 0 ? summary : content).join("\n\n"), details };
			else if (!state.dropped.includes("reasoning")) state.dropped.push("reasoning");
		} else if ((native || mcpItem(item)) && typeof type === "string") {
			pending = null;
			messages.push({ role: "assistant", content: null, llmt_native: { item, at } });
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

	const offered = new Map();
	const tools = toolsOf(body.tools ?? [], state, offered, native);
	if (tools.length > 0) {
		out.tools = tools;
		if (body.tool_choice !== undefined && body.tool_choice !== null) {
			const choice = choiceOf(body.tool_choice, offered, native);
			if (choice !== undefined) out.tool_choice = choice;
		}
		if (typeof body.parallel_tool_calls === "boolean") out.parallel_tool_calls = body.parallel_tool_calls;
	}
	if (body.tool_choice?.type === "mcp" && typeof body.tool_choice.server_label === "string") {
		out.llmt_mcp_choice = {
			server_label: body.tool_choice.server_label,
			...(typeof body.tool_choice.name === "string" ? { name: body.tool_choice.name } : {})
		};
	}
	// What a Responses upstream needs to be sent as it came: the original tool choice and `include` (hosted tools were marked above).
	if (native && (tools.some((tool) => tool.llmt_hosted !== undefined) || messages.some((message) => message.llmt_native !== undefined))) {
		if (body.tool_choice !== null && typeof body.tool_choice === "object") out.llmt_native_choice = body.tool_choice;
		if (Array.isArray(body.include)) out.llmt_native_include = body.include;
	}
	if (compact !== null) out.llmt_compact = compact;
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
		tools: (body.tools ?? []).map((tool) => (tool?.type === "mcp" ? redacted(tool) : tool)),
		top_p: body.top_p ?? null,
		truncation: "disabled",
		user: out.user ?? null,
		metadata: body.metadata ?? {}
	};
	return { body: out, state };
}

/**
 * The automatic compaction a request asks for: `context_management: [{ type: "compaction", compact_threshold }]`. With several entries the first one counts.
 * @param {unknown} list - The request's `context_management`.
 * @returns {{ threshold: number } | null} The threshold, or null when the request asks for none (an empty list is dropped like any unmapped field).
 * @throws {TranslatorError} `unsupported_field` for an entry that is not a compaction, `invalid_request` for a threshold that is not a positive whole number.
 */
function compactionOf(list) {
	if (!Array.isArray(list) || list.length === 0) return null;
	list.forEach((entry, position) => {
		const at = `context_management[${position}]`;
		if (entry?.type !== "compaction") {
			refuse(
				`${at}.type: unsupported context management type ${JSON.stringify(entry?.type ?? null)} (only compaction is supported)`,
				`${at}.type`
			);
		}
		if (!Number.isInteger(entry.compact_threshold) || entry.compact_threshold < 1) {
			throw new TranslatorError(`${at}.compact_threshold must be a positive whole number of tokens`, {
				code: "invalid_request",
				param: `${at}.compact_threshold`
			});
		}
	});
	return { threshold: list[0].compact_threshold };
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
 * An `mcp` tool without the credentials the client put in it (`authorization`, `headers`), for the request parameters echoed on the response, which a
 * response store keeps.
 * @param {any} tool - The `mcp` tool.
 * @returns {any} A copy without them.
 */
function redacted(tool) {
	const { authorization: _, headers: ___headers, ...rest } = tool;
	return rest;
}

/**
 * Check an `mcp` tool of a request and return it as it is.
 * @param {any} tool - The tool.
 * @param {string} at - Path of the tool.
 * @returns {any} The tool.
 * @throws {TranslatorError} `invalid_request` for a missing or malformed field.
 */
function mcpOf(tool, at) {
	const bad = (field, message) => new TranslatorError(`${at}.${field} ${message}`, { code: "invalid_request", param: `${at}.${field}` });
	for (const field of ["server_label", "server_url"])
		if (typeof tool[field] !== "string" || tool[field] === "") throw bad(field, "is required");
	if (tool.authorization !== undefined && typeof tool.authorization !== "string") throw bad("authorization", "must be a string");
	if (
		tool.headers !== undefined &&
		(tool.headers === null || typeof tool.headers !== "object" || Object.values(tool.headers).some((v) => typeof v !== "string"))
	) {
		throw bad("headers", "must be an object of strings");
	}
	const approval = tool.require_approval;
	const tools = (value) =>
		value === undefined ||
		(value !== null && typeof value === "object" && (value.tool_names === undefined || Array.isArray(value.tool_names)));
	if (
		approval !== undefined &&
		approval !== "always" &&
		approval !== "never" &&
		!(approval !== null && typeof approval === "object" && !Array.isArray(approval) && tools(approval.always) && tools(approval.never))
	) {
		throw bad("require_approval", 'must be "always", "never" or { always, never } with tool_names');
	}
	const allowedTools = tool.allowed_tools;
	if (
		allowedTools !== undefined &&
		!Array.isArray(allowedTools) &&
		!(
			allowedTools !== null &&
			typeof allowedTools === "object" &&
			(allowedTools.tool_names === undefined || Array.isArray(allowedTools.tool_names))
		)
	) {
		throw bad("allowed_tools", "must be a list of tool names or { tool_names, read_only }");
	}
	return tool;
}

/**
 * The Chat tools for the Responses tools, by the table in `lib/responses-tools.mjs`.
 * @param {any[]} list - The request's `tools`.
 * @param {any} state - Converter state; `clientTools` gets the function names of the client-executed tools.
 * @param {Map<string, string>} offered - Receives the function name each tool kind is offered under (for `tool_choice`).
 * @param {boolean} native - Whether `hostedTools` is `native`: a tool with no emulation is kept for a Responses upstream instead of being refused.
 * @returns {any[]} Chat tools.
 * @throws {TranslatorError} `unsupported_tool` for a type that is refused, for a name the request already uses and for a hosted `shell` environment; `invalid_request` for a malformed tool.
 */
function toolsOf(list, state, offered, native) {
	if (!Array.isArray(list)) throw new TranslatorError("tools must be an array", { code: "invalid_request", param: "tools" });
	const taken = new Set(
		list
			.filter((tool) => tool?.type === "function" || tool?.type === "custom")
			.map((tool) => (typeof tool.name === "string" ? tool.name : ""))
	);
	const searching = list.some((tool) => rowOf(tool?.type)?.kind === "tool_search");
	return list.map((tool, position) => {
		const at = `tools[${position}]`;
		const type = tool?.type;
		const row = rowOf(type);
		/** A tool only a Responses upstream can serve, kept as a marked function the translator never offers to a model. */
		const kept = (kind) => ({
			type: "function",
			function: { name: `llmt_native_${position}`, parameters: { type: "object", properties: {} } },
			llmt_hosted: { kind, at, tool, native: true }
		});
		if (row === undefined && native && typeof type === "string") return kept("unknown");
		if (row === undefined) {
			throw refusal(
				at,
				`unsupported tool type ${JSON.stringify(type ?? null)} (the translator knows function, custom and the emulated hosted tools; see docs/protocol-support.md)`
			);
		}
		if (row.handling === "rejected" && native) return kept(row.kind);
		if (row.handling === "rejected")
			throw refusal(
				at,
				`unsupported tool type ${JSON.stringify(type)}: ${row.note} An upstream on the Responses API with the hostedTools setting "native" takes it as it is.`
			);
		if (row.kind === "function") {
			const fn = { name: required(tool.name, `${at}.name`) };
			if (typeof tool.description === "string") fn.description = tool.description;
			if (tool.parameters !== undefined && tool.parameters !== null) fn.parameters = tool.parameters;
			if (typeof tool.strict === "boolean") fn.strict = tool.strict;
			// A deferred function waits for tool search; with no tool_search tool in the request nothing could load it, so it is offered at once.
			return { type: "function", function: fn, ...(tool.defer_loading === true && searching ? { llmt_deferred: true } : {}) };
		}
		if (row.kind === "custom") {
			const custom = { name: required(tool.name, `${at}.name`) };
			if (typeof tool.description === "string") custom.description = tool.description;
			if (tool.format !== undefined && tool.format !== null) custom.format = tool.format;
			return { type: "custom", custom };
		}
		if (row.kind === "mcp") {
			if (tool.connector_id !== undefined && native) return kept("mcp");
			if (tool.connector_id !== undefined) {
				throw refusal(
					at,
					'unsupported tool type "mcp" with a connector_id: the translator has no OpenAI connectors; send the server_url of an MCP server instead'
				);
			}
			return {
				type: "function",
				function: { name: `llmt_mcp_${position}`, parameters: { type: "object", properties: {} } },
				llmt_hosted: { kind: "mcp", at: at, tool: mcpOf(tool, at) }
			};
		}
		if (taken.has(row.offered)) {
			throw refusal(
				at,
				`the ${type} tool is offered to the model as a function named ${JSON.stringify(row.offered)}, and the request already has a tool with that name`
			);
		}
		taken.add(row.offered);
		offered.set(row.kind, row.offered);
		if (row.kind === "shell") {
			const environment = tool.environment?.type;
			if (environment !== undefined && environment !== "local" && native) return kept("shell");
			if (environment !== undefined && environment !== "local") {
				throw refusal(
					at,
					`unsupported shell environment ${JSON.stringify(environment)}: the translator has no hosted container; the client runs the commands`
				);
			}
		}
		if (row.via === "function") {
			state.clientTools[row.offered] = row.kind;
			return functionOf(/** @type {"shell" | "apply_patch"} */ (row.kind));
		}
		return {
			type: "function",
			function: { name: row.offered, parameters: { type: "object", properties: {} } },
			llmt_hosted: { kind: row.kind, at, tool }
		};
	});
}

/**
 * Chat `tool_choice` for a Responses one.
 * @param {any} choice - Responses `tool_choice`.
 * @param {Map<string, string>} offered - The function name each emulated tool kind is offered under.
 * @param {boolean} native - Whether `hostedTools` is `native`: a choice the translator cannot map is left to the Responses upstream (see `llmt_native_choice`).
 * @returns {any} Chat `tool_choice`, or undefined for a choice only a Responses upstream can honour.
 * @throws {TranslatorError} `unsupported_field` for a choice that names a tool the request does not offer or the translator cannot force.
 */
function choiceOf(choice, offered, native) {
	if (choice === "auto" || choice === "none" || choice === "required") return choice;
	const named = (entry) => {
		if (entry?.type === "function" && typeof entry.name === "string") return { type: "function", function: { name: entry.name } };
		if (entry?.type === "custom" && typeof entry.name === "string") return { type: "custom", custom: { name: entry.name } };
		const row = rowOf(entry?.type);
		const name = row === undefined ? undefined : offered.get(row.kind);
		return name === undefined ? undefined : { type: "function", function: { name } };
	};
	if (choice?.type === "mcp" && typeof choice.server_label === "string") return undefined;
	const direct = named(choice);
	if (direct !== undefined) return direct;
	if (choice?.type === "allowed_tools" && Array.isArray(choice.tools)) {
		const tools = choice.tools.map(named);
		if (!tools.includes(undefined) && (choice.mode === "auto" || choice.mode === "required")) {
			return { type: "allowed_tools", allowed_tools: { mode: choice.mode, tools } };
		}
	}
	if (native) return undefined;
	throw new TranslatorError(`tool_choice: unsupported value ${JSON.stringify(choice?.type ?? choice)}`, {
		code: "unsupported_field",
		param: "tool_choice"
	});
}

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/codeexec.mjs
 *	@Date: 2026-11-25T00:59:00-08:00 (1795597140)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-25T00:59:00-08:00 (1795597140)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The `code_execution_*` server tool: an executor for the server tool runner (see servertools.mjs) that runs the model's code
 * through a sandbox adapter the caller supplies. The library never executes anything itself and ships no sandbox.
 *
 * A sandbox adapter is `{ name?, run(job), files? }`. `job` is `{ kind: "python", code, signal, container }` for `code_execution_20250522` or
 * `{ kind: "bash", command, signal, container }` for later versions. `container` is the container id of the request (or of an earlier call
 * of it), when there is one. `run` resolves with `{ stdout?, stderr?, return_code?, container?, files? }`: missing text is empty, a missing
 * `return_code` is 0, `container` (`{ id, expires_at? }` or an id string) is the container the code ran in, and `files` are the files the
 * run produced (`[{ name, bytes | data, media_type? }]`: `bytes` is a Uint8Array, `data` a UTF-8 string).
 *
 * The optional `files` object (`{ read(path, ctx), write(path, text, ctx) }`, `ctx` is `{ signal, container }`) serves the text editor tool of
 * `code_execution_20250825` (`text_editor_code_execution`: view, create, str_replace); without it only the bash tool is offered. `read`
 * resolves with the file's text and throws an error with code `file_not_found` for a missing file; `write` resolves with
 * `{ updated?, container? }` (`updated` is true when the file existed). `str_replace` is a read and a write.
 *
 * A sandbox signals a failure with an error whose `code` is one of Anthropic's code execution error codes (`unavailable`,
 * `invalid_tool_input`, `too_many_requests`, `execution_time_exceeded`, `container_expired`, `output_file_too_large`, `file_not_found`); any
 * other error becomes `unavailable`. The executor enforces the time limit itself and truncates stdout and stderr.
 * @module @cldmv/llm-translator/lib/codeexec
 */
import { TranslatorError } from "./errors.mjs";
import { newId } from "./filestore.mjs";
import { TOOL_PURPOSE } from "./files.mjs";

/** The error codes of a code execution result error a sandbox or the executor may produce. */
const CODES = new Set([
	"unavailable",
	"invalid_tool_input",
	"too_many_requests",
	"execution_time_exceeded",
	"container_expired",
	"output_file_too_large",
	"file_not_found"
]);

/** The tool version that takes Python source; every later version takes a bash command. */
const PYTHON = "code_execution_20250522";

/** Default time limit of one run, in ms. */
const TIMEOUT = 30000;

/** Default longest stdout or stderr (or viewed file), in characters. */
const OUTPUT = 20000;

/**
 * An error with an Anthropic error code.
 * @param {string} code - `error_code` of the result.
 * @param {string} message - Message.
 * @returns {Error} Error carrying `code`.
 */
function failure(code, message) {
	return Object.assign(new Error(message), { code });
}

/**
 * Cut text to a limit, marking the cut.
 * @param {any} value - Output text (anything else counts as empty).
 * @param {number} limit - Longest text kept, in characters.
 * @returns {string} The text, or its start and a note of how much was dropped.
 */
function clip(value, limit) {
	const text = typeof value === "string" ? value : "";
	return text.length <= limit ? text : `${text.slice(0, limit)}\n[truncated ${text.length - limit} characters]`;
}

/**
 * The container a sandbox reported.
 * @param {any} value - `{ id, expires_at? }`, an id string, or anything else.
 * @returns {{id: string, expires_at?: string} | undefined} The container, or undefined when none was reported.
 */
function containerOf(value) {
	if (typeof value === "string" && value !== "") return { id: value };
	if (typeof value?.id === "string" && value.id !== "") {
		return { id: value.id, ...(typeof value.expires_at === "string" ? { expires_at: value.expires_at } : {}) };
	}
	return undefined;
}

/**
 * The lines of a text (a final newline does not start another).
 * @param {string} text - Text.
 * @returns {string[]} Lines.
 */
function linesOf(text) {
	return text === "" ? [] : text.replace(/\n$/, "").split("\n");
}

/**
 * Store the files a run produced and name them in the result's content.
 * @param {any} produced - `files` of the sandbox's reply.
 * @param {any} store - File store of the Files API, or null when it is off.
 * @param {string} type - Content entry type (`code_execution_output`).
 * @returns {Promise<{type: string, file_id: string}[]>} Content entries (none without a store).
 */
async function keep(produced, store, type) {
	if (!store || !Array.isArray(produced)) return [];
	const entries = [];
	for (const file of produced) {
		const data =
			file?.bytes instanceof Uint8Array ? Buffer.from(file.bytes) : typeof file?.data === "string" ? Buffer.from(file.data) : null;
		if (data === null) throw failure("unavailable", "the sandbox returned a file with neither bytes nor data");
		try {
			const meta = await store.put({
				id: newId("anthropic"),
				filename: typeof file.name === "string" && file.name !== "" ? file.name : "output",
				mimeType: typeof file.media_type === "string" ? file.media_type : "application/octet-stream",
				purpose: TOOL_PURPOSE,
				data
			});
			entries.push({ type, file_id: meta.id });
		} catch (cause) {
			throw failure(cause?.code === "file_too_large" ? "output_file_too_large" : "unavailable", cause?.message ?? String(cause));
		}
	}
	return entries;
}

/**
 * The `code_execution_*` executor for the server tool runner.
 * @param {object} options - Options.
 * @param {{name?: string, run: Function, files?: {read: Function, write: Function}}} options.sandbox - Sandbox adapter.
 * @param {number} [options.timeout] - Time limit of one run in ms (default 30000); a longer run is answered with `execution_time_exceeded`.
 * @param {number} [options.maxOutput] - Longest stdout, longest stderr and longest viewed file, in characters (default 20000); more is cut.
 * @param {RegExp | string} [options.type] - Tool types served (default `/^code_execution_/`).
 * @returns {import("./servertools.mjs").ServerToolExecutor} The executor.
 * @throws {TranslatorError} `INVALID_CONFIG` for a sandbox with no `run` function, a `files` object without `read` and `write`, or a `timeout` / `maxOutput` that is not a positive whole number.
 */
export function codeExecution({ sandbox, timeout = TIMEOUT, maxOutput = OUTPUT, type = /^code_execution_/ } = /** @type {any} */ ({})) {
	const bad = (message) => new TranslatorError(`codeExecution: ${message}`, { code: "INVALID_CONFIG", status: 500 });
	if (!sandbox || typeof sandbox.run !== "function") throw bad("sandbox must have a run function");
	if (sandbox.files !== undefined && (typeof sandbox.files?.read !== "function" || typeof sandbox.files?.write !== "function")) {
		throw bad("sandbox.files must have read and write functions");
	}
	if (!Number.isInteger(timeout) || timeout < 1) throw bad("timeout must be a positive whole number");
	if (!Number.isInteger(maxOutput) || maxOutput < 1) throw bad("maxOutput must be a positive whole number");
	const python = (tool) => tool.type === PYTHON;
	const schemas = {
		code_execution: {
			type: "object",
			properties: { code: { type: "string", description: "The Python code to run." } },
			required: ["code"]
		},
		bash_code_execution: {
			type: "object",
			properties: { command: { type: "string", description: "The bash command to run." } },
			required: ["command"]
		},
		text_editor_code_execution: {
			type: "object",
			properties: {
				command: { type: "string", enum: ["view", "create", "str_replace"], description: "What to do with the file." },
				path: { type: "string", description: "The file's path." },
				file_text: { type: "string", description: "The text of the file (create)." },
				old_str: { type: "string", description: "The text to replace; it must appear once (str_replace)." },
				new_str: { type: "string", description: "The replacement text (str_replace)." }
			},
			required: ["command", "path"]
		}
	};
	const members = [
		{
			name: "bash_code_execution",
			description: "Run a bash command in a sandbox and return its stdout, stderr and exit code.",
			schema: schemas.bash_code_execution,
			result: "bash_code_execution_tool_result"
		},
		...(sandbox.files
			? [
					{
						name: "text_editor_code_execution",
						description: "View, create or edit a text file in the sandbox.",
						schema: schemas.text_editor_code_execution,
						result: "text_editor_code_execution_tool_result"
					}
				]
			: [])
	];

	/**
	 * Run something against the sandbox under the time limit.
	 * @param {(signal: AbortSignal) => any} start - Starts the work with the signal it must honour.
	 * @param {AbortSignal | undefined} signal - The request's abort signal.
	 * @returns {Promise<any>} What the work resolved with.
	 */
	async function limited(start, signal) {
		const limit = AbortSignal.timeout(timeout);
		const expired = new Promise((_, reject) => {
			limit.addEventListener("abort", () => reject(failure("execution_time_exceeded", `the run took longer than ${timeout} ms`)), {
				once: true
			});
		});
		try {
			return await Promise.race([start(signal ? AbortSignal.any([signal, limit]) : limit), expired]);
		} catch (cause) {
			const code = limit.aborted ? "execution_time_exceeded" : CODES.has(cause?.code) ? cause.code : "unavailable";
			throw failure(code, cause?.message ?? String(cause));
		}
	}

	/**
	 * The text editor tool.
	 * @param {any} input - The call's input.
	 * @param {{signal?: AbortSignal, container?: string}} details - `run` details.
	 * @returns {Promise<{content: any, container?: any}>} Result.
	 */
	async function edit(input, { signal, container }) {
		const command = input?.command;
		const path = input?.path;
		if (typeof path !== "string" || path === "") throw failure("invalid_tool_input", "the path is missing");
		if (!["view", "create", "str_replace"].includes(command))
			throw failure("invalid_tool_input", "the command must be view, create or str_replace");
		let reported;
		const note = (value) => {
			reported = containerOf(value?.container) ?? reported;
			return value;
		};
		const read = async () => {
			const text = await limited((s) => sandbox.files.read(path, { signal: s, container }), signal);
			if (typeof text !== "string") throw failure("unavailable", "the sandbox returned no file text");
			return text;
		};
		const write = async (text) => note(await limited((s) => sandbox.files.write(path, text, { signal: s, container }), signal)) ?? {};
		const done = (content) => ({ content, ...(reported === undefined ? {} : { container: reported }) });
		if (command === "view") {
			const text = await read();
			const lines = linesOf(text);
			return done({
				type: "text_editor_code_execution_view_result",
				content: clip(text, maxOutput),
				file_type: "text",
				num_lines: lines.length,
				start_line: 1,
				total_lines: lines.length
			});
		}
		if (command === "create") {
			if (typeof input.file_text !== "string") throw failure("invalid_tool_input", "file_text is missing");
			const out = await write(input.file_text);
			return done({ type: "text_editor_code_execution_create_result", is_file_update: out.updated === true });
		}
		const { old_str: before, new_str: after } = input;
		if (typeof before !== "string" || before === "" || typeof after !== "string") {
			throw failure("invalid_tool_input", "old_str and new_str are required for str_replace");
		}
		const text = await read();
		const first = text.indexOf(before);
		if (first === -1) throw failure("invalid_tool_input", "old_str was not found in the file");
		if (text.indexOf(before, first + 1) !== -1) throw failure("invalid_tool_input", "old_str appears more than once in the file");
		await write(text.slice(0, first) + after + text.slice(first + before.length));
		const start = text.slice(0, first).split("\n").length;
		const removed = before.split("\n");
		const added = after.split("\n");
		return done({
			type: "text_editor_code_execution_str_replace_result",
			lines: [...removed.map((line) => `-${line}`), ...added.map((line) => `+${line}`)],
			new_lines: added.length,
			new_start: start,
			old_lines: removed.length,
			old_start: start
		});
	}

	return {
		type,
		description: "Run Python code in a sandbox and return its stdout, stderr and exit code.",
		schema: () => schemas.code_execution,
		members: (tool) => (python(tool) ? [] : members),
		async run(input, details) {
			const { tool, signal, container, files, name } = details;
			if (name === "text_editor_code_execution") return edit(input, details);
			const isPython = python(tool);
			const source = input?.[isPython ? "code" : "command"];
			if (typeof source !== "string" || source.trim() === "") {
				throw failure("invalid_tool_input", `the ${isPython ? "code" : "command"} is missing`);
			}
			const job = { kind: isPython ? "python" : "bash", [isPython ? "code" : "command"]: source, container };
			const out = await limited((s) => sandbox.run({ ...job, signal: s }), signal);
			if (!out || typeof out !== "object") throw failure("unavailable", "the sandbox returned no result");
			const returned = out.return_code ?? 0;
			if (!Number.isInteger(returned)) throw failure("unavailable", "the sandbox returned a return_code that is not a whole number");
			const kind = isPython ? "code_execution" : "bash_code_execution";
			const reported = containerOf(out.container);
			return {
				content: {
					type: `${kind}_result`,
					stdout: clip(out.stdout, maxOutput),
					stderr: clip(out.stderr, maxOutput),
					return_code: returned,
					content: await keep(out.files, files, `${kind}_output`)
				},
				...(reported === undefined ? {} : { container: reported })
			};
		},
		read(content) {
			const type = content?.type;
			if (type === "text_editor_code_execution_view_result") return String(content.content ?? "");
			if (type === "text_editor_code_execution_create_result") return content.is_file_update ? "File updated." : "File created.";
			if (type === "text_editor_code_execution_str_replace_result") return ["Replaced.", ...(content.lines ?? [])].join("\n");
			const parts = [];
			if (content?.stdout) parts.push(`stdout:\n${content.stdout}`);
			if (content?.stderr) parts.push(`stderr:\n${content.stderr}`);
			const made = Array.isArray(content?.content) ? content.content.filter((entry) => typeof entry?.file_id === "string") : [];
			if (made.length > 0) parts.push(`files: ${made.map((entry) => entry.file_id).join(", ")}`);
			parts.push(`exit code: ${content?.return_code ?? 0}`);
			return parts.join("\n");
		}
	};
}

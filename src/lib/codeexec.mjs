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
 * A sandbox adapter is `{ name?, run(job) }`. `job` is `{ kind: "python", code, signal }` for `code_execution_20250522` or
 * `{ kind: "bash", command, signal }` for later versions. `run` resolves with `{ stdout?, stderr?, return_code? }` (missing text is empty,
 * a missing `return_code` is 0). A sandbox signals a failure with an error whose `code` is one of Anthropic's code execution error codes
 * (`unavailable`, `invalid_tool_input`, `too_many_requests`, `execution_time_exceeded`, `container_expired`, `output_file_too_large`); any
 * other error becomes `unavailable`. The executor enforces the time limit itself and truncates stdout and stderr.
 * @module @cldmv/llm-translator/lib/codeexec
 */
import { TranslatorError } from "./errors.mjs";

/** The error codes of a code execution result error a sandbox or the executor may produce. */
const CODES = new Set([
	"unavailable",
	"invalid_tool_input",
	"too_many_requests",
	"execution_time_exceeded",
	"container_expired",
	"output_file_too_large"
]);

/** The tool version that takes Python source; every later version takes a bash command. */
const PYTHON = "code_execution_20250522";

/** Default time limit of one run, in ms. */
const TIMEOUT = 30000;

/** Default longest stdout or stderr, in characters. */
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
 * The `code_execution_*` executor for the server tool runner.
 * @param {object} options - Options.
 * @param {{name?: string, run: Function}} options.sandbox - Sandbox adapter.
 * @param {number} [options.timeout] - Time limit of one run in ms (default 30000); a longer run is answered with `execution_time_exceeded`.
 * @param {number} [options.maxOutput] - Longest stdout and longest stderr, in characters (default 20000); more is cut.
 * @param {RegExp | string} [options.type] - Tool types served (default `/^code_execution_/`).
 * @returns {import("./servertools.mjs").ServerToolExecutor} The executor.
 * @throws {TranslatorError} `INVALID_CONFIG` for a sandbox with no `run` function, or a `timeout` / `maxOutput` that is not a positive whole number.
 */
export function codeExecution({ sandbox, timeout = TIMEOUT, maxOutput = OUTPUT, type = /^code_execution_/ } = /** @type {any} */ ({})) {
	const bad = (message) => new TranslatorError(`codeExecution: ${message}`, { code: "INVALID_CONFIG", status: 500 });
	if (!sandbox || typeof sandbox.run !== "function") throw bad("sandbox must have a run function");
	if (!Number.isInteger(timeout) || timeout < 1) throw bad("timeout must be a positive whole number");
	if (!Number.isInteger(maxOutput) || maxOutput < 1) throw bad("maxOutput must be a positive whole number");
	const python = (tool) => tool.type === PYTHON;
	return {
		type,
		description: (tool) =>
			python(tool)
				? "Run Python code in a sandbox and return its stdout, stderr and exit code."
				: "Run a bash command in a sandbox and return its stdout, stderr and exit code.",
		schema: (tool) =>
			python(tool)
				? { type: "object", properties: { code: { type: "string", description: "The Python code to run." } }, required: ["code"] }
				: { type: "object", properties: { command: { type: "string", description: "The bash command to run." } }, required: ["command"] },
		result: (tool) => (python(tool) ? "code_execution_tool_result" : "bash_code_execution_tool_result"),
		async run(input, { tool, signal }) {
			const isPython = python(tool);
			const source = input?.[isPython ? "code" : "command"];
			if (typeof source !== "string" || source.trim() === "") {
				throw failure("invalid_tool_input", `the ${isPython ? "code" : "command"} is missing`);
			}
			const limit = AbortSignal.timeout(timeout);
			const job = {
				kind: isPython ? "python" : "bash",
				[isPython ? "code" : "command"]: source,
				signal: signal ? AbortSignal.any([signal, limit]) : limit
			};
			const expired = new Promise((_, reject) => {
				limit.addEventListener("abort", () => reject(failure("execution_time_exceeded", `the run took longer than ${timeout} ms`)), {
					once: true
				});
			});
			let out;
			try {
				out = await Promise.race([sandbox.run(job), expired]);
			} catch (cause) {
				const code = limit.aborted ? "execution_time_exceeded" : CODES.has(cause?.code) ? cause.code : "unavailable";
				throw failure(code, cause?.message ?? String(cause));
			}
			if (!out || typeof out !== "object") throw failure("unavailable", "the sandbox returned no result");
			const returned = out.return_code ?? 0;
			if (!Number.isInteger(returned)) throw failure("unavailable", "the sandbox returned a return_code that is not a whole number");
			return {
				content: {
					type: isPython ? "code_execution_result" : "bash_code_execution_result",
					stdout: clip(out.stdout, maxOutput),
					stderr: clip(out.stderr, maxOutput),
					return_code: returned,
					content: []
				}
			};
		},
		read(content) {
			const parts = [];
			if (content?.stdout) parts.push(`stdout:\n${content.stdout}`);
			if (content?.stderr) parts.push(`stderr:\n${content.stderr}`);
			parts.push(`exit code: ${content?.return_code ?? 0}`);
			return parts.join("\n");
		}
	};
}

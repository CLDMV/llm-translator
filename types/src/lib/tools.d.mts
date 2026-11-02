/**
 * The hint for a refusal. When `toolFallback` is already on, suggesting it would be wrong (the retry has been spent), so only the restart advice remains.
 * A refusal that names `--jinja` is llama.cpp's and gets its own advice.
 * @param {boolean} toolFallback - Whether the `toolFallback` setting is on for the endpoint.
 * @param {string} [message] - The upstream error message being hinted.
 * @returns {string} Hint text.
 */
export function hint(toolFallback: boolean, message?: string): string;
/**
 * Does an upstream error message say the server has no tool parser configured?
 * @param {string} message - Upstream error message.
 * @returns {boolean} True for a known "tool parsing not enabled" wording.
 */
export function refused(message: string): boolean;
/**
 * Does a Chat Completions body carry tools?
 * @param {any} body - Upstream request body.
 * @returns {boolean} True when `tools` is a non-empty array.
 */
export function carries(body: any): boolean;
/**
 * Copy a Chat Completions body without `tools`, `tool_choice` and `parallel_tool_calls`.
 * @param {any} body - Upstream request body.
 * @returns {any} New body.
 */
export function strip(body: any): any;
/** Added to the error message the client receives when the upstream refuses tools for want of a tool parser. */
export const HINT: "The vLLM server was started without tool-call parsing. Restart it with --enable-auto-tool-choice and --tool-call-parser <parser> (the parser depends on the model family), or set the translator setting toolFallback to retry without tools.";

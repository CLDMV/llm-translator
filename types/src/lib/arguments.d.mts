/**
 * Whether tool-call arguments are complete: empty, or a JSON object. Truncated JSON (a `length` stop in the middle
 * of a call) is not.
 * @param {unknown} args - Arguments as received.
 * @returns {boolean} True when the arguments parse (or are empty).
 */
export function isComplete(args: unknown): boolean;
/**
 * Parse OpenAI tool-call `arguments` into the JSON object Anthropic requires for `tool_use.input`. Anything that is
 * not a JSON object (truncated JSON from a `length` stop, a bare array, plain text) is preserved verbatim under
 * `_raw_arguments`, so the client's own input validation reports an error the model can recover from instead of the
 * translator silently inventing arguments.
 * @param {unknown} args - JSON string (or already-parsed value) from the upstream.
 * @returns {object} Input object.
 */
export function parseArguments(args: unknown): object;

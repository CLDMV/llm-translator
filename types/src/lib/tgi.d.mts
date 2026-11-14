/**
 * One tool call in the OpenAI shape. Historic TGI sent the id as a number, the arguments as an object (under `parameters` in some
 * releases) and omitted `type`; current TGI sends string arguments.
 * @param {any} call - Tool call as TGI sent it.
 * @param {number} [position] - Position in the call list, the id when TGI sent none. Left out for streamed fragments, whose missing id
 * means the fragment continues the open call.
 * @returns {any} Tool call with a string id, `type: "function"` and string `arguments`.
 */
export function toolCall(call: any, position?: number): any;
/**
 * The tool calls of a message or delta as a list: historic TGI sent one object instead of an array.
 * @param {any} value - `tool_calls` as TGI sent it.
 * @param {boolean} [fill] - Give a call without an id its position as the id (whole answers; not streamed fragments).
 * @returns {any[] | undefined} The list, or undefined when there is none.
 */
export function toolCalls(value: any, fill?: boolean): any[] | undefined;
/**
 * The OpenAI `finish_reason` for one TGI sent: `eos_token` and `stop_sequence` become `stop`, or `tool_calls` when the answer holds tool calls
 * (historic TGI reported `eos_token` for those).
 * @param {any} reason - `finish_reason` as TGI sent it.
 * @param {boolean} hasToolCalls - Whether the answer holds tool calls.
 * @returns {any} Finish reason.
 */
export function finish(reason: any, hasToolCalls: boolean): any;
/**
 * TGI's grammar as `response_format` takes it: `{ type: "json" | "json_object" | "regex", value }` or `{ type: "json_schema", value: { name?, schema } }`.
 * An OpenAI `json_schema` format (`{ type: "json_schema", json_schema: { name, schema, strict } }`) becomes TGI's `json_schema` with
 * the name and schema; a bare `json_object` has no schema to constrain with, so it asks for any JSON object. Shapes TGI already
 * understands pass through.
 * @param {any} format - A `response_format` (or `grammar`) value.
 * @returns {any} The format in TGI's shape.
 */
export function grammar(format: any): any;

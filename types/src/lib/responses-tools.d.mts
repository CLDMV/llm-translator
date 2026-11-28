/**
 * The row of a tool type.
 * @param {unknown} type - The tool's `type`.
 * @returns {ToolRow | undefined} The row, or undefined for an unknown type.
 */
export function rowOf(type: unknown): ToolRow | undefined;
/**
 * The refusal for a tool the translator has no counterpart for.
 * @param {string} at - Path of the tool (`tools[2]`).
 * @param {string} message - What to say after the type.
 * @returns {TranslatorError} `unsupported_tool`, status 400, `param` the tool's path.
 */
export function refusal(at: string, message: string): TranslatorError;
/**
 * The Chat function tool that stands for a client-executed tool.
 * @param {"shell" | "apply_patch"} kind - The tool.
 * @returns {{type: "function", function: {name: string, description: string, parameters: any}}} The function tool.
 */
export function functionOf(kind: "shell" | "apply_patch"): {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: any;
    };
};
/**
 * Text of the output of a `shell_call_output` item, for the tool message the upstream reads.
 * UNSURE: the item is `{ call_id, output: [{ stdout, stderr, outcome: { type: "exit", exit_code } | { type: "timeout" } }], max_output_length? }`.
 * @param {any} output - The item's `output`.
 * @returns {string} Text.
 */
export function shellText(output: any): string;
/**
 * The input of a call as a JSON object string, for the arguments of a function call.
 * @param {unknown} value - The action or operation object.
 * @returns {string} JSON text (`{}` for anything that is not an object).
 */
export function argumentsOf(value: unknown): string;
/**
 * The parsed arguments of a function call.
 * @param {unknown} text - `function.arguments`.
 * @returns {Record<string, any>} The object, or an empty one when the text is not a JSON object.
 */
export function parsed(text: unknown): Record<string, any>;
/**
 * The function name an MCP tool is offered to the model under: `mcp_<server_label>_<tool>` with every character outside `[A-Za-z0-9_-]` replaced by
 * `_`, and a hash suffix instead of the tail when it would be longer than 64 characters (the limit of function names).
 * @param {string} label - The `server_label`.
 * @param {string} name - The tool's name on the server.
 * @returns {string} The function name.
 */
export function mcpName(label: string, name: string): string;
/**
 * Whether a Responses input item is one of the MCP items (`mcp_list_tools`, `mcp_call`, `mcp_approval_request`, `mcp_approval_response`).
 * @param {any} item - Input item.
 * @returns {boolean} True for an MCP item.
 */
export function mcpItem(item: any): boolean;
/**
 * The Responses item of a client-executed tool call, from the function call the model made.
 * UNSURE: `shell_call` is `{ id, type, call_id, status, action: { commands, timeout_ms, max_output_length } }` and `apply_patch_call` is
 * `{ id, type, call_id, status, operation: { type, path, diff } }`.
 * @param {"shell" | "apply_patch"} kind - The tool.
 * @param {{id: string, call_id: string, arguments: string, status: string}} call - The call: item id, call id, JSON arguments and status.
 * @returns {any} The item.
 */
export function clientItem(kind: "shell" | "apply_patch", call: {
    id: string;
    call_id: string;
    arguments: string;
    status: string;
}): any;
/**
 * The tool names (and so the kinds) a request's emulated client tools are offered under, recorded on the converter's state so the reply
 * converters can turn a function call of that name back into the tool's item.
 * @param {any} state - Converter state.
 * @param {string} name - Function name.
 * @returns {"shell" | "apply_patch" | undefined} The tool the name stands for in this request.
 */
export function clientKind(state: any, name: string): "shell" | "apply_patch" | undefined;
/**
 * Whether a Chat tool carries the hosted marker (an emulated tool the runner serves).
 * @param {any} tool - Chat tool.
 * @returns {boolean} True for a marked tool.
 */
export function hostedMark(tool: any): boolean;
/**
 * Whether a Chat message carries the hosted marker (a hosted call replayed from the client's history).
 * @param {any} message - Chat message.
 * @returns {boolean} True for a marked message.
 */
export function replayMark(message: any): boolean;
/**
 * Whether a Chat message carries an input item only a Responses upstream can take (`hostedTools: "native"`).
 * @param {any} message - Chat message.
 * @returns {boolean} True for a marked message.
 */
export function nativeMark(message: any): boolean;
/**
 * @typedef {object} ToolRow
 * @property {string} kind - The tool's name in this module.
 * @property {RegExp} match - Matches the tool's `type`.
 * @property {"mapped" | "emulated" | "rejected"} handling - What the translator does.
 * @property {"function" | "custom" | "serverTools" | "mcp" | "none"} via - What carries it: a Chat function or custom tool, a `serverTools` executor, or nothing.
 * @property {string} [executor] - For `via: "serverTools"`: the tool type pattern an executor must serve.
 * @property {string} [offered] - The name of the function the model is offered (emulated tools).
 * @property {string} note - One line for the documentation and the error message.
 */
/** @type {readonly ToolRow[]} */
export const TOOLS: readonly ToolRow[];
/** The JSON schema of the function that stands for the `shell` tool: the `action` of a `shell_call` item. */
export const SHELL_SCHEMA: Readonly<{
    type: "object";
    properties: {
        commands: {
            type: string;
            items: {
                type: string;
            };
            description: string;
        };
        timeout_ms: {
            type: string;
            description: string;
        };
        max_output_length: {
            type: string;
            description: string;
        };
    };
    required: string[];
}>;
/** The JSON schema of the function that stands for the `apply_patch` tool: the `operation` of an `apply_patch_call` item. */
export const PATCH_SCHEMA: Readonly<{
    type: "object";
    properties: {
        type: {
            type: string;
            enum: string[];
            description: string;
        };
        path: {
            type: string;
            description: string;
        };
        diff: {
            type: string;
            description: string;
        };
    };
    required: string[];
}>;
export type ToolRow = {
    /**
     * - The tool's name in this module.
     */
    kind: string;
    /**
     * - Matches the tool's `type`.
     */
    match: RegExp;
    /**
     * - What the translator does.
     */
    handling: "mapped" | "emulated" | "rejected";
    /**
     * - What carries it: a Chat function or custom tool, a `serverTools` executor, or nothing.
     */
    via: "function" | "custom" | "serverTools" | "mcp" | "none";
    /**
     * - For `via: "serverTools"`: the tool type pattern an executor must serve.
     */
    executor?: string;
    /**
     * - The name of the function the model is offered (emulated tools).
     */
    offered?: string;
    /**
     * - One line for the documentation and the error message.
     */
    note: string;
};
import { TranslatorError } from "./errors.mjs";

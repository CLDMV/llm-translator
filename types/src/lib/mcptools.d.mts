/**
 * The MCP part of a plan for the hosted tool runner.
 * @param {any[]} marks - The tools the request converter marked `mcp` (`tool.llmt_hosted`).
 * @param {any[]} items - The MCP input items (messages marked `llmt_native`).
 * @param {{hosts: string[]} | undefined} setting - The `serverTools.mcp` setting.
 * @returns {{setting: any, servers: any[], names: Map<string, {server: any, tool: string}>}} The plan.
 * @throws {TranslatorError} `unsupported_tool` (for a tool) or `unsupported_content` (for an item) when MCP is not configured, and `unsupported_tool` for a URL that may not be called; `invalid_request` for two servers with one label; `unsupported_content` for an approval response whose request is not earlier in the input.
 */
export function plan(marks: any[], items: any[], setting: {
    hosts: string[];
} | undefined): {
    setting: any;
    servers: any[];
    names: Map<string, {
        server: any;
        tool: string;
    }>;
};
/**
 * List the servers' tools, register them with the plan and turn the MCP items of the history into the messages the model reads.
 *
 * The plan's `tools` and `hosted` maps get an entry per tool offered (so the runner's `rewrite` offers them and `execute` runs them), and `plan.names` maps
 * the function name back to the server and tool. A server that cannot be listed gets an `mcp_list_tools` item with an `error` and offers nothing.
 * @param {object} spec - `{ plan, tools, hosted, messages, signal, announce }`.
 * @param {any} spec.plan - Plan from {@link plan}.
 * @param {Map<string, any>} spec.tools - The runner plan's `tools`.
 * @param {Map<any, any[]>} spec.hosted - The runner plan's `hosted`.
 * @param {any[]} spec.messages - The Chat messages of the request.
 * @param {AbortSignal | undefined} spec.signal - Aborts the calls.
 * @param {(spec: any) => void} spec.announce - Emits an event.
 * @returns {Promise<{messages: any[], prefix: any[]}>} The messages without the MCP items, and the items the response starts with (new `mcp_list_tools`, approved `mcp_call`).
 */
export function prepare({ plan, tools, hosted, messages, signal, announce }: {
    plan: any;
    tools: Map<string, any>;
    hosted: Map<any, any[]>;
    messages: any[];
    signal: AbortSignal | undefined;
    announce: (spec: any) => void;
}): Promise<{
    messages: any[];
    prefix: any[];
}>;
/**
 * The `mcp_call` item of a call.
 * UNSURE (OpenAI item fields): `{ id, type, server_label, name, arguments, output, error, status?, approval_request_id? }`, with `output` the result text
 * and `error` the failure text (the other is null).
 * @param {string} label - The `server_label`.
 * @param {string} name - The tool's name on the server.
 * @param {string} args - The arguments as JSON text.
 * @param {{text: string, error: boolean}} result - The result.
 * @param {string} [approved] - The id of the `mcp_approval_request` that was approved for it.
 * @returns {any} The item.
 */
export function callItem(label: string, name: string, args: string, result: {
    text: string;
    error: boolean;
}, approved?: string): any;
/**
 * Whether a function the model called is an MCP tool whose call waits for approval.
 * @param {any} plan - The MCP plan.
 * @param {string} name - The function name.
 * @returns {boolean} True when the call is not made but asked about.
 */
export function pending(plan: any, name: string): boolean;
/**
 * The `mcp_approval_request` item for a call.
 * @param {any} plan - The MCP plan.
 * @param {{name: string, input: any}} call - The call the model made.
 * @returns {any} The item.
 */
export function requestItem(plan: any, call: {
    name: string;
    input: any;
}): any;
/**
 * The `mcp_call` item for a call the runner made.
 * @param {any} plan - The MCP plan.
 * @param {any} made - The call the model made (`{ name, input }`, with the id it was made under).
 * @param {any} content - The result content (`{ text, error }`, or an error object when the arguments were not an object).
 * @returns {any} The item.
 */
export function madeItem(plan: any, made: any, content: any): any;
/**
 * The function name that forces a tool, for `tool_choice` `{ type: "mcp", server_label, name }`.
 * @param {any} plan - The MCP plan.
 * @param {{server_label: string, name?: string}} choice - The request's choice.
 * @returns {any} The Chat `tool_choice`: the function when the server has the tool, else `required`.
 */
export function choose(plan: any, choice: {
    server_label: string;
    name?: string;
}): any;
/**
 * End the sessions of the servers that were used.
 * @param {any} plan - The MCP plan.
 * @returns {Promise<void>} Resolves when every session is closed.
 */
export function close(plan: any): Promise<void>;

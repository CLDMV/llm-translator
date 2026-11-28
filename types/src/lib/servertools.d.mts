/**
 * The kind of a server tool type: the type without its date suffix.
 * @param {string} type - Tool type (`web_search_20250305`).
 * @returns {string} Kind (`web_search`).
 */
export function kind(type: string): string;
/**
 * Validate the `serverTools` option of the config or of a `send` call.
 * @param {any} value - `undefined`, an array of executors, or `{ executors, maxRounds }`.
 * @returns {{executors: any[], maxRounds: number | undefined}} Normalized option.
 * @throws {TranslatorError} `INVALID_CONFIG` for an executor with no usable `type`, `schema` or `run`, or a `maxRounds` that is not a positive whole number.
 */
export function normalize(value: any): {
    executors: any[];
    maxRounds: number | undefined;
};
/**
 * The executor for a tool type.
 * @param {any[]} executors - Executors, earlier ones win.
 * @param {string} type - Tool type.
 * @returns {any} The executor, or undefined.
 */
export function find(executors: any[], type: string): any;
/**
 * Whether a request body has server tools the runner takes over and the routed upstream is a converted one, and if so the plan to run it.
 * A passthrough to an Anthropic-protocol upstream is never touched: that server runs its own server tools.
 * @param {any} c - Captured translator parts (`capture`).
 * @param {any} body - Client request body.
 * @param {any} options - The `send` options (`serverTools`).
 * @returns {{executors: any[], maxRounds: number, tools: Map<string, {tool: any, executor: any, member?: any}>, hosted: Map<any, any[]>, loaded: Set<string> | null} | null} The plan, or null for the normal path.
 */
export function wants(c: any, body: any, options: any): {
    executors: any[];
    maxRounds: number;
    tools: Map<string, {
        tool: any;
        executor: any;
        member?: any;
    }>;
    hosted: Map<any, any[]>;
    loaded: Set<string> | null;
} | null;
/**
 * The text of a result for the upstream model: the executor's `read` for a successful result, the JSON of the content otherwise.
 * @param {any} executor - Executor of the tool, or undefined when unknown.
 * @param {any} content - The result block's `content`.
 * @param {number} [offset] - Citable items that came before this result in the request.
 * @returns {string} Text.
 */
export function render(executor: any, content: any, offset?: number): string;
/**
 * The items of a result that can be cited: the entries of a successful result's content array, for an executor that has `cite`.
 * @param {any} executor - Executor of the tool, or undefined when unknown.
 * @param {any} content - The result block's `content`.
 * @returns {any[]} The items, or none.
 */
export function citable(executor: any, content: any): any[];
/**
 * The citations of the results in a request's history, in order: the sources that `[[cite:N]]` markers may name before this turn's searches.
 * @param {any[]} messages - Client messages.
 * @param {any} plan - Plan from {@link wants}.
 * @returns {any[]} Citations; source N is entry N - 1.
 */
export function sources(messages: any[], plan: any): any[];
/**
 * Whether a result block's content is an error object (`<...>_error` with an `error_code`).
 * @param {any} content - The result block's `content`.
 * @returns {boolean} True for an error result.
 */
export function failed(content: any): boolean;
/**
 * Convert the server tool blocks of a request's history into a function call and its result, as the upstream understands them. An assistant
 * message `[text, server_tool_use, <x>_tool_result, text]` becomes `assistant [text, tool_use]`, `user [tool_result]`, `assistant [text]`
 * (the converters merge adjacent turns of one role). A `server_tool_use` with no result in its message is dropped.
 * @param {any[]} messages - Client messages.
 * @param {any} [plan] - Plan from {@link wants}; its executors' `read` renders the results.
 * @returns {any[]} Messages with no server tool blocks.
 */
export function history(messages: any[], plan?: any): any[];
/**
 * The request the upstream gets: the server tools the runner took over become function tools, and server tool blocks in the history become
 * a function call and its result.
 * @param {any} body - Client request body.
 * @param {any} plan - Plan from {@link wants}.
 * @param {any[]} extra - Messages appended after the client's (the rounds run so far).
 * @returns {any} Anthropic-shaped body with only custom tools.
 */
export function rewrite(body: any, plan: any, extra?: any[]): any;
/**
 * Run one server tool call.
 * @param {any} call - `{ id, name, input }` as the upstream model called it.
 * @param {any} plan - Plan from {@link wants}.
 * @param {{used: Map<string, number>, counts: Record<string, number>, signal: AbortSignal | undefined, context: any, files: any, container?: {id: string, expires_at?: string}, announce: (spec: any) => void, sources: any[], offsets: Map<any, number>}} state - Request-wide state.
 * @returns {Promise<{use: any, result: any}>} The `server_tool_use` block (new id) and the result block.
 */
export function execute(call: any, plan: any, state: {
    used: Map<string, number>;
    counts: Record<string, number>;
    signal: AbortSignal | undefined;
    context: any;
    files: any;
    container?: {
        id: string;
        expires_at?: string;
    };
    announce: (spec: any) => void;
    sources: any[];
    offsets: Map<any, number>;
}): Promise<{
    use: any;
    result: any;
}>;
/**
 * Add two usage objects (numbers add, nested objects recurse, any other value is replaced by the later one).
 * @param {any} left - Usage so far.
 * @param {any} right - Usage to add.
 * @returns {any} The sum.
 */
export function add(left: any, right: any): any;
/**
 * Answer an Anthropic-front request by running its server tools. See the module comment. Every round is a full `send` of the rewritten
 * body; the reply carries a non-enumerable `usage` promise of the combined report like any `send` reply (for a stream it settles when the
 * stream ends or is closed early).
 * @param {object} spec - `{ body, plan, options, send, warn, c }`.
 * @param {any} spec.body - Client request body.
 * @param {any} spec.plan - Plan from {@link wants}.
 * @param {any} spec.options - The `send` options of the request.
 * @param {(body: any, options: any) => Promise<any>} spec.send - The single-request send.
 * @param {(message: string, details: {kind: "threw" | "rejected"}) => void} spec.warn - Receives a message when `onUsage` throws or rejects.
 * @param {any} spec.c - Captured translator parts (events go there).
 * @returns {Promise<any>} The reply.
 */
export function run({ body, plan, options, send: direct, warn, c }: {
    body: any;
    plan: any;
    options: any;
    send: (body: any, options: any) => Promise<any>;
    warn: (message: string, details: {
        kind: "threw" | "rejected";
    }) => void;
    c: any;
}): Promise<any>;
/**
 * @typedef {object} ServerToolExecutor
 * @property {RegExp | string} type Matches the tool's `type` (`/^web_search_/`, or an exact `"web_fetch_20250910"`).
 * @property {(tool: any) => any} schema JSON schema (an object schema) of the function's input, for that tool definition.
 * @property {(input: any, details: {tool: any, id: string, name: string, signal?: AbortSignal, context: {model?: string, metadata?: any, messages?: any[], tools?: any[], results?: any[], container?: string}, container?: string, files: any | null}) => Promise<{content: any, type?: string, container?: {id: string, expires_at?: string}}>} run Runs one call; resolves with the result block's `content` (its `type` when it is not `<kind>_tool_result`, and the `container` the call ran in) or throws. `container` is the container id of the request (or of an earlier call of it) and `files` the file store of the Files API (null when it is off).
 * @property {string | ((tool: any) => string)} [description] Text offered to the model with the function.
 * @property {string} [result] The result block type, for a tool kind that has no `<kind>_tool_result`.
 * @property {string} [usage] The `usage.server_tool_use` counter a call increments (defaults to `web_search_requests` / `web_fetch_requests` for those kinds).
 * @property {(tool: any) => {name: string, schema: any, description?: string, result?: string}[]} [members] The functions one tool definition is offered as, when it is more than one.
 * @property {boolean} [deferred] Whether the executor searches the tools marked `defer_loading` (the runner withholds them until a result names them).
 * @property {(content: any, offset?: number) => string} [read] The text the upstream model reads for a successful result (default: the content as JSON); `offset` is the number of citable items before it in the request.
 * @property {(item: any) => any} [cite] The citation of one item of a result's `content` array; makes the executor's results citable with `[[cite:N]]` markers.
 */
/** @typedef {ServerToolExecutor[] | {executors?: ServerToolExecutor[], maxRounds?: number}} ServerTools */
/** The default number of upstream calls one request may make. */
export const ROUNDS: 10;
export type ServerToolExecutor = {
    /**
     * Matches the tool's `type` (`/^web_search_/`, or an exact `"web_fetch_20250910"`).
     */
    type: RegExp | string;
    /**
     * JSON schema (an object schema) of the function's input, for that tool definition.
     */
    schema: (tool: any) => any;
    /**
     * Runs one call; resolves with the result block's `content` (its `type` when it is not `<kind>_tool_result`, and the `container` the call ran in) or throws. `container` is the container id of the request (or of an earlier call of it) and `files` the file store of the Files API (null when it is off).
     */
    run: (input: any, details: {
        tool: any;
        id: string;
        name: string;
        signal?: AbortSignal;
        context: {
            model?: string;
            metadata?: any;
            messages?: any[];
            tools?: any[];
            results?: any[];
            container?: string;
        };
        container?: string;
        files: any | null;
    }) => Promise<{
        content: any;
        type?: string;
        container?: {
            id: string;
            expires_at?: string;
        };
    }>;
    /**
     * Text offered to the model with the function.
     */
    description?: string | ((tool: any) => string);
    /**
     * The result block type, for a tool kind that has no `<kind>_tool_result`.
     */
    result?: string;
    /**
     * The `usage.server_tool_use` counter a call increments (defaults to `web_search_requests` / `web_fetch_requests` for those kinds).
     */
    usage?: string;
    /**
     * The functions one tool definition is offered as, when it is more than one.
     */
    members?: (tool: any) => {
        name: string;
        schema: any;
        description?: string;
        result?: string;
    }[];
    /**
     * Whether the executor searches the tools marked `defer_loading` (the runner withholds them until a result names them).
     */
    deferred?: boolean;
    /**
     * The text the upstream model reads for a successful result (default: the content as JSON); `offset` is the number of citable items before it in the request.
     */
    read?: (content: any, offset?: number) => string;
    /**
     * The citation of one item of a result's `content` array; makes the executor's results citable with `[[cite:N]]` markers.
     */
    cite?: (item: any) => any;
};
export type ServerTools = ServerToolExecutor[] | {
    executors?: ServerToolExecutor[];
    maxRounds?: number;
};

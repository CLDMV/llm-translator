/**
 * The Anthropic-shaped view of a hosted tool, the form the executors know.
 * `web_search`: `filters.allowed_domains` and `user_location` carry over. `code_interpreter` is the Python tool (`code_execution_20250522`).
 * `tool_search` is the BM25 search (`tool_search_tool_bm25_20251119`).
 * @param {string} kind - `web_search`, `code_interpreter` or `tool_search`.
 * @param {any} [tool] - The Responses tool definition.
 * @returns {any} Anthropic tool.
 */
export function view(kind: string, tool?: any): any;
/**
 * Whether the request has hosted tools the runner takes over (or hosted calls to replay), and if so the plan to run it. A tool whose executor is
 * not configured is refused: the model cannot be offered a tool nothing could run.
 * @param {any} c - Captured translator parts (`capture`).
 * @param {any} body - Chat body of a Responses request (markers from the request converter).
 * @param {any} options - The `send` options (`serverTools`).
 * @returns {{executors: any[], maxRounds: number, tools: Map<string, {tool: any, executor: any, member?: any}>, hosted: Map<any, any[]>, loaded: Set<string> | null, mcp: any} | null} The plan (`mcp` is the part for the `mcp` tool, see `lib/mcptools.mjs`), or null for the normal path.
 * @throws {TranslatorError} `unsupported_tool`, status 400, `param` the tool's path, for a hosted tool with no executor in `serverTools`.
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
    mcp: any;
} | null;
/**
 * Whether the request goes to an upstream that takes hosted tools as they are: the Responses protocol with `hostedTools: "native"`.
 * @param {any} c - Captured translator parts (`capture`).
 * @param {any} body - Chat body of a Responses request.
 * @param {any} options - The `send` options (`wire`).
 * @returns {boolean} True for a native route.
 */
export function nativeRoute(c: any, body: any, options: any): boolean;
/**
 * Whether a Chat body of a Responses request carries any hosted tool or hosted item (marked by the request converter).
 * @param {any} body - Chat body.
 * @returns {boolean} True when something is marked.
 */
export function marked(body: any): boolean;
/**
 * Refuse what cannot be sent to the upstream the request goes to: a tool or an input item only a Responses upstream with `hostedTools: "native"` can
 * take (`all: false`, used where the emulation runner takes over), or any hosted tool or item at all (`all: true`, used for an upstream that does not
 * speak the Responses API, which a request reaches when `api: "auto"` falls back to Chat Completions).
 * @param {any} body - Chat body of a Responses request.
 * @param {boolean} all - Refuse the emulated hosted tools too.
 * @param {boolean} [computer] - The upstream speaks the Anthropic Messages API, which takes the computer tool and its screenshots.
 * @returns {void}
 * @throws {TranslatorError} `unsupported_tool` (`param` the tool's path) or `unsupported_content` (`param` the item's path).
 */
export function refuse(body: any, all: boolean, computer?: boolean): void;
/**
 * The request the upstream gets for one round.
 * @param {any} body - Chat body of the Responses request.
 * @param {any} plan - Plan from {@link wants}.
 * @param {any[]} history - The request's messages with the replayed hosted calls rendered.
 * @param {any[]} extra - Messages appended after the request's (the rounds run so far).
 * @returns {any} Chat body without markers.
 */
export function rewrite(body: any, plan: any, history: any[], extra?: any[]): any;
/**
 * A copy of a body with the markers removed and the hosted tools left as the plain functions they were offered as, for a caller that does not run
 * them (a token count).
 * @param {any} body - Chat body of a Responses request.
 * @returns {any} Body without markers.
 */
export function strip(body: any): any;
/**
 * Answer a Responses-front request by running its hosted tools. See the module comment. Every round is a full `send` of the rewritten body; the reply
 * carries a non-enumerable `usage` promise of the combined report like any `send` reply (for a stream it settles when the stream ends or is closed early).
 * @param {object} spec - `{ body, plan, options, send, warn, c }`.
 * @param {any} spec.body - Chat body of the Responses request.
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
/** The `response.incomplete_details.reason` of a turn cut off at the round limit. (UNSURE: OpenAI documents only `max_output_tokens` and `content_filter`.) */
export const CUT_OFF: "max_tool_calls";

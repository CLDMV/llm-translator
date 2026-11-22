/**
 * The members of the computer tool the client left on: all of them for the older tools, and for the toolset all but the ones its `configs` switch off.
 * @param {any[]} tools - The request's `tools`.
 * @returns {Set<string>} Member names.
 */
export function enabledOf(tools: any[]): Set<string>;
/**
 * The desktop actions that are left out of what the model is offered (`excludedPredefinedFunctions`): the ones that need a member the client switched off.
 * @param {Set<string>} enabled - The members that are on.
 * @returns {string[]} Gemini action names.
 */
export function excluded(enabled: Set<string>): string[];
/**
 * Anthropic's (xdotool) name for a Gemini key; a name the table does not know (a letter, a digit, `F5`) is kept as it is.
 * @param {string} name - Gemini key name.
 * @returns {string} Key name.
 */
export function xdotool(name: string): string;
/**
 * Gemini's name for an Anthropic (xdotool) key.
 * @param {string} name - Key name.
 * @returns {string} Gemini key name.
 */
export function gemini(name: string): string;
/**
 * Whether a tool of the request is Anthropic's computer tool (`computer_20250124`, `computer_20251124`, `computer_toolset_20260801`, ...).
 * @param {any} tool - Tool definition.
 * @returns {boolean} True for the computer tool.
 */
export function isTool(tool: any): boolean;
/**
 * Whether a tool of the request is the computer toolset (`computer_toolset_20260801`), whose calls are named by the member and carry `toolset_name`.
 * @param {any} tool - Tool definition.
 * @returns {boolean} True for the toolset.
 */
export function isToolset(tool: any): boolean;
/**
 * The size of a PNG or JPEG image, from its header.
 * @param {string} base64 - The image, base64.
 * @returns {{width: number, height: number} | null} The size, or null when it is neither or cannot be read.
 */
export function dimensions(base64: string): {
    width: number;
    height: number;
} | null;
/**
 * The size of the most recent screenshot of the conversation: the last image in a `tool_result` (or, failing that, in a user message) whose header can be read.
 * @param {any[]} messages - Anthropic messages.
 * @param {Set<string>} [skip] - Ids of calls whose result image is not a screenshot (a zoom shows a part of the screen).
 * @returns {{width: number, height: number} | null} The size, or null when there is no screenshot yet.
 */
export function sizeOf(messages: any[], skip?: Set<string>): {
    width: number;
    height: number;
} | null;
/**
 * The converter of the actions of one Gemini reply into Anthropic's computer calls. One action can be several calls (a mouse button press is a move and a press, `type` with `press_enter` is the text and a `Return`, `navigate` is the address bar, the address and a `Return`) and `key_down` and `key_up` around a click are folded into the click's `text` modifier, so it keeps what it still holds between actions.
 * @param {{width: number, height: number} | null} size - The size of the latest screenshot, for the coordinates.
 * @param {Set<string>} [enabled] - The members of the tool that are on; an action that needs another is an error.
 * @returns {{ push: (name: string, args: any) => any[], finish: () => void }} `push` gives the Anthropic inputs of one action (none while a modifier is held), `finish` throws when the reply ends with a key held.
 */
export function converter(size: {
    width: number;
    height: number;
} | null, enabled?: Set<string>): {
    push: (name: string, args: any) => any[];
    finish: () => void;
};
/**
 * Gemini's calls for one Anthropic computer call (or, for the calls one Gemini action was split into, for the whole group).
 * @param {any[]} inputs - The `input` of each call of the group, in order.
 * @param {{width: number, height: number} | null} size - The size of the latest screenshot.
 * @param {number[]} last - The last grid position the pointer was given, which a button press without a position uses.
 * @returns {{name: string, args: any}[]} Gemini's calls.
 */
export function inverse(inputs: any[], size: {
    width: number;
    height: number;
} | null, last: number[]): {
    name: string;
    args: any;
}[];
/**
 * The ids of the calls made from one Gemini action.
 * @param {string} base - The Gemini call id.
 * @param {number} count - How many Anthropic calls it became.
 * @returns {string[]} The ids: the id itself for one call, `<id>__<n>of<count>` for several.
 */
export function ids(base: string, count: number): string[];
/**
 * Rewrite an Anthropic request that uses the computer tool into one Gemini can take: the tool is removed (the caller adds Gemini's `computer_use`
 * tool), the computer calls of the history become the Gemini actions they came from (`left_click` is `click` on the grid, the calls one Gemini
 * action was split into are one action again), and each result becomes the result of those calls, with its screenshot set apart to be sent as part of
 * the function response. A past call of an action Gemini has no equivalent of (`cursor_position`, `hold_key`, `zoom`) and its result become plain text.
 * @param {any} body - Anthropic Messages body.
 * @returns {{ body: any, shape: "toolset" | "classic", enabled: Set<string>, size: {width: number, height: number} | null, custom: Set<string>, images: Map<string, {mimeType: string, data: string}> } | null} The rewritten body and what the conversion needs, or null when the request has no computer tool.
 * @throws {TranslatorError} `unsupported_computer_action` for an action of the history that Gemini has no equivalent of and that is not one of those.
 */
export function prepare(body: any): {
    body: any;
    shape: "toolset" | "classic";
    enabled: Set<string>;
    size: {
        width: number;
        height: number;
    } | null;
    custom: Set<string>;
    images: Map<string, {
        mimeType: string;
        data: string;
    }>;
} | null;
/**
 * A `tool_use` block of a reply, with `toolset_name: "computer"` when it is a member of the computer toolset (the client declared the toolset, and the
 * block is named by one of its members and is not one of the request's own tools).
 * @param {any} block - Content block.
 * @param {{shape?: string, custom: Set<string>} | undefined} computer - The conversion state of the request, if it used the computer tool.
 * @returns {any} The block, with `toolset_name` when it is a member.
 */
export function tagged(block: any, computer: {
    shape?: string;
    custom: Set<string>;
} | undefined): any;
/** The actions Gemini's desktop environment offers (`ENVIRONMENT_DESKTOP`). */
export const DESKTOP: readonly string[];
/** Every action that is mapped to Anthropic's tool. */
export const ACTIONS: Set<string>;
/** The 17 members of Anthropic's computer toolset (`computer_toolset_20260801`); the older `computer` tool takes the same names as `input.action`. */
export const MEMBERS: readonly string[];
/** The members Gemini has no action for: a past call of one is written into the history as text. */
export const UNMAPPED: readonly string[];
/** Pixels one scroll click moves; Gemini scrolls by pixels and Anthropic by clicks. */
export const PIXELS_PER_CLICK: 100;

/**
 * Whether an edit's parameters are all usable. Anything else cannot be honoured and the edit is dropped.
 * @param {any} edit - A `clear_tool_uses` edit.
 * @returns {boolean} True when every present parameter has its documented shape.
 */
export function valid(edit: any): boolean;
/**
 * Clear the results (and optionally the inputs) of the oldest tool uses of a converted conversation, as Anthropic's
 * `clear_tool_uses_20250919` edit does. Messages are changed in place.
 *
 * Tool uses are counted in conversation order across every assistant turn. The edit applies when the trigger is exceeded (default: more
 * than 100000 estimated input tokens). The most recent `keep` tool uses (default 3, whatever tool they are) are never cleared, nor are
 * uses of a tool named in `exclude_tools`. The rest, oldest first, have their result replaced by a placeholder (and, with
 * `clear_tool_inputs`, their arguments by `{}`). When fewer than `clear_at_least` input tokens would be freed nothing changes. Input
 * tokens are estimated at one per four characters (`lib/estimate`), for the trigger and for the amount cleared.
 * @param {any} edit - A valid `clear_tool_uses` edit (see `valid`).
 * @param {{ messages: any[], tools?: any[] }} body - Converted OpenAI body; its messages are edited.
 * @param {Record<string, string>} toolNames - `fitted -> original` tool names, to match `exclude_tools`.
 * @returns {{ type: string, cleared_tool_uses: number, cleared_input_tokens: number } | null} The applied edit, or null when nothing was cleared.
 */
export function clearToolUses(edit: any, body: {
    messages: any[];
    tools?: any[];
}, toolNames: Record<string, string>): {
    type: string;
    cleared_tool_uses: number;
    cleared_input_tokens: number;
} | null;
/** Input tokens above which an edit with no `trigger` applies. */
export const DEFAULT_TRIGGER: 100000;
/** Recent tool uses an edit with no `keep` leaves alone. */
export const DEFAULT_KEEP: 3;
/** What a cleared tool result says. */
export const PLACEHOLDER: "[Tool result cleared to save context]";

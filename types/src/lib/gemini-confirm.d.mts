/**
 * JSON with the keys of every object in order, so the same call always gives the same text.
 * @param {any} value - A JSON value.
 * @returns {string} The text.
 */
export function canonical(value: any): string;
/**
 * The short hash of a call.
 * @param {string} name - The Gemini function name.
 * @param {any} args - Its arguments.
 * @returns {string} Eight hex digits.
 */
export function hashOf(name: string, args: any): string;
/**
 * The line that names a flagged call.
 * @param {string} name - Function name.
 * @param {any} args - Arguments (without `safety_decision`).
 * @returns {string} The line.
 */
export function lineOf(name: string, args: any): string;
/**
 * The flagged call a text names: a line `Gemini wants to run <name> <args>`.
 * @param {string} text - The text of a block.
 * @returns {{ name: string, args: any, line: string } | null} The call and the line, or null when no line is one.
 */
export function parseLine(text: string): {
    name: string;
    args: any;
    line: string;
} | null;
/**
 * The text of a request for confirmation sent as plain text, when the request declares no tool to ask with.
 * @param {string} name - Function name.
 * @param {any} args - Arguments.
 * @param {string | undefined} explanation - Gemini's explanation.
 * @returns {string} The text: the line, then what Gemini says and what to answer.
 */
export function plainText(name: string, args: any, explanation: string | undefined): string;
/**
 * The question put to the user through a tool.
 * @param {string} name - Function name.
 * @param {any} args - Arguments.
 * @param {string | undefined} explanation - Gemini's explanation.
 * @returns {string} The question text, which names the action with its arguments and quotes Gemini's explanation.
 */
export function questionOf(name: string, args: any, explanation: string | undefined): string;
/**
 * The input of the confirmation tool (the shape of Claude Code's `AskUserQuestion`).
 * @param {string} name - Function name.
 * @param {any} args - Arguments.
 * @param {string | undefined} explanation - Gemini's explanation.
 * @returns {any} The tool input.
 */
export function inputOf(name: string, args: any, explanation: string | undefined): any;
/**
 * The tool that asks the user: the one `settings.gemini.confirmationTool` names, else `AskUserQuestion` when the request declares it with its shape.
 * Only tools of that shape are supported, because the question and its answer are in it.
 * @param {any[]} tools - The request's tools.
 * @param {string | undefined} configured - `settings.gemini.confirmationTool`.
 * @returns {{ name: string } | null} The tool, or null when there is none (the confirmation is then asked in plain text).
 * @throws {TranslatorError} `invalid_confirmation_tool` (400) when the named tool is not declared or does not take that shape.
 */
export function toolOf(tools: any[], configured: string | undefined): {
    name: string;
} | null;
/**
 * Whether the answer of the user to the question was Allow. The answer is the one `="<label>"` pair of the result text (Claude Code writes
 * `"<question>"="<answer>"`), or the only value of an `answers` object; anything else, a free-text answer included, is a no.
 * @param {string} text - The text of the tool result.
 * @returns {boolean} True only for Allow.
 */
export function allowed(text: string): boolean;
/**
 * The call id of a confirmed action.
 * @param {string} base - Gemini's call id.
 * @param {string} name - Function name.
 * @param {any} args - Arguments.
 * @returns {string} The id.
 */
export function idOf(base: string, name: string, args: any): string;
/**
 * Resolve the questions of the history. An answered question that was allowed and whose action came back from the client is folded into the turn
 * it belonged to: the action's call and result are put where the question was, so Gemini sees one turn. One that was declined, or that is still to
 * be answered with the action (the last message), becomes a call Gemini made and a result that says the user declined. The plain-text confirmations
 * of the last assistant turn are returned as `pending`: when Gemini asks again for exactly that call, the user's reply is the agreement.
 * @param {any[]} messages - Anthropic messages.
 * @param {Set<string>} actions - Names of the computer calls.
 * @returns {{ messages: any[], local: { id: string, name: string, args: any } | null, pending: Set<string> }} The messages, the action to answer with when the last user message allows one that has not been run, and the hashes of the calls asked in plain text.
 * @throws {TranslatorError} `unconfirmed_computer_action` (400) for a question that has no matching line or no answer.
 */
export function resolve(messages: any[], actions: Set<string>): {
    messages: any[];
    local: {
        id: string;
        name: string;
        args: any;
    } | null;
    pending: Set<string>;
};
/** A call id that stands for a confirmed (or asked about) action: Gemini's own id, then `__cf` and the hash of the call. */
export const MARK: RegExp;
/** What the result of an action the user declined says. */
export const DECLINED: "The user declined this action. It was not run.";

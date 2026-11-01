/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/toolsearch.mjs
 *	@Date: 2026-10-26T06:00:20-07:00 (1793019620)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-26T15:38:55-07:00 (1793054335)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * @fileoverview Claude Code's tool search: which tools a request offers when some are deferred.
 *
 * Claude Code marks tools it does not want to send up front with `defer_loading: true`, lists their names in a system reminder, and
 * gives the model a client tool, `ToolSearch`, whose result names the tools to load: as `tool_reference` blocks, and as `<function>`
 * JSON lines in the result text. A reserved `DeferredToolPlaceholder` tool (also deferred, "never call this tool") keeps the feature
 * active. Anthropic's API expands the references into real tool definitions; an OpenAI-style server cannot, so the translator does it
 * by changing the tools list of the next request.
 * @module @cldmv/llm-translator/lib/toolsearch
 */
/** The client tool the model calls to load deferred tools. */
export declare const SEARCH_TOOL = "ToolSearch";
/** The reserved deferred tool that is never offered. */
export declare const PLACEHOLDER_TOOL = "DeferredToolPlaceholder";
/** Limits on definitions read from `ToolSearch` result text, which the model's tools list is built from: count in a conversation (only definitions of tools the request does not list count), characters per definition, name, description and serialized schema. */
export declare const LIMITS: Readonly<{
    definitions: 512;
    line: 131072;
    name: 256;
    description: 16384;
    schema: 65536;
}>;
/**
 * Find what the conversation has already loaded: tools named by `tool_reference` blocks, tools the assistant has called, tools a `ToolSearch`
 * call selected by name (`select:A,B`, so a result that was cleared from a trimmed history does not unload them), and tools defined in
 * `<function>` lines of `ToolSearch` results. Only `ToolSearch` results are read, and none for a `tool_use` id that appears on more than one
 * call, so no other tool's output can add a tool. A definition that exists only in a result that history trimming removed is gone with it:
 * the name stays in `loaded`, and `plan` copes with the missing definition.
 * @param {any[]} messages - Anthropic messages.
 * @param {Set<string>} [known] - Names of the tools the request lists; their definitions are not kept (the listed one wins) and do not count against the cap.
 * @returns {{loaded: string[], searched: string[], called: string[], failed: string[], defined: Map<string, any>, capped: boolean}} Loaded names in order of first appearance, the names tool search itself loaded (selected, referenced or defined by a result; calling a tool is not evidence), names the assistant called, those of them whose every call came back as an error, the definitions found in results and whether `LIMITS.definitions` turned one away.
 */
export declare function scan(messages: any[], known?: Set<string>): {
    loaded: string[];
    searched: string[];
    called: string[];
    failed: string[];
    defined: Map<string, any>;
    capped: boolean;
};
/** Description of a tool whose definition was trimmed from the conversation. */
export declare const TRIMMED = "The definition of this tool was trimmed from the conversation; use ToolSearch to see its parameters.";
/**
 * Decide which tools a request offers.
 *
 * - `expand`: tools without `defer_loading` in request order, then the deferred tools the conversation has loaded (or `tool_choice` names), in
 *   the order they were first loaded, so the list only ever grows at its end. `ToolSearch` is offered while there is something left to load.
 * - `inline`: every tool except the placeholder, in request order, then the tools a `ToolSearch` result defined in text; `ToolSearch` is offered only when the placeholder shows that Claude Code holds
 *   tools whose definitions it did not send. `expand` behaves like `inline` when the request has neither a `ToolSearch` nor the placeholder.
 * - `native`: every tool as sent; the server is expected to understand `defer_loading` and `tool_reference`.
 *
 * A tool a `ToolSearch` result defined in text and that the request does not list is offered after the others (`expand` only).
 * `deferredTools: "drop"` leaves the deferred tools to the caller to drop and hides `ToolSearch`, which would have nothing to load.
 * @param {any[]} tools - Anthropic tools of the request.
 * @param {{loaded: string[], searched: string[], called: string[], failed: string[], defined: Map<string, any>}} found - Result of `scan`.
 * @param {{toolSearch: "expand" | "inline" | "native", deferredTools: "forward" | "drop"}} s - Settings.
 * @param {any} [choice] - The request's `tool_choice`.
 * A tool tool search loaded (selected, referenced or defined by a result) whose definition is no longer anywhere (its `ToolSearch` result was trimmed) keeps `ToolSearch` offered so the
 * model can search again, and one the assistant already called is offered with an empty object schema (`TRIMMED`) so its calls in the history
 * still map to a tool.
 * @returns {{offer: any[], loaded: string[], hidden: string[], stubbed: string[]}} Tools to convert, names of the deferred tools that are loaded, the names left out on purpose and the names of tools offered with a placeholder schema.
 */
export declare function plan(tools: any[], found: {
    loaded: string[];
    searched: string[];
    called: string[];
    failed: string[];
    defined: Map<string, any>;
}, s: {
    toolSearch: "expand" | "inline" | "native";
    deferredTools: "forward" | "drop";
}, choice?: any): {
    offer: any[];
    loaded: string[];
    hidden: string[];
    stubbed: string[];
};

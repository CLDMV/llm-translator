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
export const SEARCH_TOOL = "ToolSearch";

/** The reserved deferred tool that is never offered. */
export const PLACEHOLDER_TOOL = "DeferredToolPlaceholder";

const FUNCTION_LINE = /<function>([\s\S]*?)<\/function>/g;

/** Limits on definitions read from `ToolSearch` result text, which the model's tools list is built from: count in a conversation (only definitions of tools the request does not list count), characters per definition, name, description and serialized schema. */
export const LIMITS = Object.freeze({ definitions: 512, line: 131072, name: 256, description: 16384, schema: 65536 });

/**
 * Text of a tool result's content (string, or the text blocks of an array).
 * @param {any} content - `tool_result` content.
 * @returns {string} Text.
 */
function textOf(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block) => block?.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n");
}

/**
 * Anthropic tool from a `<function>{"name","description","parameters"}</function>` line of a `ToolSearch` result.
 * A definition is skipped when it is too large (see `LIMITS`), has no usable name, or its `parameters` is present but not a plain object schema of
 * `type: "object"` (a missing `type` is set to `object`).
 * @param {string} json - Contents of the tags.
 * @returns {{name: string, description?: string, input_schema: any} | null} Tool, or null when the line is not an acceptable tool definition.
 */
function definition(json) {
	if (json.length > LIMITS.line) return null;
	let parsed;
	try {
		parsed = JSON.parse(json);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed.name !== "string" || parsed.name === "" || parsed.name.length > LIMITS.name) return null;
	const schema = parsed.parameters ?? { type: "object", properties: {} };
	if (typeof schema !== "object" || schema === null || Array.isArray(schema) || JSON.stringify(schema).length > LIMITS.schema) return null;
	if (schema.type !== undefined && schema.type !== "object") return null;
	const tool = { name: parsed.name, input_schema: schema.type === undefined ? { type: "object", ...schema } : schema };
	if (typeof parsed.description === "string") {
		if (parsed.description.length > LIMITS.description) return null;
		tool.description = parsed.description;
	}
	return tool;
}

/**
 * Tool names a `ToolSearch` call selected: the entries of a `select:A,B` query. A keyword query selects nothing by itself; the tools its result
 * names (`tool_reference` blocks, `<function>` lines) are what it loaded.
 * @param {any} input - The `tool_use` input.
 * @returns {string[]} Names.
 */
function selected(input) {
	if (typeof input?.query !== "string" || !/^\s*select:/i.test(input.query)) return [];
	return input.query
		.replace(/^\s*select:/i, "")
		.split(/[\s,]+/)
		.filter((word) => word !== "");
}

/**
 * Find what the conversation has already loaded: tools named by `tool_reference` blocks, tools the assistant has called, tools a `ToolSearch`
 * call selected by name (`select:A,B`, so a result that was cleared from a trimmed history does not unload them), and tools defined in
 * `<function>` lines of `ToolSearch` results. Only `ToolSearch` results are read, and none for a `tool_use` id that appears on more than one
 * call, so no other tool's output can add a tool. A definition that exists only in a result that history trimming removed is gone with it:
 * the name stays in `loaded`, and `plan` copes with the missing definition.
 * @param {any[]} messages - Anthropic messages.
 * @param {Set<string>} [known] - Names of the tools the request lists; their definitions are not kept (the listed one wins) and do not count against the cap.
 * @returns {{loaded: string[], searched: string[], called: string[], defined: Map<string, any>, capped: boolean}} Loaded names in order of first appearance, the names tool search itself loaded (selected, referenced or defined by a result; calling a tool is not evidence), names the assistant called, the definitions found in results and whether `LIMITS.definitions` turned one away.
 */
export function scan(messages, known = new Set()) {
	const loaded = [];
	const searched = [];
	const called = [];
	const defined = new Map();
	const calls = new Map();
	const seen = new Map();
	let capped = false;
	const add = (name) => {
		if (!loaded.includes(name)) loaded.push(name);
	};
	const search = (name) => {
		add(name);
		if (!searched.includes(name)) searched.push(name);
	};
	for (const message of messages) {
		if (!Array.isArray(message?.content)) continue;
		for (const block of message.content) if (block?.type === "tool_use") seen.set(block.id, (seen.get(block.id) ?? 0) + 1);
	}
	for (const message of messages) {
		if (!Array.isArray(message?.content)) continue;
		for (const block of message.content) {
			if (block?.type === "tool_use") {
				if (seen.get(block.id) === 1) calls.set(block.id, block.name);
				add(block.name);
				if (!called.includes(block.name)) called.push(block.name);
				if (block.name === SEARCH_TOOL) for (const name of selected(block.input)) search(name);
			} else if (block?.type === "tool_result") {
				for (const inner of Array.isArray(block.content) ? block.content : []) {
					if (inner?.type === "tool_reference" && typeof inner.tool_name === "string") search(inner.tool_name);
				}
				if (calls.get(block.tool_use_id) !== SEARCH_TOOL) continue;
				for (const match of textOf(block.content).matchAll(FUNCTION_LINE)) {
					const tool = definition(match[1]);
					if (!tool) continue;
					search(tool.name);
					if (known.has(tool.name) || defined.has(tool.name)) continue;
					if (defined.size >= LIMITS.definitions) capped = true;
					else defined.set(tool.name, tool);
				}
			}
		}
	}
	return { loaded, searched, called, defined, capped };
}

/** Description of a tool whose definition was trimmed from the conversation. */
export const TRIMMED = "The definition of this tool was trimmed from the conversation; use ToolSearch to see its parameters.";

/**
 * Decide which tools a request offers.
 *
 * - `expand`: tools without `defer_loading` in request order, then the deferred tools the conversation has loaded (or `tool_choice` names), in
 *   the order they were first loaded, so the list only ever grows at its end. `ToolSearch` is offered while there is something left to load.
 * - `inline`: every tool except the placeholder, in request order; `ToolSearch` is offered only when the placeholder shows that Claude Code holds
 *   tools whose definitions it did not send. `expand` behaves like `inline` when the request has neither a `ToolSearch` nor the placeholder.
 * - `native`: every tool as sent; the server is expected to understand `defer_loading` and `tool_reference`.
 *
 * A tool a `ToolSearch` result defined in text and that the request does not list is offered after the others (`expand` only).
 * `deferredTools: "drop"` leaves the deferred tools to the caller to drop and hides `ToolSearch`, which would have nothing to load.
 * @param {any[]} tools - Anthropic tools of the request.
 * @param {{loaded: string[], searched: string[], called: string[], defined: Map<string, any>}} found - Result of `scan`.
 * @param {{toolSearch: "expand" | "inline" | "native", deferredTools: "forward" | "drop"}} s - Settings.
 * @param {any} [choice] - The request's `tool_choice`.
 * A tool tool search loaded (selected, referenced or defined by a result) whose definition is no longer anywhere (its `ToolSearch` result was trimmed) keeps `ToolSearch` offered so the
 * model can search again, and one the assistant already called is offered with an empty object schema (`TRIMMED`) so its calls in the history
 * still map to a tool.
 * @returns {{offer: any[], loaded: string[], hidden: string[], stubbed: string[]}} Tools to convert, names of the deferred tools that are loaded, the names left out on purpose and the names of tools offered with a placeholder schema.
 */
export function plan(tools, found, s, choice) {
	const deferred = (tool) => (tool.type === undefined || tool.type === "custom") && tool.defer_loading === true;
	if (!tools.some(deferred)) return { offer: tools, loaded: [], hidden: [], stubbed: [] };
	const placeholder = tools.some((tool) => tool.name === PLACEHOLDER_TOOL && deferred(tool));
	const real = tools.filter((tool) => deferred(tool) && tool.name !== PLACEHOLDER_TOOL);
	const hide = new Set([PLACEHOLDER_TOOL]);
	let offer = tools;
	let loaded = [];
	let stubs = [];
	const names = new Set(tools.map((tool) => tool.name));
	// Loaded by tool search, but not in the request and no longer defined anywhere: the result that defined it was trimmed. A tool that was merely
	// called and is absent from the request was removed by the client on purpose and is not offered.
	const lost = found.searched.filter((name) => !names.has(name) && !found.defined.has(name));
	// Loading on demand needs a client `ToolSearch` (or the placeholder that says Claude Code has one); without either, as with the server-side
	// tool search of an SDK client, nothing could ever load the deferred tools, so they are offered at once.
	const searchable = placeholder || tools.some((tool) => tool.name === SEARCH_TOOL);
	if (s.deferredTools === "drop") {
		hide.add(SEARCH_TOOL);
	} else if (s.toolSearch === "native") {
		hide.clear();
	} else {
		if (searchable) stubs = found.called.filter((name) => lost.includes(name));
		if (s.toolSearch === "inline" || !searchable) {
			if (!placeholder && lost.length === 0) hide.add(SEARCH_TOOL);
			loaded = real.map((tool) => tool.name);
		} else {
			const wanted = new Set(found.loaded);
			if (choice?.type === "tool") wanted.add(choice.name);
			const extra = [...wanted].map((name) => real.find((tool) => tool.name === name)).filter((tool) => tool !== undefined);
			const late = [...wanted].filter((name) => !names.has(name) && found.defined.has(name)).map((name) => found.defined.get(name));
			if (!placeholder && extra.length === real.length && lost.length === 0) hide.add(SEARCH_TOOL);
			offer = [...tools.filter((tool) => !deferred(tool)), ...extra, ...late];
			loaded = [...extra, ...late].map((tool) => tool.name);
		}
	}
	return {
		offer: [
			...offer.filter((tool) => !hide.has(tool.name)),
			...stubs.map((name) => ({ name, description: TRIMMED, input_schema: { type: "object" } }))
		],
		loaded,
		hidden: tools.filter((tool) => hide.has(tool.name)).map((tool) => tool.name),
		stubbed: stubs
	};
}

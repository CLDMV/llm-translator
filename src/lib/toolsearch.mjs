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

/** Limits on definitions read from `ToolSearch` result text, which the model's tools list is built from: count in a conversation, characters per definition, name, description and serialized schema. */
export const LIMITS = Object.freeze({ definitions: 64, line: 131072, name: 256, description: 16384, schema: 65536 });

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
 * A definition is skipped when it is too large (see `LIMITS`), has no usable name, or its `parameters` is present but not a plain object.
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
	const tool = { name: parsed.name, input_schema: schema };
	if (typeof parsed.description === "string") {
		if (parsed.description.length > LIMITS.description) return null;
		tool.description = parsed.description;
	}
	return tool;
}

/**
 * Tool names a `ToolSearch` call asked for: the entries of a `select:A,B` query, or any word of a keyword query. A word only matters when it
 * equals the name of a tool the request defines, so unrelated words do nothing.
 * @param {any} input - The `tool_use` input.
 * @returns {string[]} Candidate names.
 */
function asked(input) {
	if (typeof input?.query !== "string") return [];
	return input.query
		.replace(/^\s*select:/i, "")
		.split(/[\s,]+/)
		.map((word) => word.replace(/^\+/, ""))
		.filter((word) => word !== "");
}

/**
 * Find what the conversation has already loaded: tools named by `tool_reference` blocks, tools the assistant has called, tools a `ToolSearch`
 * call asked for by name (so a result that was cleared from a trimmed history does not unload them), and tools defined in `<function>` lines
 * of `ToolSearch` results. Only `ToolSearch` results are read, and none for a `tool_use` id that appears on more than one call, so no other
 * tool's output can add a tool. A definition that exists only in a result that was trimmed away is gone with it.
 * @param {any[]} messages - Anthropic messages.
 * @returns {{loaded: string[], defined: Map<string, any>}} Names in order of first appearance, and the definitions found in results.
 */
export function scan(messages) {
	const loaded = [];
	const defined = new Map();
	const calls = new Map();
	const seen = new Map();
	const add = (name) => {
		if (!loaded.includes(name)) loaded.push(name);
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
				if (block.name === SEARCH_TOOL) for (const name of asked(block.input)) add(name);
			} else if (block?.type === "tool_result") {
				for (const inner of Array.isArray(block.content) ? block.content : []) {
					if (inner?.type === "tool_reference" && typeof inner.tool_name === "string") add(inner.tool_name);
				}
				if (calls.get(block.tool_use_id) !== SEARCH_TOOL) continue;
				for (const match of textOf(block.content).matchAll(FUNCTION_LINE)) {
					if (defined.size >= LIMITS.definitions) break;
					const tool = definition(match[1]);
					if (tool) {
						add(tool.name);
						if (!defined.has(tool.name)) defined.set(tool.name, tool);
					}
				}
			}
		}
	}
	return { loaded, defined };
}

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
 * @param {{loaded: string[], defined: Map<string, any>}} found - Result of `scan`.
 * @param {{toolSearch: "expand" | "inline" | "native", deferredTools: "forward" | "drop"}} s - Settings.
 * @param {any} [choice] - The request's `tool_choice`.
 * @returns {{offer: any[], loaded: string[], hidden: string[]}} Tools to convert, names of the deferred tools that are loaded, and the names left out on purpose.
 */
export function plan(tools, found, s, choice) {
	const deferred = (tool) => (tool.type === undefined || tool.type === "custom") && tool.defer_loading === true;
	if (!tools.some(deferred)) return { offer: tools, loaded: [], hidden: [] };
	const placeholder = tools.some((tool) => tool.name === PLACEHOLDER_TOOL && deferred(tool));
	const real = tools.filter((tool) => deferred(tool) && tool.name !== PLACEHOLDER_TOOL);
	const hide = new Set([PLACEHOLDER_TOOL]);
	let offer = tools;
	let loaded = [];
	// Loading on demand needs a client `ToolSearch` (or the placeholder that says Claude Code has one); without either, as with the server-side
	// tool search of an SDK client, nothing could ever load the deferred tools, so they are offered at once.
	const searchable = placeholder || tools.some((tool) => tool.name === SEARCH_TOOL);
	if (s.deferredTools === "drop") {
		hide.add(SEARCH_TOOL);
	} else if (s.toolSearch === "native") {
		hide.clear();
	} else if (s.toolSearch === "inline" || !searchable) {
		if (!placeholder) hide.add(SEARCH_TOOL);
		loaded = real.map((tool) => tool.name);
	} else {
		const wanted = new Set(found.loaded);
		if (choice?.type === "tool") wanted.add(choice.name);
		const names = new Set(tools.map((tool) => tool.name));
		const extra = [...wanted].map((name) => real.find((tool) => tool.name === name)).filter((tool) => tool !== undefined);
		const late = [...wanted].filter((name) => !names.has(name) && found.defined.has(name)).map((name) => found.defined.get(name));
		if (!placeholder && extra.length === real.length) hide.add(SEARCH_TOOL);
		offer = [...tools.filter((tool) => !deferred(tool)), ...extra, ...late];
		loaded = [...extra, ...late].map((tool) => tool.name);
	}
	return {
		offer: offer.filter((tool) => !hide.has(tool.name)),
		loaded,
		hidden: tools.filter((tool) => hide.has(tool.name)).map((tool) => tool.name)
	};
}

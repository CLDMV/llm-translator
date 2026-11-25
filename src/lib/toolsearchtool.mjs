/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/toolsearchtool.mjs
 *	@Date: 2026-11-25T02:00:00-08:00 (1795600800)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-25T02:00:00-08:00 (1795600800)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The `tool_search_tool_regex_*` and `tool_search_tool_bm25_*` server tools: an executor for the server tool runner (see
 * servertools.mjs) that searches the request's tools marked `defer_loading: true`. It needs no external service.
 *
 * The runner withholds the deferred tools from the upstream until a search names them (or a `tool_reference` in the history does), then offers
 * them as ordinary function tools. The regex variant takes `{ pattern, limit? }`, a JavaScript regular expression matched case-insensitively
 * (Anthropic's is a Python `re` pattern; the common syntax is shared), at most 200 characters. The BM25 variant takes `{ query, limit? }`, natural
 * language of at most 500 characters. Both search a tool's name, description, and its argument names and descriptions, and return up to `limit`
 * tools (default 5, at most 10000) as `tool_reference` blocks. This is not the client-side `ToolSearch` of Claude Code (see toolsearch.mjs).
 * @module @cldmv/llm-translator/lib/toolsearchtool
 */
import { runInNewContext } from "node:vm";
import { TranslatorError } from "./errors.mjs";

/** Longest regex pattern, in characters. */
const PATTERN_LENGTH = 200;

/** Longest BM25 query, in characters. */
const QUERY_LENGTH = 500;

/** Most tools one search may return. */
const MOST = 10000;

/** Default time limit of one regex search, in ms. */
const TIMEOUT = 1000;

/** Default number of tools one search returns. */
const COUNT = 5;

/**
 * An error with an Anthropic error code.
 * @param {string} code - `error_code` of the result.
 * @param {string} message - Message.
 * @returns {Error} Error carrying `code`.
 */
function failure(code, message) {
	return Object.assign(new Error(message), { code });
}

/**
 * Whether a tool is one the search covers: a custom tool marked `defer_loading`.
 * @param {any} tool - Tool of the request.
 * @returns {boolean} True for a deferred custom tool.
 */
function searchable(tool) {
	return (tool?.type === undefined || tool.type === "custom") && tool.defer_loading === true && typeof tool.name === "string";
}

/**
 * The texts a search looks at for a tool: its name, description, and argument names and descriptions.
 * @param {any} tool - Tool of the request.
 * @returns {string[]} Fields.
 */
function fields(tool) {
	const out = [tool.name];
	if (typeof tool.description === "string") out.push(tool.description);
	const properties = tool.input_schema?.properties;
	if (properties && typeof properties === "object") {
		for (const [key, value] of Object.entries(properties)) {
			out.push(key);
			if (typeof value?.description === "string") out.push(value.description);
		}
	}
	return out;
}

/** Words too common to tell tools apart; BM25 ignores them. */
const COMMON = new Set(["a", "an", "the", "of", "to", "in", "on", "at", "is", "for", "and", "or", "with", "what", "how"]);

/**
 * Lower-case words of a text (camelCase, snake_case and punctuation split words), without the common ones.
 * @param {string} value - Text.
 * @returns {string[]} Words.
 */
function words(value) {
	return value
		.replace(/([a-z\d])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter((word) => word !== "" && !COMMON.has(word));
}

/**
 * Rank tools against a query with BM25 (k1 1.5, b 0.75) over each tool's fields as one document.
 * @param {any[]} tools - Searchable tools.
 * @param {string} query - Natural language query.
 * @returns {any[]} Tools with a positive score, best first (ties keep request order).
 */
function rank(tools, query) {
	const documents = tools.map((tool) => words(fields(tool).join(" ")));
	const average = documents.reduce((sum, document) => sum + document.length, 0) / documents.length;
	const terms = [...new Set(words(query))];
	const scored = tools.map((tool, index) => {
		const document = documents[index];
		let score = 0;
		for (const term of terms) {
			const frequency = document.filter((word) => word === term).length;
			if (frequency === 0) continue;
			const holding = documents.filter((other) => other.includes(term)).length;
			const idf = Math.log(1 + (documents.length - holding + 0.5) / (holding + 0.5));
			score += (idf * frequency * 2.5) / (frequency + 1.5 * (0.25 + (0.75 * document.length) / average));
		}
		return { tool, index, score };
	});
	return scored
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score || a.index - b.index)
		.map((entry) => entry.tool);
}

/**
 * Match a regex against every tool's fields in a separate context, so a pattern that backtracks without end is interrupted at `timeout`.
 * @param {string} source - Pattern.
 * @param {string[][]} groups - The fields of each tool.
 * @param {number} timeout - Time limit in ms.
 * @returns {boolean[]} Whether each tool matched.
 * @throws {Error} `invalid_tool_input` for a pattern that is not a valid regular expression, `execution_time_exceeded` after `timeout`.
 */
function matching(source, groups, timeout) {
	try {
		return runInNewContext(
			"const re = new RegExp(source, 'i'); Array.from(groups, (fields) => fields.some((field) => re.test(field)))",
			{ source, groups },
			{ timeout }
		);
	} catch (cause) {
		if (cause?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT")
			throw failure("execution_time_exceeded", `the search took longer than ${timeout} ms`);
		throw failure("invalid_tool_input", `Invalid regular expression pattern: ${cause.message}`);
	}
}

/**
 * The `tool_search_tool_*` executor for the server tool runner.
 * @param {object} [options] - Options.
 * @param {number} [options.count] - Tools returned when the model sets no `limit` (default 5).
 * @param {number} [options.timeout] - Time limit of one regex search in ms (default 1000); a pattern that runs longer is answered with `execution_time_exceeded`.
 * @param {RegExp | string} [options.type] - Tool types served (default `/^tool_search_tool_(regex|bm25)_/`).
 * @returns {import("./servertools.mjs").ServerToolExecutor} The executor.
 * @throws {TranslatorError} `INVALID_CONFIG` for a `count` or `timeout` that is not a positive whole number.
 */
export function toolSearch({ count = COUNT, timeout = TIMEOUT, type = /^tool_search_tool_(regex|bm25)_/ } = /** @type {any} */ ({})) {
	if (!Number.isInteger(count) || count < 1) {
		throw new TranslatorError("toolSearch: count must be a positive whole number", { code: "INVALID_CONFIG", status: 500 });
	}
	if (!Number.isInteger(timeout) || timeout < 1) {
		throw new TranslatorError("toolSearch: timeout must be a positive whole number", { code: "INVALID_CONFIG", status: 500 });
	}
	const regex = (tool) => String(tool?.type).startsWith("tool_search_tool_regex_");
	return {
		type,
		result: "tool_search_tool_result",
		deferred: true,
		description: (tool) =>
			regex(tool)
				? "Search the deferred tools by a regular expression over their names, descriptions and arguments (case-insensitive). The tools found become available to call."
				: "Search the deferred tools with a natural language query over their names, descriptions and arguments. The tools found become available to call.",
		schema: (tool) => ({
			type: "object",
			properties: {
				[regex(tool) ? "pattern" : "query"]: {
					type: "string",
					description: regex(tool) ? "A regular expression of at most 200 characters." : "What the tool should do, at most 500 characters."
				},
				limit: { type: "integer", description: "The most tools to return." }
			},
			required: [regex(tool) ? "pattern" : "query"]
		}),
		async run(input, { tool, context }) {
			const key = regex(tool) ? "pattern" : "query";
			const text = input?.[key];
			if (typeof text !== "string" || text === "") throw failure("invalid_tool_input", `the search ${key} is missing`);
			const limit = input.limit ?? count;
			if (!Number.isInteger(limit) || limit < 1 || limit > MOST) {
				throw failure("invalid_tool_input", `limit must be a whole number from 1 to ${MOST}`);
			}
			const tools = context.tools.filter(searchable);
			let found;
			if (regex(tool)) {
				if (text.length > PATTERN_LENGTH) throw failure("invalid_tool_input", `the pattern is longer than ${PATTERN_LENGTH} characters`);
				const hits = matching(text, tools.map(fields), timeout);
				found = tools.filter((_, index) => hits[index]);
			} else {
				if (text.length > QUERY_LENGTH) throw failure("invalid_tool_input", `the query is longer than ${QUERY_LENGTH} characters`);
				found = rank(tools, text);
			}
			return {
				content: {
					type: "tool_search_tool_search_result",
					tool_references: found.slice(0, limit).map((candidate) => ({ type: "tool_reference", tool_name: candidate.name }))
				}
			};
		},
		read(content) {
			const names = (content?.tool_references ?? []).map((reference) => reference?.tool_name).filter((name) => typeof name === "string");
			return names.length === 0 ? "No matching tools found." : `Loaded tools, now available to call: ${names.join(", ")}`;
		}
	};
}

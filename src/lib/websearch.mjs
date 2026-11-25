/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/websearch.mjs
 *	@Date: 2026-11-25T00:31:57-08:00 (1795595517)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-25T00:38:12-08:00 (1795595892)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The `web_search_*` server tool: an executor for the server tool runner (see servertools.mjs) that answers through a search
 * provider adapter, and one reference adapter for SearXNG.
 *
 * A provider adapter is `{ name, search(query, options) }`. `search` resolves with `[{ url, title, page_age?, snippet? }]`, best result first,
 * and receives `{ count, allowedDomains, blockedDomains, userLocation, signal }`. The executor applies `allowed_domains` and `blocked_domains`
 * to whatever the provider returns, so an adapter may ignore them (or use them to narrow its own query). A provider signals a failure with an
 * error whose `code` is one of Anthropic's web search error codes (`too_many_requests`, `query_too_long`, `invalid_tool_input`,
 * `unavailable`); any other error becomes `unavailable`.
 *
 * The results are numbered across the whole request (see `read` and `cite`), and the model is told to write `[[cite:N]]` after a statement
 * that comes from result N. The runner turns those markers into `web_search_result_location` citations (see citemarks.mjs).
 * @module @cldmv/llm-translator/lib/websearch
 */
import { TranslatorError } from "./errors.mjs";

/** The error codes of `web_search_tool_result_error` a provider or the executor may produce. */
const CODES = new Set(["too_many_requests", "invalid_tool_input", "query_too_long", "unavailable"]);

/** Default number of results returned to the model. */
const COUNT = 5;

/** Default longest query, in characters. */
const QUERY_LENGTH = 400;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

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
 * Encode a snippet as the opaque `encrypted_content` of a result. It is only base64 JSON: the translator reads it back when the client
 * replays the history, so the upstream model sees the result text again.
 * @param {string | undefined} snippet - Result snippet.
 * @returns {string} Opaque string.
 */
export function seal(snippet) {
	return Buffer.from(JSON.stringify({ snippet: snippet ?? "" })).toString("base64url");
}

/**
 * The snippet inside an `encrypted_content` string.
 * @param {any} value - `encrypted_content` of a result (possibly from another server, so not necessarily readable).
 * @returns {string} Snippet, or an empty string when the value is not one this module wrote.
 */
export function unseal(value) {
	try {
		const snippet = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8")).snippet;
		return typeof snippet === "string" ? snippet : "";
	} catch {
		return "";
	}
}

/**
 * The opaque `encrypted_index` of a citation: the base64url JSON of the result's URL. Like `encrypted_content` it is not encrypted; it only
 * identifies the result the cited text came from.
 * @param {string} url - Result URL.
 * @returns {string} Opaque string.
 */
export function locate(url) {
	return Buffer.from(JSON.stringify({ url })).toString("base64url");
}

/** The longest `cited_text` of a citation, in characters (Anthropic's own limit). */
const CITED = 150;

/**
 * Whether a URL belongs to a domain list entry: the host equals the entry or is a subdomain of it. An entry with a path (`example.com/blog`)
 * also requires the URL's path to start with it.
 * @param {string} url - Result URL.
 * @param {string[]} domains - Domain entries.
 * @returns {boolean} True when any entry matches.
 */
function inDomains(url, domains) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	const host = parsed.hostname.toLowerCase();
	return domains.some((entry) => {
		const [domain, ...rest] = String(entry)
			.toLowerCase()
			.replace(/^https?:\/\//, "")
			.split("/");
		const path = rest.join("/");
		const hostMatches = host === domain || host.endsWith(`.${domain}`);
		return hostMatches && (path === "" || parsed.pathname.toLowerCase().startsWith(`/${path}`));
	});
}

/**
 * The `web_search_*` executor for the server tool runner.
 * @param {object} options - Options.
 * @param {{name?: string, search: Function}} options.provider - Search provider adapter.
 * @param {number} [options.count] - Results returned to the model (default 5).
 * @param {number} [options.maxQueryLength] - Longest query, in characters (default 400); a longer one is answered with `query_too_long`.
 * @param {RegExp | string} [options.type] - Tool types served (default `/^web_search_/`).
 * @returns {import("./servertools.mjs").ServerToolExecutor} The executor.
 * @throws {TranslatorError} `INVALID_CONFIG` for a provider with no `search` function, or a `count` / `maxQueryLength` that is not a positive whole number.
 */
export function webSearch({ provider, count = COUNT, maxQueryLength = QUERY_LENGTH, type = /^web_search_/ } = /** @type {any} */ ({})) {
	const bad = (message) => new TranslatorError(`webSearch: ${message}`, { code: "INVALID_CONFIG", status: 500 });
	if (!provider || typeof provider.search !== "function") throw bad("provider must have a search function");
	if (!Number.isInteger(count) || count < 1) throw bad("count must be a positive whole number");
	if (!Number.isInteger(maxQueryLength) || maxQueryLength < 1) throw bad("maxQueryLength must be a positive whole number");
	return {
		type,
		description:
			"Search the web for current information. Returns numbered results with titles, URLs and snippets. " +
			"When a statement in your answer comes from a result, write [[cite:N]] right after it, where N is that result's number " +
			"(numbers continue across searches in the conversation). Write only numbers you were given.",
		schema: () => ({
			type: "object",
			properties: { query: { type: "string", description: "The search query." } },
			required: ["query"]
		}),
		async run(input, { tool, signal }) {
			const query = input?.query;
			if (typeof query !== "string" || query.trim() === "") throw failure("invalid_tool_input", "the search query is missing");
			if (query.length > maxQueryLength) throw failure("query_too_long", `the search query is longer than ${maxQueryLength} characters`);
			const allowed = Array.isArray(tool.allowed_domains) && tool.allowed_domains.length > 0 ? tool.allowed_domains : undefined;
			const blocked = Array.isArray(tool.blocked_domains) && tool.blocked_domains.length > 0 ? tool.blocked_domains : undefined;
			if (allowed && blocked) throw failure("invalid_tool_input", "allowed_domains and blocked_domains cannot both be set");
			let found;
			try {
				found = await provider.search(query, {
					count,
					allowedDomains: allowed,
					blockedDomains: blocked,
					userLocation: tool.user_location ?? undefined,
					signal
				});
			} catch (cause) {
				throw failure(CODES.has(cause?.code) ? cause.code : "unavailable", cause?.message ?? String(cause));
			}
			if (!Array.isArray(found)) throw failure("unavailable", "the search provider returned no result list");
			const kept = found
				.filter((hit) => typeof hit?.url === "string" && hit.url !== "")
				.filter((hit) => (allowed ? inDomains(hit.url, allowed) : true))
				.filter((hit) => (blocked ? !inDomains(hit.url, blocked) : true))
				.slice(0, count);
			return {
				content: kept.map((hit) => ({
					type: "web_search_result",
					url: hit.url,
					title: hit.title ?? hit.url,
					encrypted_content: seal(hit.snippet),
					page_age: hit.page_age ?? null
				}))
			};
		},
		cite(hit) {
			return {
				type: "web_search_result_location",
				url: hit.url,
				title: hit.title ?? hit.url,
				encrypted_index: locate(hit.url),
				cited_text: unseal(hit.encrypted_content).slice(0, CITED)
			};
		},
		read(content, offset = 0) {
			if (!Array.isArray(content) || content.length === 0) return "No results.";
			return content
				.map((hit, index) => {
					const snippet = unseal(hit.encrypted_content);
					const age = hit.page_age ? ` (${hit.page_age})` : "";
					return `${offset + index + 1}. ${hit.title}${age}\n${hit.url}${snippet === "" ? "" : `\n${snippet}`}`;
				})
				.join("\n\n");
		}
	};
}

/**
 * A page age string (`April 30, 2025`) for a date a search engine reported.
 * @param {any} value - Date text, or anything else.
 * @returns {string | null} Age text, or null when there is no valid date.
 */
function age(value) {
	if (typeof value !== "string") return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

/**
 * The SearXNG search provider adapter (self-hostable; the instance must allow the JSON format: `search.formats` includes `json`).
 * @param {object} options - Options.
 * @param {string} options.url - Base URL of the instance (`https://searx.example.com`); `/search?format=json&q=...` is requested.
 * @param {Record<string, string>} [options.headers] - Extra request headers (an API key header or an `Authorization` header for a gateway in front).
 * @param {string | ((userLocation: any) => string | undefined)} [options.language] - The `language` parameter, or a function of the tool's `user_location`.
 * @param {string} [options.categories] - The `categories` parameter (comma separated).
 * @param {string} [options.engines] - The `engines` parameter (comma separated).
 * @param {0 | 1 | 2} [options.safesearch] - The `safesearch` parameter.
 * @param {number} [options.timeout] - Request time limit in ms (default 15000).
 * @param {Function} [options.fetch] - `fetch`-compatible function (default `globalThis.fetch`).
 * @returns {{name: string, search: Function}} The adapter.
 * @throws {TranslatorError} `INVALID_CONFIG` for a missing `url` or a `timeout` that is not a positive whole number.
 */
export function searxng(
	{ url, headers = {}, language, categories, engines, safesearch, timeout = 15000, fetch = globalThis.fetch } = /** @type {any} */ ({})
) {
	const bad = (message) => new TranslatorError(`searxng: ${message}`, { code: "INVALID_CONFIG", status: 500 });
	if (typeof url !== "string" || url === "") throw bad("url is required");
	if (!Number.isInteger(timeout) || timeout < 1) throw bad("timeout must be a positive whole number");
	let base = url;
	while (base.endsWith("/")) base = base.slice(0, -1);
	return {
		name: "searxng",
		async search(query, { signal, userLocation } = /** @type {any} */ ({})) {
			const params = new URLSearchParams({ q: query, format: "json" });
			const lang = typeof language === "function" ? language(userLocation) : language;
			for (const [key, value] of Object.entries({ language: lang, categories, engines, safesearch })) {
				if (value !== undefined) params.set(key, String(value));
			}
			const limit = AbortSignal.timeout(timeout);
			let response;
			try {
				response = await fetch(`${base}/search?${params}`, {
					headers: { accept: "application/json", ...headers },
					signal: signal ? AbortSignal.any([signal, limit]) : limit
				});
			} catch (cause) {
				throw failure("unavailable", `SearXNG request failed: ${cause?.message ?? cause}`);
			}
			if (response.status === 429) throw failure("too_many_requests", "SearXNG rate limited the request");
			if (!response.ok) throw failure("unavailable", `SearXNG answered HTTP ${response.status}`);
			let body;
			try {
				body = await response.json();
			} catch {
				throw failure("unavailable", "SearXNG did not answer with JSON (is the json format enabled?)");
			}
			if (!Array.isArray(body?.results)) throw failure("unavailable", "SearXNG answered with no results list");
			return body.results.map((hit) => ({
				url: hit.url,
				title: hit.title,
				snippet: hit.content,
				page_age: age(hit.publishedDate)
			}));
		}
	};
}

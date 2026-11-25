/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/webfetch.mjs
 *	@Date: 2026-11-25T00:45:00-08:00 (1795596300)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-25T00:45:00-08:00 (1795596300)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The executor of Anthropic's `web_fetch_*` server tool, `webFetch(options)`, which the caller adds to `serverTools` (exported from the package entry). It fetches the URL the model
 * asks for through the same safeguarded fetcher as the `documentUrls` setting (`lib/fetch-url`: required host allow-list, address checks,
 * redirect re-checks, size and time limits) and answers with Anthropic's `web_fetch_result`. The tool definition's own `allowed_domains`,
 * `blocked_domains`, `max_content_tokens` and `citations` fields are honoured, and, as Anthropic requires, only a URL that appeared in the
 * conversation (a user message or an earlier tool result) is fetched.
 * @module @cldmv/llm-translator/lib/webfetch
 */
import { CHARS_PER_TOKEN } from "./estimate.mjs";
import { TranslatorError } from "./errors.mjs";
import { fetchUrl } from "./fetch-url.mjs";
import { htmlToText } from "./html-text.mjs";
import * as pdf from "./pdf.mjs";

/** Defaults of the options other than `allow`. */
export const DEFAULTS = Object.freeze({ maxBytes: 32 * 1024 * 1024, timeout: 30_000, maxRedirects: 3, maxPages: 100, allowPrivate: false });

const KEYS = ["allow", "maxBytes", "timeout", "maxRedirects", "maxPages", "allowPrivate", "deps"];

/** What the fetcher accepts for a web fetch: PDF, plain text and HTML. */
const TYPES = new Map([
	["application/pdf", "application/pdf"],
	["text/plain", "text/plain"],
	["text/html", "text/html"],
	["application/xhtml+xml", "text/html"]
]);

/** Where a URL may be read from: the text of every user message, and the content of every server tool result. */
const URL_PATTERN = /https?:\/\/[^\s<>"'`\\]+/gi;

/** The Anthropic error code of each kind of fetch failure that is not the default `url_not_accessible`. */
const CODES = {
	scheme: "url_not_allowed",
	allow: "url_not_allowed",
	address: "url_not_allowed",
	downgrade: "url_not_allowed",
	type: "unsupported_content_type"
};

/**
 * An error the runner turns into the tool's error result.
 */
class FetchToolError extends Error {
	/**
	 * @param {string} code - Anthropic's `error_code`.
	 * @param {string} message - What to log.
	 */
	constructor(code, message) {
		super(message);
		this.name = "FetchToolError";
		this.code = code;
	}
}

/**
 * The error for a bad `webFetch` option.
 * @param {string} problem - What is wrong.
 * @returns {TranslatorError} Error with code `INVALID_CONFIG`.
 */
function invalid(problem) {
	return new TranslatorError(`serverTools: webFetch ${problem}`, { code: "INVALID_CONFIG", status: 500 });
}

/**
 * Collect every URL in a value into a set, as `URL.href` strings.
 * @param {any} value - A string, or arrays and objects holding strings.
 * @param {Set<string>} out - The set.
 * @returns {void}
 */
function collect(value, out) {
	if (typeof value === "string") {
		for (const [found] of value.matchAll(URL_PATTERN)) {
			// A URL at the end of a sentence or in brackets keeps no closing punctuation; both readings are accepted.
			for (const candidate of [found, found.replace(/[.,;:!?)\]}]+$/, "")]) if (URL.canParse(candidate)) out.add(new URL(candidate).href);
		}
	} else if (value !== null && typeof value === "object") {
		for (const item of Object.values(value)) collect(item, out);
	}
}

/**
 * The URLs that appeared in the conversation: in user messages (text, client tool results, documents), in the results of server tools anywhere in
 * the history, and in the results the runner produced earlier in this request.
 * @param {{model?: string, metadata?: any, messages?: any[], results?: any[]}} context - Context of the call.
 * @returns {Set<string>} URLs as `URL.href` strings.
 */
export function conversationUrls(context) {
	const out = new Set();
	for (const message of context.messages ?? []) {
		if (message?.role === "user") collect(message.content, out);
		else if (Array.isArray(message?.content)) {
			for (const block of message.content)
				if (typeof block?.type === "string" && block.type.endsWith("_tool_result")) collect(block.content, out);
		}
	}
	collect(context.results ?? [], out);
	return out;
}

/**
 * Parse a list of domains of a tool definition (`example.com`, `docs.example.com`, `example.com/blog`).
 * @param {any} list - The tool's `allowed_domains` or `blocked_domains`.
 * @returns {{host: string, path: string}[]} Rules; an entry that is not a string is ignored.
 */
function rules(list) {
	return (Array.isArray(list) ? list : [])
		.filter((entry) => typeof entry === "string" && entry.trim() !== "")
		.map((entry) => {
			const bare = entry
				.trim()
				.toLowerCase()
				.replace(/^https?:\/\//, "");
			const slash = bare.indexOf("/");
			return slash === -1 ? { host: bare, path: "" } : { host: bare.slice(0, slash), path: bare.slice(slash).replace(/\/+$/, "") };
		});
}

/**
 * Whether a URL matches a domain rule: the host itself or any subdomain, and, when the rule has a path, that path and the paths below it.
 * @param {URL} url - URL.
 * @param {{host: string, path: string}} rule - Rule.
 * @returns {boolean} True on a match.
 */
function matches(url, rule) {
	const host = url.hostname.toLowerCase().replace(/\.$/, "");
	if (host !== rule.host && !host.endsWith(`.${rule.host}`)) return false;
	return rule.path === "" || url.pathname === rule.path || url.pathname.startsWith(`${rule.path}/`);
}

/**
 * The URL check a tool definition's `allowed_domains` and `blocked_domains` make.
 * @param {any} tool - Tool definition.
 * @returns {(url: URL) => boolean} True for a URL the tool may fetch.
 */
export function permit(tool) {
	const allowed = rules(tool.allowed_domains);
	const blocked = rules(tool.blocked_domains);
	return (url) => (allowed.length === 0 || allowed.some((rule) => matches(url, rule))) && !blocked.some((rule) => matches(url, rule));
}

/**
 * The Anthropic error for a failed fetch.
 * @param {import("./fetch-url.mjs").FetchError} failure - What the fetcher threw.
 * @returns {FetchToolError} Error with `error_code` set.
 */
function failed(failure) {
	const code = failure.status === 429 ? "too_many_requests" : (CODES[failure.kind] ?? "url_not_accessible");
	return new FetchToolError(code, failure.detail);
}

/**
 * The text of a fetched document and its title.
 * @param {{bytes: Buffer, mediaType: string}} got - The fetched body.
 * @param {{maxPages: number, maxBytes: number}} limits - PDF limits.
 * @returns {Promise<{text: string, title: string | null}>} Text and title.
 * @throws {FetchToolError} `unsupported_content_type` for a PDF that cannot be read (or one over the page limit), `unavailable` when the PDF library is missing.
 */
async function read(got, limits) {
	if (got.mediaType === "text/html") return htmlToText(got.bytes.toString("utf8"));
	if (got.mediaType === "text/plain") return { text: got.bytes.toString("utf8"), title: null };
	let extracted;
	try {
		extracted = await pdf.extract(got.bytes, limits);
	} catch (cause) {
		throw new FetchToolError(cause.code === "pdf_unavailable" ? "unavailable" : "unsupported_content_type", cause.message);
	}
	const pages = extracted.pages.map((text, i) => `--- Page ${i + 1} ---\n${text}`);
	return { text: pages.join("\n\n"), title: extracted.title };
}

/**
 * Build the executor of the `web_fetch_*` server tool.
 * @param {any} options - `{ allow, maxBytes?, timeout?, maxRedirects?, maxPages?, allowPrivate? }`: the host allow-list (required; `"files.example.com"`, `"*.example.com"` or `"*"`) and the limits of `documentUrls`, plus `maxPages` for a PDF. `deps` replaces the host name lookup and protocol modules (for tests).
 * @returns {import("./servertools.mjs").ServerToolExecutor} The executor.
 * @throws {TranslatorError} `INVALID_CONFIG` for an unknown key, a missing or empty `allow`, or a limit of the wrong kind.
 */
export function webFetch(options) {
	if (options === null || typeof options !== "object" || Array.isArray(options)) throw invalid("must be an object with an allow list");
	const unknown = Object.keys(options).filter((key) => !KEYS.includes(key));
	if (unknown.length > 0) throw invalid(`has unknown ${unknown.length > 1 ? "keys" : "key"} ${unknown.join(", ")}`);
	const { allow } = options;
	if (!Array.isArray(allow) || allow.length === 0 || !allow.every((entry) => typeof entry === "string" && entry.trim() !== "")) {
		throw invalid('needs allow, a non-empty list of host names such as "docs.example.com" or "*.example.com"');
	}
	const set = { ...DEFAULTS, ...options, allow: allow.map((entry) => entry.trim().toLowerCase()) };
	for (const key of ["maxBytes", "timeout", "maxPages"]) {
		if (!Number.isInteger(set[key]) || set[key] <= 0) throw invalid(`${key} must be a positive integer`);
	}
	if (!Number.isInteger(set.maxRedirects) || set.maxRedirects < 0) throw invalid("maxRedirects must be an integer of 0 or more");
	if (typeof set.allowPrivate !== "boolean") throw invalid("allowPrivate must be true or false");
	return {
		type: /^web_fetch_/,
		schema: () => ({
			type: "object",
			properties: { url: { type: "string", description: "The URL to fetch. It must be a URL that appeared in the conversation." } },
			required: ["url"]
		}),
		description:
			"Fetch the content of a web page or PDF from a URL. Only URLs that appeared in the conversation (in a user message or an earlier tool result) can be fetched.",
		read(content) {
			const document = content?.content;
			// Content the translator did not produce (a client replaying another server's result) is not read as text.
			if (document?.source?.type !== "text" || typeof document.source.data !== "string") return JSON.stringify(content);
			return `${document.title ? `${document.title}\n` : ""}${content.url}\n\n${document.source.data}`;
		},
		async run(input, { tool, signal, context }) {
			if (typeof input?.url !== "string" || !URL.canParse(input.url))
				throw new FetchToolError("invalid_tool_input", "url is not a valid URL");
			const url = new URL(input.url);
			if (!conversationUrls(context).has(url.href))
				throw new FetchToolError("url_not_allowed", `${url.host}${url.pathname} did not appear in the conversation`);
			const allowedHere = permit(tool);
			if (!allowedHere(url)) throw new FetchToolError("url_not_allowed", `${url.host}${url.pathname} is outside the tool's domains`);
			let got;
			try {
				got = await fetchUrl(url.href, { ...set, types: TYPES, permit: allowedHere, signal }, set.deps);
			} catch (cause) {
				throw failed(cause);
			}
			const { text, title } = await read(got, { maxPages: set.maxPages, maxBytes: set.maxBytes });
			const limit =
				Number.isInteger(tool.max_content_tokens) && tool.max_content_tokens > 0 ? tool.max_content_tokens * CHARS_PER_TOKEN : Infinity;
			return {
				content: {
					type: "web_fetch_result",
					url: got.url,
					retrieved_at: new Date().toISOString(),
					content: {
						type: "document",
						source: { type: "text", media_type: "text/plain", data: text.length > limit ? text.slice(0, limit) : text },
						...(title === null ? {} : { title }),
						...(tool.citations?.enabled === true ? { citations: { enabled: true } } : {})
					}
				}
			};
		}
	};
}

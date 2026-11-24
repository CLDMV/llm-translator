/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/document-urls.mjs
 *	@Date: 2026-11-19T12:00:00-08:00 (1795118400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-19T12:00:00-08:00 (1795118400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The `documentUrls` setting and the step that fetches the `url` sources of `document` blocks before conversion. The fetch happens in the
 * root api (`request`), never in a converter: conversion stays free of I/O, and this step hands it ordinary base64 sources.
 * @module @cldmv/llm-translator/lib/document-urls
 */
import { TranslatorError } from "./errors.mjs";
import { fetchUrl, FetchError } from "./fetch-url.mjs";

/** Defaults of the fields of `documentUrls` other than `allow`. */
export const DEFAULTS = Object.freeze({
	maxBytes: 32 * 1024 * 1024,
	timeout: 30_000,
	maxRedirects: 3,
	maxDocuments: 10,
	allowPrivate: false
});

const KEYS = ["allow", "maxBytes", "timeout", "maxRedirects", "maxDocuments", "allowPrivate"];

/**
 * The error for a bad `documentUrls` value.
 * @param {string} problem - What is wrong.
 * @param {any} value - The setting.
 * @returns {TranslatorError} Error with code `invalid_setting`.
 */
function invalid(problem, value) {
	return new TranslatorError(`Invalid setting documentUrls: ${JSON.stringify(value)} (${problem})`, {
		code: "invalid_setting",
		status: 500,
		details: { key: "documentUrls" }
	});
}

/**
 * Validate the `documentUrls` setting and fill in its defaults.
 * @param {any} value - `null` or `false` (fetching is off), or `{ allow, maxBytes?, timeout?, maxRedirects?, maxDocuments?, allowPrivate? }`.
 * @returns {{allow: string[], maxBytes: number, timeout: number, maxRedirects: number, maxDocuments: number, allowPrivate: boolean} | null} The complete setting, or null when fetching is off.
 * @throws {TranslatorError} With code `invalid_setting` for anything else, including an empty or missing `allow`.
 */
export function normalize(value) {
	if (value === null || value === undefined || value === false) return null;
	if (typeof value !== "object" || Array.isArray(value)) throw invalid("expected null or an object", value);
	const unknown = Object.keys(value).filter((key) => !KEYS.includes(key));
	if (unknown.length > 0) throw invalid(`unknown ${unknown.length > 1 ? "keys" : "key"} ${unknown.join(", ")}`, value);
	const { allow } = value;
	if (!Array.isArray(allow) || allow.length === 0 || !allow.every((entry) => typeof entry === "string" && entry.trim() !== "")) {
		throw invalid('allow must be a non-empty list of host names such as "files.example.com" or "*.example.com"', value);
	}
	const out = { ...DEFAULTS, ...value, allow: allow.map((entry) => entry.trim().toLowerCase()) };
	for (const key of ["maxBytes", "timeout"]) {
		if (!Number.isInteger(out[key]) || out[key] <= 0) throw invalid(`${key} must be a positive integer`, value);
	}
	for (const key of ["maxRedirects", "maxDocuments"]) {
		if (!Number.isInteger(out[key]) || out[key] < 0) throw invalid(`${key} must be an integer of 0 or more`, value);
	}
	if (typeof out.allowPrivate !== "boolean") throw invalid("allowPrivate must be true or false", value);
	return out;
}

/**
 * A URL without its query and fragment, which can carry a signature or a token, for notes and events.
 * @param {string} url - URL.
 * @returns {string} Origin and path, or a placeholder for text that is not a URL.
 */
export function display(url) {
	if (typeof url !== "string" || !URL.canParse(url)) return "(invalid URL)";
	const parsed = new URL(url);
	return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
}

/**
 * Whether a request needs this step: fetching is on, and nothing overrides or switches off document conversion.
 * @param {any} settings - Resolved settings.
 * @returns {boolean} True when `url` documents should be fetched.
 */
export function wanted(settings) {
	return settings.documentUrls !== null && settings.documents === "extract" && !settings.documentConverter;
}

/**
 * Replace the `url` source of each `document` block (also inside `tool_result` content) with the fetched bytes as a `base64` source, which the
 * ordinary document conversion then reads. A document that could not be fetched gets a `fetch_failed` source carrying a reason that is safe for the
 * client, and the conversion turns it into a note; the request itself goes on. The same URL is fetched once per call, and no more than `maxDocuments`
 * different URLs are fetched (the rest fail with that reason). Nothing is cached between calls. The body is not changed: a copy is returned when
 * anything was replaced.
 * @param {any} body - Anthropic Messages request body.
 * @param {{options: any, report: (event: {kind: string, message: string, [detail: string]: any}) => void, signal?: AbortSignal, fetch?: Function, deps?: any}} spec - The normalized `documentUrls` setting, a function that receives one event per fetch, the caller's abort signal, and replaceable parts for tests (`fetch`, and the `deps` given to it).
 * @returns {Promise<any>} The body.
 */
export async function resolve(body, { options, report, signal, fetch = fetchUrl, deps }) {
	if (!Array.isArray(body?.messages)) return body;
	const results = new Map();
	const get = (url) => {
		if (!results.has(url)) results.set(url, one(url));
		return results.get(url);
	};
	const one = async (url) => {
		if (results.size >= options.maxDocuments) {
			report({
				kind: "fetch",
				level: "warn",
				message: `Document ${display(url)} was not fetched: more than ${options.maxDocuments} URL documents in one request`,
				url: display(url),
				reason: "limit"
			});
			return {
				source: {
					type: "fetch_failed",
					url: display(url),
					reason: `no more than ${options.maxDocuments} documents are fetched per request`
				}
			};
		}
		try {
			const got = await fetch(url, { ...options, signal }, deps);
			report({
				kind: "fetched",
				level: "debug",
				message: `Fetched document ${display(url)} (${got.bytes.length} bytes, ${got.mediaType})`,
				url: display(url),
				bytes: got.bytes.length,
				mediaType: got.mediaType
			});
			return { source: { type: "base64", media_type: got.mediaType, data: got.bytes.toString("base64") } };
		} catch (cause) {
			const failure =
				cause instanceof FetchError ? cause : new FetchError("network", "the connection failed", String(cause?.message ?? cause));
			report({
				kind: "fetch",
				level: "warn",
				message: `Document ${display(url)} was not fetched: ${failure.detail}`,
				url: display(url),
				reason: failure.kind
			});
			return { source: { type: "fetch_failed", url: display(url), reason: failure.message } };
		}
	};
	/**
	 * Fetch the documents of a list of blocks.
	 * @param {any[]} list - Content blocks.
	 * @returns {Promise<any[]>} The blocks, with fetched sources; the same array when nothing changed.
	 */
	const blocks = async (list) => {
		let changed = false;
		const out = [];
		for (const block of list) {
			let next = block;
			if (block?.type === "document" && block.source?.type === "url") {
				next = { ...block, source: (await get(block.source.url)).source };
			} else if (block?.type === "tool_result" && Array.isArray(block.content)) {
				const inner = await blocks(block.content);
				if (inner !== block.content) next = { ...block, content: inner };
			}
			if (next !== block) changed = true;
			out.push(next);
		}
		return changed ? out : list;
	};
	let changed = false;
	const messages = [];
	for (const message of body.messages) {
		const content = Array.isArray(message?.content) ? await blocks(message.content) : message?.content;
		if (content !== message?.content) {
			changed = true;
			messages.push({ ...message, content });
		} else messages.push(message);
	}
	return changed ? { ...body, messages } : body;
}

/**
 * The text an unreadable URL document becomes, worded like the note a `document` block gets (`lib/documents`).
 * @param {string} name - Name of the document.
 * @param {string} reason - Why it cannot be read.
 * @returns {{ type: "text", text: string }} Text part.
 */
function note(name, reason) {
	return { type: "text", text: `[The document "${name}" could not be read by this model. ${reason.replace(/\.$/, "")}.]` };
}

/**
 * Resolve the `file_url` of OpenAI `file` parts (a Responses `input_file` by URL), the way `resolve` does for a `document` block with a `url` source:
 * the same fetch with the same allow-list, size, redirect and count limits, and the same events. A fetched file becomes a `file` part with `file_data`
 * (a data URL) and the file name, which the ordinary file handling then reads. With fetching off (`options` null) the part becomes a text note, as
 * a URL document does on a converting route; a failed fetch becomes a note with the reason. Parts without a `file_url`, and parts that also carry a
 * `file_id` or `file_data`, are left alone. A copy is returned when anything changed.
 * @param {any} body - OpenAI Chat Completions request body.
 * @param {{options: any, report: (event: {kind: string, message: string, [detail: string]: any}) => void, signal?: AbortSignal, fetch?: Function, deps?: any}} spec - As for `resolve`; `options` is the normalized `documentUrls` setting, or null when URL fetching is off.
 * @returns {Promise<any>} The body.
 */
export async function resolveFileParts(body, { options, report, signal, fetch, deps }) {
	if (!Array.isArray(body?.messages)) return body;
	const wanted = (part) =>
		part?.type === "file" &&
		typeof part.file?.file_url === "string" &&
		part.file.file_id === undefined &&
		part.file.file_data === undefined;
	const found = body.messages.flatMap((message) => (Array.isArray(message?.content) ? message.content.filter(wanted) : []));
	if (found.length === 0) return body;
	// The fetch step reads `document` blocks, so the parts are handed to it as such, one block each, in order.
	const fetched =
		options === null
			? null
			: (
					await resolve(
						{
							messages: [
								{ role: "user", content: found.map((part) => ({ type: "document", source: { type: "url", url: part.file.file_url } })) }
							]
						},
						{ options, report, signal, fetch, deps }
					)
				).messages[0].content;
	let at = 0;
	const messages = body.messages.map((message) => {
		if (!Array.isArray(message?.content)) return message;
		const content = message.content.map((part) => {
			if (!wanted(part)) return part;
			const source = fetched?.[at++].source;
			const name = part.file.filename ?? display(part.file.file_url);
			if (source === undefined) return note(name, "documents referenced by URL cannot be fetched by the translator");
			if (source.type === "fetch_failed") return note(name, `the document at ${source.url} could not be fetched: ${source.reason}`);
			const { file_url: _, ...rest } = part.file;
			return {
				...part,
				file: { ...rest, file_data: `data:${source.media_type};base64,${source.data}`, filename: part.file.filename ?? name }
			};
		});
		return { ...message, content };
	});
	return { ...body, messages };
}

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/gemini-cache.mjs
 *	@Date: 2026-11-22T10:00:00-08:00 (1795370400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T10:00:00-08:00 (1795370400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Cached contents for Gemini: an Anthropic `cache_control` breakpoint makes the conversation up to it a `cachedContents` resource (created once, reused until it expires), and the request that follows carries only what comes after it.
 * @module @cldmv/llm-translator/lib/gemini-cache
 */
import { createHash } from "node:crypto";
import * as http from "./http.mjs";

/** How long, in seconds, a cached content lives for a `cache_control` of each `ttl`, and the margin kept before it expires. */
const TTL = { "5m": 300, "1h": 3600 };
const DEFAULT_TTL = 300;
const MARGIN = 30;

/** How long a prefix that could not be cached (too short for the model, or refused) is not tried again, in milliseconds. */
const RETRY = 10 * 60 * 1000;

/** Prefixes shorter than this many characters are not worth a call: Gemini's smallest cache is 1024 tokens or more. */
const MIN_CHARACTERS = 4000;

/**
 * The last `cache_control` breakpoint of an Anthropic request, in the order Anthropic reads it: tools, system, messages.
 * @param {any} body - Anthropic Messages body.
 * @returns {{where: "tools" | "system" | "messages", message?: number, block?: number, ttl: number} | null} Where it is and how long the cache lives, or null when there is none.
 */
export function breakpoint(body) {
	/** @type {any} */
	let found = null;
	const ttlOf = (control) => TTL[control?.ttl] ?? DEFAULT_TTL;
	for (const tool of Array.isArray(body?.tools) ? body.tools : []) {
		if (tool?.cache_control) found = { where: "tools", ttl: ttlOf(tool.cache_control) };
	}
	for (const block of Array.isArray(body?.system) ? body.system : []) {
		if (block?.cache_control) found = { where: "system", ttl: ttlOf(block.cache_control) };
	}
	const messages = Array.isArray(body?.messages) ? body.messages : [];
	messages.forEach((message, at) => {
		const blocks = Array.isArray(message?.content) ? message.content : [];
		blocks.forEach((block, index) => {
			if (block?.cache_control) found = { where: "messages", message: at, block: index, ttl: ttlOf(block.cache_control) };
		});
	});
	return found;
}

/**
 * The request as far as a breakpoint: every tool and every system block (a breakpoint in either counts as one after both), and the messages up to the block.
 * @param {any} body - Anthropic Messages body.
 * @param {{where: string, message?: number, block?: number}} point - The breakpoint.
 * @returns {any} The shortened body.
 */
export function upTo(body, point) {
	if (point.where !== "messages") return { ...body, messages: [] };
	const messages = body.messages.slice(0, (point.message ?? 0) + 1);
	const last = messages.at(-1);
	if (Array.isArray(last?.content)) messages[messages.length - 1] = { ...last, content: last.content.slice(0, (point.block ?? 0) + 1) };
	return { ...body, messages };
}

/**
 * What to cache, from the Gemini body of the shortened request and the one of the whole request: the leading messages the two share, whole, and
 * the system instruction, tools and tool config, which have to be the same in both because a request that uses a cache carries none of them.
 * @param {any} prefix - `generateContent` body of the shortened request.
 * @param {any} full - `generateContent` body of the whole request.
 * @param {number} ttl - Seconds the cache lives.
 * @returns {{contents: any[], count: number, systemInstruction?: any, tools?: any, toolConfig?: any, ttl: number} | null} The plan, or null when there is nothing worth caching or the two do not agree.
 */
export function planOf(prefix, full, ttl) {
	const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
	for (const field of ["systemInstruction", "tools", "toolConfig"]) if (!same(prefix[field], full[field])) return null;
	let count = 0;
	while (count < prefix.contents.length && count < full.contents.length && same(prefix.contents[count], full.contents[count])) count++;
	// A request must still carry something after the cache.
	if (count >= full.contents.length) return null;
	const out = { contents: prefix.contents.slice(0, count), count, ttl };
	for (const field of ["systemInstruction", "tools", "toolConfig"]) if (prefix[field] !== undefined) out[field] = prefix[field];
	if (JSON.stringify([out.contents, out.systemInstruction, out.tools]).length < MIN_CHARACTERS) return null;
	return out;
}

/**
 * Make the request use a cached content: find the one for this prefix or create it, then drop what the cache holds from the body. When the
 * cache cannot be made (too short for the model, refused, unreachable) the body is returned as it was and the prefix is not tried again for a while.
 * @param {{cache: any, body: any, endpoint: any, headers: Record<string, string>, transport: Function, timeout: number, model: string, url: string, resource: string, warn?: (message: string) => void}} spec - `cache` is the plan, `url` is the `cachedContents` collection to create in and `resource` the model's resource name for it, `model` is the model id (for the key).
 * @returns {Promise<any>} The body to send.
 */
export async function apply({ cache, body, endpoint, headers, transport, timeout, model, url, resource, warn }) {
	const key = createHash("sha256")
		.update(JSON.stringify([model, cache.systemInstruction, cache.tools, cache.toolConfig, cache.contents]))
		.digest("hex");
	const store = (endpoint.geminiCaches ??= new Map());
	const now = Date.now();
	let entry = store.get(key);
	if (entry === undefined || (entry.name === undefined && entry.retry <= now) || (entry.name !== undefined && entry.until <= now)) {
		const made = await http.json(transport, url, {
			method: "POST",
			headers: { ...headers, accept: "application/json", "content-type": "application/json" },
			body: {
				model: resource,
				contents: cache.contents,
				...(cache.systemInstruction === undefined ? {} : { systemInstruction: cache.systemInstruction }),
				...(cache.tools === undefined ? {} : { tools: cache.tools }),
				...(cache.toolConfig === undefined ? {} : { toolConfig: cache.toolConfig }),
				ttl: `${cache.ttl}s`
			},
			timeout
		});
		if (made.ok && typeof made.body?.name === "string") entry = { name: made.body.name, until: now + (cache.ttl - MARGIN) * 1000 };
		else {
			entry = { retry: now + RETRY };
			warn?.(
				`Upstream ${endpoint.name}: the conversation could not be cached (${made.ok ? "no name in the reply" : `HTTP ${made.status}`}); it is sent whole`
			);
		}
		store.set(key, entry);
	}
	if (entry.name === undefined) return body;
	const { systemInstruction: ___system, tools: ___tools, toolConfig: ___config, ...rest } = body;
	return { ...rest, contents: body.contents.slice(cache.count), cachedContent: entry.name };
}

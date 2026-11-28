/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/mcp.mjs
 *	@Date: 2026-11-28T12:00:00-08:00 (1795896000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-28T12:00:00-08:00 (1795896000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview A small MCP client for the `mcp` tool of the Responses API: Streamable HTTP, JSON-RPC 2.0, with `initialize`, `tools/list` and `tools/call`.
 *
 * The URL of an MCP server comes from the client of the translator, so the translator calls out to an address somebody else chose. This is off unless
 * `serverTools.mcp` names the hosts that may be called (see {@link normalize}), and every call is checked first:
 * - the URL is `http` or `https` with no credentials in it, and its host matches an entry of `hosts`: an exact host name or address, or `*.example.com`
 *   for any subdomain of it;
 * - the address the host resolves to (every address, when there are several) must be public: loopback, private, link-local, unique-local, carrier-grade,
 *   multicast and reserved ranges are refused, unless the host is named exactly in `hosts` (a wildcard entry does not lift this, so a name under an
 *   allowed domain cannot be pointed at the inside network);
 * - redirects are never followed, and a reply is read only up to `maxResponse` bytes.
 * The name is resolved for the check and again by `fetch` when it connects; a name whose address changes in between is not caught (see
 * `docs/known-limitations.md`). Credentials (`authorization`, `headers`) go only to that server and are never put in an error message or an event.
 * @module @cldmv/llm-translator/lib/mcp
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { TranslatorError } from "./errors.mjs";

/** The protocol revision this client asks for. A server may answer with another one it supports; its choice is sent back in `MCP-Protocol-Version`. */
export const PROTOCOL_VERSION = "2025-06-18";

/** Default time limit of one HTTP call, in ms. */
const TIMEOUT = 30000;

/** Default most bytes read from one reply. */
const MAX_RESPONSE = 4 * 1024 * 1024;

/** Most pages of `tools/list` that are followed. */
const MAX_PAGES = 20;

/**
 * Validate the `mcp` part of `serverTools`.
 * @param {any} value - `undefined`, or `{ hosts, timeout?, maxResponse?, fetch?, lookup? }`.
 * @returns {{hosts: string[], timeout: number, maxResponse: number, fetch: Function, lookup: Function} | undefined} The normalized setting, or undefined when MCP is off.
 * @throws {TranslatorError} `INVALID_CONFIG` for hosts that are not a non-empty list of names, or a limit that is not a positive whole number.
 */
export function normalize(value) {
	if (value === undefined || value === null) return undefined;
	const bad = (message) => new TranslatorError(`serverTools.mcp: ${message}`, { code: "INVALID_CONFIG", status: 500 });
	if (typeof value !== "object" || Array.isArray(value)) throw bad("must be an object");
	const { hosts, timeout = TIMEOUT, maxResponse = MAX_RESPONSE, fetch = globalThis.fetch, lookup = dnsLookup } = value;
	if (
		!Array.isArray(hosts) ||
		hosts.length === 0 ||
		hosts.some((host) => typeof host !== "string" || host.trim() === "" || /[\s/@]/.test(host.trim()))
	) {
		throw bad("hosts must be a non-empty list of host names or addresses (a name, or *.example.com)");
	}
	if (!Number.isInteger(timeout) || timeout < 1) throw bad("timeout must be a positive whole number");
	if (!Number.isInteger(maxResponse) || maxResponse < 1) throw bad("maxResponse must be a positive whole number");
	if (typeof fetch !== "function") throw bad("fetch must be a function");
	if (typeof lookup !== "function") throw bad("lookup must be a function");
	return {
		hosts: hosts.map((host) =>
			host
				.trim()
				.toLowerCase()
				.replace(/^\[|\]$/g, "")
		),
		timeout,
		maxResponse,
		fetch,
		lookup
	};
}

/**
 * Whether an address is not a public one: loopback, private, link-local, unique-local, carrier-grade NAT, multicast, reserved or unspecified.
 * @param {string} address - An IPv4 or IPv6 address (an IPv4-mapped IPv6 address counts as the IPv4 one).
 * @returns {boolean} True for an address that must not be reached unless its host is named in the allowlist.
 */
export function isInternal(address) {
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
	const text = mapped === null ? address : mapped[1];
	if (isIP(text) === 4) {
		const [a, b, c] = text.split(".").map(Number);
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 100 && b >= 64 && b <= 127) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 0 && c === 0) ||
			(a === 192 && b === 168) ||
			(a === 198 && (b === 18 || b === 19)) ||
			a >= 224
		);
	}
	const lower = text.toLowerCase();
	return (
		lower === "::" ||
		lower === "::1" ||
		/^f[cd]/.test(lower) ||
		/^fe[89ab]/.test(lower) ||
		/^ff/.test(lower) ||
		/^::ffff:/.test(lower) ||
		/^64:ff9b:/.test(lower) ||
		/^2001:(0)?:/.test(lower) ||
		/^2001:db8:/.test(lower)
	);
}

/**
 * Check that a server URL may be called and say which host rule let it through.
 * @param {string} url - The `server_url`.
 * @param {{hosts: string[]}} setting - The normalized `serverTools.mcp`.
 * @returns {{url: URL, host: string, exact: boolean}} The parsed URL, its host and whether the host is named exactly (not through a wildcard).
 * @throws {TranslatorError} `unsupported_tool` (status 400) for a URL that is not `http(s)`, has credentials, or whose host is not allowed.
 */
export function allowed(url, setting) {
	const refuse = (why) => new TranslatorError(`the MCP server URL is not allowed: ${why}`, { code: "unsupported_tool" });
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		throw refuse("it is not a URL");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw refuse("only http and https are called");
	if (parsed.username !== "" || parsed.password !== "") throw refuse("it carries credentials");
	const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
	const exact = setting.hosts.includes(host);
	const wildcard = setting.hosts.some((entry) => entry.startsWith("*.") && host.endsWith(entry.slice(1)));
	if (!exact && !wildcard) throw refuse(`${host} is not in the serverTools.mcp hosts list`);
	return { url: parsed, host, exact };
}

/**
 * Check where a host resolves to.
 * @param {{host: string, exact: boolean}} where - Result of {@link allowed}.
 * @param {{lookup: Function}} setting - The normalized `serverTools.mcp`.
 * @returns {Promise<void>} Resolves when every address may be called.
 * @throws {TranslatorError} `unsupported_tool` for an internal address of a host that is not named exactly, or a host that does not resolve.
 */
async function reachable({ host, exact }, setting) {
	let addresses;
	if (isIP(host) !== 0) addresses = [host];
	else {
		try {
			addresses = (await setting.lookup(host, { all: true })).map((entry) => entry.address);
		} catch {
			throw new TranslatorError(`the MCP server host ${host} does not resolve`, { code: "unsupported_tool" });
		}
	}
	if (!exact && addresses.some(isInternal)) {
		throw new TranslatorError(
			`the MCP server host ${host} resolves to a private or loopback address, which only a host named exactly in serverTools.mcp may use`,
			{
				code: "unsupported_tool"
			}
		);
	}
}

/**
 * Read a reply body up to a limit.
 * @param {Response} response - The reply.
 * @param {number} limit - Most bytes.
 * @returns {Promise<string>} The text.
 * @throws {Error} When the body is longer than the limit.
 */
async function read(response, limit) {
	const parts = [];
	let size = 0;
	if (response.body === null) return "";
	for await (const part of response.body) {
		size += part.length;
		if (size > limit) throw new Error(`the reply is longer than ${limit} bytes`);
		parts.push(part);
	}
	return Buffer.concat(parts).toString("utf8");
}

/**
 * The JSON-RPC reply with a given id in a reply body, which is JSON or a Server-Sent Events stream of JSON-RPC messages.
 * @param {string} text - The body.
 * @param {string} type - Its `content-type`.
 * @param {number} id - The request id.
 * @returns {any} The message.
 * @throws {Error} When there is none.
 */
function answer(text, type, id) {
	const messages = [];
	if (type.includes("text/event-stream")) {
		for (const block of text.split(/\r?\n\r?\n/)) {
			const data = block
				.split(/\r?\n/)
				.filter((line) => line.startsWith("data:"))
				.map((line) => line.slice(5).trimStart())
				.join("\n");
			if (data !== "") messages.push(JSON.parse(data));
		}
	} else messages.push(...[JSON.parse(text)].flat());
	const found = messages.find((message) => message?.id === id);
	if (found === undefined) throw new Error("the server sent no reply to the request");
	return found;
}

/**
 * Connect to an MCP server. Nothing is sent until `initialize` is called.
 * @param {object} spec - The server as the request names it.
 * @param {string} spec.url - `server_url`.
 * @param {Record<string, string>} [spec.headers] - Extra headers (`headers`).
 * @param {string} [spec.authorization] - An OAuth access token (`authorization`), sent as a bearer token.
 * @param {{hosts: string[], timeout: number, maxResponse: number, fetch: Function, lookup: Function}} setting - The normalized `serverTools.mcp`.
 * @param {AbortSignal} [signal] - Aborts the calls.
 * @returns {{ initialize: () => Promise<void>, list: () => Promise<any[]>, call: (name: string, args: any) => Promise<{text: string, error: boolean}>, close: () => Promise<void> }} The client.
 * @throws {TranslatorError} `unsupported_tool` when the URL may not be called.
 */
export function connect({ url, headers = {}, authorization }, setting, signal) {
	const where = allowed(url, setting);
	const base = {
		"content-type": "application/json",
		accept: "application/json, text/event-stream",
		...headers,
		...(typeof authorization === "string" &&
		authorization !== "" &&
		headers.authorization === undefined &&
		headers.Authorization === undefined
			? { authorization: /^\S+\s+\S/.test(authorization) ? authorization : `Bearer ${authorization}` }
			: {})
	};
	let session;
	let version;
	let counter = 0;
	/**
	 * Send one JSON-RPC message.
	 * @param {any} message - The message.
	 * @returns {Promise<{body: any, response: Response}>} The reply message (null for a notification) and the HTTP reply.
	 */
	const post = async (message) => {
		await reachable(where, setting);
		const limit = AbortSignal.timeout(setting.timeout);
		const response = await setting.fetch(where.url, {
			method: "POST",
			redirect: "error",
			headers: { ...base, ...(session ? { "mcp-session-id": session } : {}), ...(version ? { "mcp-protocol-version": version } : {}) },
			body: JSON.stringify(message),
			signal: signal ? AbortSignal.any([signal, limit]) : limit
		});
		if (!response.ok) throw new Error(`the server answered HTTP ${response.status}`);
		if (message.id === undefined) {
			await response.body?.cancel();
			return { body: null, response };
		}
		return { body: answer(await read(response, setting.maxResponse), response.headers.get("content-type") ?? "", message.id), response };
	};
	/**
	 * Call a JSON-RPC method.
	 * @param {string} method - The method.
	 * @param {any} params - Its parameters.
	 * @returns {Promise<any>} The `result`.
	 */
	const rpc = async (method, params) => {
		const id = ++counter;
		const { body, response } = await post({ jsonrpc: "2.0", id, method, params });
		if (method === "initialize") session = response.headers.get("mcp-session-id") ?? undefined;
		if (body.error !== undefined) throw new Error(`${method}: ${body.error?.message ?? "the server answered with an error"}`);
		return body.result;
	};
	return {
		async initialize() {
			const result = await rpc("initialize", {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: "llm-translator", version: "1.0.0" }
			});
			version = typeof result?.protocolVersion === "string" ? result.protocolVersion : PROTOCOL_VERSION;
			await post({ jsonrpc: "2.0", method: "notifications/initialized" });
		},
		async list() {
			const tools = [];
			let cursor;
			for (let page = 0; page < MAX_PAGES; page++) {
				const result = await rpc("tools/list", cursor === undefined ? {} : { cursor });
				tools.push(...(Array.isArray(result?.tools) ? result.tools : []));
				cursor = result?.nextCursor;
				if (typeof cursor !== "string" || cursor === "") break;
			}
			return tools;
		},
		async call(name, args) {
			const result = await rpc("tools/call", { name, arguments: args });
			const parts = (Array.isArray(result?.content) ? result.content : []).map((part) =>
				part?.type === "text" ? String(part.text ?? "") : JSON.stringify(part)
			);
			if (parts.length === 0 && result?.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent));
			return { text: parts.join("\n"), error: result?.isError === true };
		},
		async close() {
			if (session === undefined) return;
			try {
				const response = await setting.fetch(where.url, {
					method: "DELETE",
					redirect: "error",
					headers: { ...base, "mcp-session-id": session, ...(version ? { "mcp-protocol-version": version } : {}) },
					signal: AbortSignal.timeout(setting.timeout)
				});
				await response.body?.cancel();
			} catch {
				// A server that does not end sessions, or is gone, has nothing to be told.
			}
		}
	};
}

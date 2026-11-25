/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/fetch-url.mjs
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
 * @fileoverview Fetches one document by URL for the `documentUrls` setting, with the protections a server-side fetch of a client-supplied URL needs:
 * an allow-list of hosts, address checks on every address the host resolves to (no loopback, private, link-local, CGNAT, unique-local, multicast,
 * reserved or unspecified ranges, including their IPv4-mapped IPv6 forms), a connection pinned to the address that was checked, a re-check of every
 * redirect hop, a refused https-to-http downgrade, and a size limit that is enforced while the body streams and a time limit for the whole fetch.
 * It uses `node:dns`, `node:http`, `node:https` and `node:net` only.
 * @module @cldmv/llm-translator/lib/fetch-url
 */
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

/** Content types a fetched document may have, and the media type each is stored as. */
const TYPES = new Map([
	["application/pdf", "application/pdf"],
	["text/plain", "text/plain"]
]);

/** Redirect statuses that are followed. */
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Address ranges that are never fetched unless `allowPrivate` is set: `[class, family, network, prefix length]`. */
/** @type {[string, "ipv4" | "ipv6", string, number][]} */
const RANGES = [
	["unspecified", "ipv4", "0.0.0.0", 8],
	["private", "ipv4", "10.0.0.0", 8],
	["cgnat", "ipv4", "100.64.0.0", 10],
	["loopback", "ipv4", "127.0.0.0", 8],
	["link-local", "ipv4", "169.254.0.0", 16],
	["private", "ipv4", "172.16.0.0", 12],
	["reserved", "ipv4", "192.0.0.0", 24],
	["reserved", "ipv4", "192.0.2.0", 24],
	["reserved", "ipv4", "192.88.99.0", 24],
	["private", "ipv4", "192.168.0.0", 16],
	["reserved", "ipv4", "198.18.0.0", 15],
	["reserved", "ipv4", "198.51.100.0", 24],
	["reserved", "ipv4", "203.0.113.0", 24],
	["multicast", "ipv4", "224.0.0.0", 4],
	["reserved", "ipv4", "240.0.0.0", 4],
	["unspecified", "ipv6", "::", 128],
	["loopback", "ipv6", "::1", 128],
	["reserved", "ipv6", "::", 96],
	["mapped", "ipv6", "::ffff:0:0", 96],
	["reserved", "ipv6", "64:ff9b::", 96],
	["reserved", "ipv6", "64:ff9b:1::", 48],
	["reserved", "ipv6", "100::", 64],
	["reserved", "ipv6", "2001::", 23],
	["reserved", "ipv6", "2001:db8::", 32],
	["reserved", "ipv6", "2002::", 16],
	["unique-local", "ipv6", "fc00::", 7],
	["link-local", "ipv6", "fe80::", 10],
	["link-local", "ipv6", "fec0::", 10],
	["multicast", "ipv6", "ff00::", 8]
];

const LISTS = RANGES.map(([name, family, network, bits]) => {
	const list = new net.BlockList();
	list.addSubnet(network, bits, family);
	return { name, family, list };
});

/**
 * Why a fetch failed. `message` is safe to show the client; `detail` is for the server's own log and may name addresses and system errors.
 */
export class FetchError extends Error {
	/**
	 * @param {string} kind - `scheme`, `allow`, `dns`, `address`, `network`, `redirects`, `downgrade`, `status`, `size`, `type`, `encoding` or `timeout`.
	 * @param {string} message - What to tell the client.
	 * @param {string} [detail] - What to log.
	 * @param {number} [status] - The HTTP status of a `status` failure.
	 */
	constructor(kind, message, detail = message, status = undefined) {
		super(message);
		this.name = "FetchError";
		this.kind = kind;
		this.detail = detail;
		this.status = status;
	}
}

/**
 * The address a mapped IPv6 address stands for.
 * @param {string} address - Canonical IPv6 address (as `new URL` writes it).
 * @returns {string | null} The IPv4 address, or null when it is not an IPv4-mapped address.
 */
function unmap(address) {
	const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
	if (hex === null) return null;
	const high = Number.parseInt(hex[1], 16);
	const low = Number.parseInt(hex[2], 16);
	return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
}

/**
 * The class of range an IP address is in.
 * @param {string} address - IPv4 or IPv6 address (a zone id is ignored).
 * @returns {string | null} `loopback`, `private`, `link-local`, `cgnat`, `unique-local`, `multicast`, `unspecified`, `reserved` or `mapped`; null for a public address; `invalid` when it is not an address.
 */
export function classify(address) {
	const bare = address.replace(/%.*$/, "");
	const family = net.isIP(bare);
	if (family === 0) return "invalid";
	// `new URL` writes an IPv6 address in one canonical form (lower case, compressed, mapped addresses as two hex groups).
	const canonical = family === 6 ? new URL(`http://[${bare}]`).hostname.slice(1, -1) : bare;
	const mapped = family === 6 ? unmap(canonical) : null;
	if (mapped !== null) return classify(mapped) ?? "mapped";
	const label = family === 4 ? "ipv4" : "ipv6";
	return LISTS.find((entry) => entry.family === label && entry.list.check(canonical, label))?.name ?? null;
}

/**
 * Whether a host name matches an allow-list pattern: an exact host name, `*.example.com` (any subdomain, not `example.com` itself) or `*` (any host).
 * @param {string} host - Lower-case host name without a trailing dot.
 * @param {string[]} patterns - Allow-list.
 * @returns {boolean} True when one pattern matches.
 */
export function allowed(host, patterns) {
	return patterns.some((pattern) => {
		const rule = pattern.toLowerCase();
		if (rule === "*") return true;
		return rule.startsWith("*.") ? host.endsWith(rule.slice(1)) && host.length > rule.length - 1 : host === rule;
	});
}

/**
 * Resolve a host name to every address it has, the way the connection will.
 * @param {string} host - Host name.
 * @returns {Promise<{address: string, family: number}[]>} Addresses.
 */
export function lookup(host) {
	return dns.lookup(host, { all: true, verbatim: true });
}

/**
 * Check a URL against the rules and resolve it to the address to connect to.
 * @param {URL} url - The URL of this hop.
 * @param {any} options - `{ allow, allowPrivate }`.
 * @param {(host: string) => Promise<{address: string, family: number}[]>} resolver - Host name lookup.
 * @returns {Promise<{address: string, family: number}>} The checked address.
 * @throws {FetchError} For a scheme, credentials, allow-list or address problem.
 */
async function vet(url, options, resolver) {
	if (url.protocol !== "http:" && url.protocol !== "https:")
		throw new FetchError("scheme", "only http and https URLs are fetched", `scheme ${url.protocol}`);
	if (url.username !== "" || url.password !== "") throw new FetchError("scheme", "URLs with credentials are refused");
	const bracketed = url.hostname.startsWith("[");
	const host = (bracketed ? url.hostname.slice(1, -1) : url.hostname).toLowerCase().replace(/\.$/, "");
	if (host === "" || !allowed(host, options.allow)) throw new FetchError("allow", "the host is not on the allow list", `host ${host}`);
	// An extra rule of the caller (the domain fields of a web fetch tool), checked on every hop like the allow list.
	if (options.permit !== undefined && !options.permit(url))
		throw new FetchError("allow", "the URL is not allowed", `url ${url.host}${url.pathname}`);
	let addresses;
	if (net.isIP(host) !== 0) addresses = [{ address: host, family: net.isIP(host) }];
	else {
		try {
			addresses = await resolver(host);
		} catch (cause) {
			throw new FetchError("dns", "the host name could not be resolved", `lookup of ${host}: ${cause.code ?? cause.message}`);
		}
	}
	if (!Array.isArray(addresses) || addresses.length === 0)
		throw new FetchError("dns", "the host name could not be resolved", `lookup of ${host}: no addresses`);
	if (options.allowPrivate !== true) {
		// Every address counts: a name with one public and one private address would let a retry pick the private one.
		const bad = addresses.find((entry) => classify(entry.address) !== null);
		if (bad !== undefined) {
			throw new FetchError(
				"address",
				"the host resolves to an address that is not allowed",
				`${host} resolves to ${bad.address} (${classify(bad.address)})`
			);
		}
	}
	return addresses[0];
}

/**
 * Send one GET and resolve at the response headers. The connection goes to `target`, the address that was checked, whatever the name resolves to
 * later; the URL keeps its host name for the Host header and the TLS server name.
 * @param {URL} url - The URL of this hop.
 * @param {{address: string, family: number}} target - Checked address.
 * @param {AbortSignal} signal - Aborts the request.
 * @param {{http: any, https: any}} modules - Protocol modules.
 * @param {string} accept - The `accept` header.
 * @returns {Promise<import("node:http").IncomingMessage>} The response.
 */
function get(url, target, signal, modules, accept) {
	return new Promise((resolve, reject) => {
		const client = url.protocol === "https:" ? modules.https : modules.http;
		const pinned = (_host, query, done) =>
			query?.all ? done(null, [{ address: target.address, family: target.family }]) : done(null, target.address, target.family);
		const request = client.request(
			url,
			{ method: "GET", agent: false, lookup: pinned, headers: { accept, "accept-encoding": "identity" } },
			resolve
		);
		const stop = () => request.destroy(signal.reason);
		signal.addEventListener("abort", stop, { once: true });
		request.once("close", () => signal.removeEventListener("abort", stop));
		request.on("error", reject);
		request.end();
	});
}

/**
 * Read a response body, stopping as soon as it is larger than the limit.
 * @param {import("node:http").IncomingMessage} res - Response.
 * @param {number} maxBytes - Limit.
 * @returns {Promise<Buffer>} Body.
 * @throws {FetchError} When the body is too large.
 */
async function read(res, maxBytes) {
	const chunks = [];
	let total = 0;
	for await (const chunk of res) {
		total += chunk.length;
		if (total > maxBytes) {
			res.destroy();
			throw new FetchError("size", `the document is larger than ${maxBytes} bytes`, `body passed ${maxBytes} bytes`);
		}
		chunks.push(chunk);
	}
	return Buffer.concat(chunks);
}

/**
 * Fetch a document.
 * @param {string} input - The URL.
 * @param {{allow: string[], maxBytes: number, timeout: number, maxRedirects: number, allowPrivate?: boolean, signal?: AbortSignal, types?: Map<string, string>, permit?: (url: URL) => boolean}} options - Limits and rules (see the `documentUrls` setting); `types` replaces the content types that are accepted (content type to the media type it is stored as) and `permit` is an extra check of every URL, each redirect hop included.
 * @param {{lookup?: (host: string) => Promise<{address: string, family: number}[]>, modules?: {http: any, https: any}}} [deps] - Host name lookup and protocol modules (replaceable for tests).
 * @returns {Promise<{bytes: Buffer, mediaType: string, url: string}>} The body, its media type (`application/pdf` and `text/plain` unless `types` says otherwise) and the final URL.
 * @throws {FetchError} For anything that stops the fetch; never any other error.
 */
export async function fetchUrl(input, options, deps = {}) {
	const resolver = deps.lookup ?? lookup;
	const modules = deps.modules ?? { http, https };
	const abort = new AbortController();
	const timer = setTimeout(
		() => abort.abort(new FetchError("timeout", `the download did not finish within ${options.timeout} ms`)),
		options.timeout
	);
	const relay = () => abort.abort(options.signal.reason);
	options.signal?.addEventListener("abort", relay, { once: true });
	// Rejects when the fetch is aborted, so a step that does not watch the signal (the name lookup) cannot outlast it.
	const stopped = new Promise((_resolve, reject) => {
		abort.signal.addEventListener("abort", () => reject(abort.signal.reason), { once: true });
	});
	stopped.catch(() => {});
	try {
		return await Promise.race([stopped, run(input, options, resolver, modules, abort.signal)]);
	} catch (cause) {
		if (cause instanceof FetchError) throw cause;
		if (abort.signal.aborted) {
			// A timeout reaches here as a FetchError above; what is left is the caller's own abort.
			const reason = abort.signal.reason;
			throw new FetchError("network", "the download was cancelled", String(reason?.message ?? reason));
		}
		throw new FetchError("network", "the connection failed", String(cause?.code ?? cause?.message ?? cause));
	} finally {
		clearTimeout(timer);
		options.signal?.removeEventListener("abort", relay);
		abort.abort(new FetchError("network", "the download was cancelled"));
	}
}

/**
 * The redirect loop and the response checks.
 * @param {string} input - The URL.
 * @param {any} options - See `fetchUrl`.
 * @param {(host: string) => Promise<{address: string, family: number}[]>} resolver - Host name lookup.
 * @param {{http: any, https: any}} modules - Protocol modules.
 * @param {AbortSignal} signal - Aborts the fetch.
 * @returns {Promise<{bytes: Buffer, mediaType: string, url: string}>} Result.
 */
async function run(input, options, resolver, modules, signal) {
	const types = options.types ?? TYPES;
	const names = [...types.keys()];
	const accept = names.join(", ");
	let url;
	try {
		url = new URL(input);
	} catch {
		throw new FetchError("scheme", "the URL is not valid", "URL does not parse");
	}
	for (let hops = 0; ; hops++) {
		const target = await vet(url, options, resolver);
		const res = await get(url, target, signal, modules, accept);
		const status = res.statusCode;
		const location = res.headers.location;
		if (REDIRECTS.has(status) && typeof location === "string") {
			res.resume();
			if (hops >= options.maxRedirects)
				throw new FetchError("redirects", "too many redirects", `more than ${options.maxRedirects} redirects`);
			let next;
			try {
				next = new URL(location, url);
			} catch {
				throw new FetchError("status", `the server answered HTTP ${status} with an invalid location`);
			}
			if (url.protocol === "https:" && next.protocol === "http:")
				throw new FetchError("downgrade", "a redirect from https to http was refused");
			url = next;
			continue;
		}
		if (status !== 200) {
			res.resume();
			throw new FetchError("status", `the server answered HTTP ${status}`, undefined, status);
		}
		const encoding = String(res.headers["content-encoding"] ?? "identity").toLowerCase();
		if (encoding !== "identity") {
			res.destroy();
			throw new FetchError("encoding", "the response is compressed, which is not supported", `content-encoding ${encoding}`);
		}
		const type = types.get(
			String(res.headers["content-type"] ?? "")
				.split(";")[0]
				.trim()
				.toLowerCase()
		);
		if (type === undefined) {
			res.destroy();
			throw new FetchError(
				"type",
				`the content type is not supported (${names.length === 1 ? `${names[0]} is` : `${names.slice(0, -1).join(", ")} and ${names.at(-1)} are`})`,
				`content-type ${res.headers["content-type"]}`
			);
		}
		const length = Number(res.headers["content-length"]);
		if (Number.isFinite(length) && length > options.maxBytes) {
			res.destroy();
			throw new FetchError("size", `the document is larger than ${options.maxBytes} bytes`, `content-length ${length}`);
		}
		const bytes = await read(res, options.maxBytes);
		// The header says what the server claims; a PDF must also look like one.
		if (type === "application/pdf" && !bytes.subarray(0, 1024).includes("%PDF-")) {
			throw new FetchError("type", "the content is not a PDF", "no %PDF- header in the first 1024 bytes");
		}
		return { bytes, mediaType: type, url: url.href };
	}
}

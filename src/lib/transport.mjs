/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/transport.mjs
 *	@Date: 2026-10-25T21:38:02-07:00 (1792989482)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-26T15:38:58-07:00 (1793054338)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Default upstream transport: a small `fetch`-compatible function on top of `node:http` / `node:https`.
 *
 * It exists because the global `fetch` (undici) enforces a 300 second headers timeout and a 300 second body timeout,
 * which kill requests to slow local servers: vLLM sends its response headers together with the first token, and a
 * long prompt on a CPU or a busy GPU can take far longer than five minutes to produce one. This transport applies no
 * timeouts at all (the caller aborts through `signal`), never follows redirects (so credentials in headers are never
 * replayed to another host; with `redirect: "error"` a redirect rejects instead of being returned) and does not
 * decompress (it asks for `identity`). Every request uses a fresh connection (no keep-alive pool), so a server that closed an
 * idle connection can never make the next request fail with a stale-socket reset.
 */

import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";

const NO_BODY = new Set([204, 205, 304]);

/**
 * `fetch`-style request.
 * @param {string|URL} url - Absolute http(s) URL.
 * @param {{ method?: string, headers?: Record<string, string>, body?: string|Uint8Array, signal?: AbortSignal, redirect?: string }} [init] - Request options.
 * @param {{ http: any, https: any }} [modules] - Protocol modules (overridable for tests).
 * @returns {Promise<Response>} Response whose `body` is a web `ReadableStream`.
 */
export function transport(url, init = {}, modules = { http, https }) {
	const target = new URL(url);
	const headers = { "accept-encoding": "identity", ...init.headers };
	if (init.body !== undefined) headers["content-length"] = String(Buffer.byteLength(init.body));
	const { signal, redirect } = init;
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason);
		const client = target.protocol === "https:" ? modules.https : modules.http;
		const request = client.request(target, { method: init.method ?? "GET", headers, agent: false }, (incoming) => {
			signal?.removeEventListener("abort", onAbort);
			if (redirect === "error" && incoming.statusCode >= 300 && incoming.statusCode < 400 && incoming.headers.location) {
				incoming.destroy();
				return reject(new TypeError(`unexpected redirect to ${incoming.headers.location}`));
			}
			const out = new Headers();
			for (const [name, value] of Object.entries(incoming.headers)) {
				for (const item of [].concat(value)) out.append(name, item);
			}
			const body = NO_BODY.has(incoming.statusCode) ? null : Readable.toWeb(incoming);
			if (body === null) incoming.resume();
			resolve(new Response(body, { status: incoming.statusCode, statusText: incoming.statusMessage, headers: out }));
			signal?.addEventListener("abort", () => incoming.destroy(signal.reason), { once: true });
		});
		const onAbort = () => request.destroy(signal.reason);
		signal?.addEventListener("abort", onAbort, { once: true });
		request.on("error", reject);
		request.end(init.body);
	});
}

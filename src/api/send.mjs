/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/send.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:01-07:00 (1792958341)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Root api: full round trip to the upstream through the configured transport.
 * @module @cldmv/llm-translator/send
 */
import { context, self } from "../lib/runtime.mjs";
import { TranslatorError } from "../lib/errors.mjs";
import * as http from "../lib/http.mjs";

const SSE_HEADERS = { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", "x-accel-buffering": "no" };

/**
 * Send a client request to the routed upstream and return the client-protocol reply.
 * @param {any} body - Client request body (per `front`).
 * @param {any} [options] - `{ signal, front, headers, clientHeaders, filter }`: abort signal for the upstream call, per-call front, extra upstream headers, client headers forwarded to a native Anthropic upstream, and the pass-through body filter (see `request`).
 * @returns {Promise<{status: number, headers: Record<string,string>, body: any} | {status: number, headers: Record<string,string>, stream: AsyncIterable<{event?: string, data: *}>}>} A JSON reply, or a stream reply when the client asked for streaming and the upstream accepted.
 */
export async function send(body, options = {}) {
	const { transport } = context.state;
	const { request, response, stream, error } = self;
	const build = error.build;
	try {
		return await round({ transport, request, response, stream, error }, body, options);
	} catch (cause) {
		if (!(cause instanceof TranslatorError)) throw cause;
		return build(cause.status, cause.message, { type: cause.type, code: cause.code, param: cause.param, front: options.front });
	}
}

/**
 * The round trip itself; throws `TranslatorError` for conversion and connection failures.
 * @param {any} api - Captured `{ transport, request, response, stream, error }`.
 * @param {any} body - Client request body.
 * @param {any} options - `{ signal, front, headers, clientHeaders, filter }`.
 * @returns {Promise<any>} Client-protocol reply.
 */
async function round({ transport, request, response, stream, error }, body, options) {
	const upstream = await request(body, {
		front: options.front,
		headers: options.headers,
		clientHeaders: options.clientHeaders,
		filter: options.filter
	});
	let result;
	try {
		result = await transport(upstream.url, {
			method: upstream.method,
			headers: upstream.headers,
			body: JSON.stringify(upstream.body),
			signal: options.signal,
			redirect: "error"
		});
	} catch (cause) {
		if (options.signal?.aborted) throw cause;
		throw new TranslatorError(`Could not reach the upstream (${upstream.upstream}): ${cause.message}`, {
			code: "upstream_unreachable",
			status: 502,
			details: { cause }
		});
	}
	const headers = http.plain(result.headers);
	if (!result.ok) return error(result.status, await parse(result), headers, upstream.state);
	if (upstream.state.stream) {
		return { status: 200, headers: SSE_HEADERS, stream: stream(result.body, upstream.state) };
	}
	const parsed = await parse(result);
	if (parsed === null || typeof parsed !== "object") {
		return error(502, "The upstream returned a body that is not JSON", headers, upstream.state);
	}
	return { status: 200, headers: { "content-type": "application/json" }, body: await response(parsed, upstream.state) };
}

/**
 * Read a fetch response body as JSON, falling back to its text, or null when empty.
 * @param {Response} result - Fetch response.
 * @returns {Promise<*>} Parsed body.
 */
async function parse(result) {
	const text = await result.text();
	try {
		return JSON.parse(text);
	} catch {
		return text === "" ? null : text;
	}
}

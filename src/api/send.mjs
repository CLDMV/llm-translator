/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/send.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-31T14:45:53-07:00 (1793483153)
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
import * as images from "../lib/images.mjs";
import { parse as parseError } from "../lib/upstream-error.mjs";
import { meter as createMeter } from "../lib/usage.mjs";
import { warn } from "../lib/warn.mjs";

const SSE_HEADERS = { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", "x-accel-buffering": "no" };

/**
 * Send a client request to the routed upstream and return the client-protocol reply.
 *
 * Every reply, including error replies, carries a non-enumerable `usage` property: a `Promise` of the usage report that never rejects.
 * For JSON and error replies it is already settled. For a stream reply it settles when the stream ends, throws or is returned early
 * (`break` or `return()`); a stream nobody iterates never settles. `onUsage` is called with the same report exactly once, also when
 * `send` throws (for example when the caller aborted). The report is `{ input_tokens, output_tokens, cache_read_input_tokens,
 * cache_creation_input_tokens, reported, complete, reason, model, requested, upstream, front, stream }`: token fields are numbers or
 * `null` (never 0 for unknown), `reported` is false when the upstream carried no usage, `complete` is true only for a reply that finished
 * normally and `reason` is `"done"`, `"aborted"`, `"error"` or `"upstream_error"`. A stream that ends early reports the usage seen so far.
 * @param {any} body - Client request body (per `front`).
 * @param {any} [options] - `{ signal, front, headers, clientHeaders, filter, onUsage }`: abort signal for the upstream call, per-call front, extra upstream headers, client headers forwarded to a native Anthropic upstream, the pass-through body filter (see `request`) and the usage callback (an exception in it is reported as a warning and never breaks the reply).
 * @returns {Promise<{status: number, headers: Record<string,string>, body: any, usage: Promise<any>} | {status: number, headers: Record<string,string>, stream: AsyncIterable<{event?: string, data: *}>, usage: Promise<any>}>} A JSON reply, or a stream reply when the client asked for streaming and the upstream accepted.
 */
export async function send(body, options = {}) {
	const { transport, textOnly } = context.state;
	const { request, response, stream, error } = self;
	const build = error.build;
	const { config, state } = context;
	const object = body && typeof body === "object" && !Array.isArray(body);
	const meta = {
		model: null,
		requested: object && typeof body.model === "string" ? body.model : null,
		upstream: null,
		front: options.front ?? config.front,
		stream: object && body.stream === true
	};
	const meter = createMeter(meta, options.onUsage, (message) => warn(config, state, message));
	const attach = (reply) => Object.defineProperty(reply, "usage", { value: meter.usage, enumerable: false, configurable: true });
	try {
		return attach(await round({ transport, textOnly, request, response, stream, error }, body, options, meter));
	} catch (cause) {
		if (!(cause instanceof TranslatorError)) {
			meter.finish(options.signal?.aborted ? "aborted" : "error");
			throw cause;
		}
		meter.finish("error");
		return attach(build(cause.status, cause.message, { type: cause.type, code: cause.code, param: cause.param, front: options.front }));
	}
}

/**
 * The round trip itself; throws `TranslatorError` for conversion and connection failures.
 * @param {any} api - Captured `{ transport, textOnly, request, response, stream, error }`.
 * @param {any} body - Client request body.
 * @param {any} options - `{ signal, front, headers, clientHeaders, filter }`.
 * @param {any} meter - Usage meter (see `lib/usage`); settled here for every outcome except a live stream.
 * @returns {Promise<any>} Client-protocol reply.
 */
async function round({ transport, textOnly, request, response, stream, error }, body, options, meter) {
	const ask = { front: options.front, headers: options.headers, clientHeaders: options.clientHeaders, filter: options.filter };
	/**
	 * Record where the request goes.
	 * @param {any} sent - Result of `request`.
	 * @returns {void}
	 */
	const note = (sent) => {
		meter.meta.model = sent.body.model ?? null;
		meter.meta.upstream = sent.upstream;
	};
	/**
	 * Build the error reply for an upstream failure and settle the meter.
	 * @param {number} status - Status.
	 * @param {any} failure - Parsed failure body.
	 * @param {Record<string,string>} headers - Upstream headers.
	 * @param {any} state - Request state.
	 * @param {"upstream_error" | "error"} reason - Report reason.
	 * @returns {any} Error reply.
	 */
	const fail = (status, failure, headers, state, reason) => {
		meter.finish(reason);
		return error(status, failure, headers, state);
	};
	let upstream = await request(body, ask);
	note(upstream);
	let result = await call(transport, upstream, options.signal);
	if (!result.ok && result.status === 400 && upstream.images.sent && upstream.images.retry) {
		// A text-only model behind an OpenAI-protocol upstream: ask once more without the images and remember the model.
		const failure = await parse(result);
		if (!images.refused(parseError(failure, 400).message))
			return fail(400, failure, http.plain(result.headers), upstream.state, "upstream_error");
		textOnly.add(upstream.images.key);
		upstream = await request(body, { ...ask, images: false });
		note(upstream);
		result = await call(transport, upstream, options.signal);
	}
	const headers = http.plain(result.headers);
	if (!result.ok) return fail(result.status, await parse(result), headers, upstream.state, "upstream_error");
	if (upstream.state.stream) {
		return { status: 200, headers: SSE_HEADERS, stream: meter.track(stream(result.body, upstream.state), options.signal) };
	}
	const parsed = await parse(result);
	if (parsed === null || typeof parsed !== "object") {
		return fail(502, "The upstream returned a body that is not JSON", headers, upstream.state, "error");
	}
	const client = await response(parsed, upstream.state);
	meter.json(client);
	meter.finish("done");
	return { status: 200, headers: { "content-type": "application/json" }, body: client };
}

/**
 * One upstream call; connection failures become `upstream_unreachable`.
 * @param {Function} transport - Fetch-compatible transport.
 * @param {any} upstream - Result of `request`.
 * @param {AbortSignal | undefined} signal - Abort signal.
 * @returns {Promise<Response>} Upstream response.
 */
async function call(transport, upstream, signal) {
	try {
		return await transport(upstream.url, {
			method: upstream.method,
			headers: upstream.headers,
			body: JSON.stringify(upstream.body),
			signal,
			redirect: "error"
		});
	} catch (cause) {
		if (signal?.aborted) throw cause;
		throw new TranslatorError(`Could not reach the upstream (${upstream.upstream}): ${cause.message}`, {
			code: "upstream_unreachable",
			status: 502,
			details: { cause }
		});
	}
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

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
import * as tools from "../lib/tools.mjs";
import { parse as parseError } from "../lib/upstream-error.mjs";
import { meter as createMeter, normalize } from "../lib/usage.mjs";
import { capture } from "../lib/capture.mjs";
import { estimate, bodyLength, output, patch, stream as estimating } from "../lib/estimate.mjs";
import { warn } from "../lib/warn.mjs";
import * as pool from "../lib/pool.mjs";

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
 *
 * When a converted reply's upstream did not report a side of the usage (input or output; all zero counts as not reported), the
 * client-protocol reply carries an estimate for that side instead of zero: the server tokenizer's count when the driver has one (not
 * for an OpenAI-front stream whose usage the client will not see), else one token per four characters (what `token.count` uses) for the
 * input, and one token per four characters of generated text for the output. Real sides are left alone. The report never presents
 * estimates as real counts: its token fields keep only what the upstream reported and the estimates are in
 * `estimated: { input_tokens, output_tokens }` (null for a side that was reported, and null altogether when nothing was estimated).
 * On the Anthropic front a stream carries them in the final `message_delta`, because `message_start` is sent before the output is known.
 * Replies passed through without conversion are never altered.
 * @param {any} body - Client request body (per `front`).
 * @param {any} [options] - `{ signal, front, headers, clientHeaders, filter, onUsage }`: abort signal for the upstream call, per-call front, extra upstream headers, client headers forwarded to a native Anthropic upstream, the pass-through body filter (see `request`) and the usage callback (an exception in it is reported as a warning and never breaks the reply).
 * @returns {Promise<{status: number, headers: Record<string,string>, body: any, usage: Promise<any>} | {status: number, headers: Record<string,string>, stream: AsyncIterable<{event?: string, data: *}>, usage: Promise<any>}>} A JSON reply, or a stream reply when the client asked for streaming and the upstream accepted.
 */
export async function send(body, options = {}) {
	const { transport, textOnly } = context.state;
	const { request, response, stream, error } = self;
	const build = error.build;
	const { config, state } = context;
	const captured = capture(self, context, options.front);
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
		return attach(await round({ transport, textOnly, request, response, stream, error, captured }, body, options, meter));
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
 * @param {any} api - Captured `{ transport, textOnly, request, response, stream, error, captured }` (`captured` is the `lib/capture` result).
 * @param {any} body - Client request body.
 * @param {any} options - `{ signal, front, headers, clientHeaders, filter }`.
 * @param {any} meter - Usage meter (see `lib/usage`); settled here for every outcome except a live stream.
 * @returns {Promise<any>} Client-protocol reply.
 */
async function round({ transport, textOnly, request, response, stream, error, captured }, body, options, meter) {
	const ask = { front: options.front, headers: options.headers, clientHeaders: options.clientHeaders, filter: options.filter, usage: true };
	// An OpenAI-front client sees the final usage chunk only when it asked for one; the meter always gets it.
	const hide = meter.meta.front === "openai" && body?.stream_options?.include_usage !== true;
	/**
	 * Record where the request goes.
	 * @param {any} sent - Result of `request`.
	 * @returns {void}
	 */
	const note = (sent) => {
		meter.meta.model = sent.body.model ?? null;
		meter.meta.upstream = sent.upstream;
		// A converted reply carries numbers the converter wrote for the client (zeros for what the upstream did not carry, and nothing for
		// a stream that fails partway); meter the upstream's own counts, which the converter keeps on its state.
		// A native reply has no converter state to read, and the endpoint tried before (failover) may have left a source behind.
		if (sent.state.native) meter.source(null);
		else meter.source(() => sent.state.convert?.upstreamUsage, sent.state.front === "anthropic" ? "openai" : "folded");
	};
	/**
	 * Which sides of a converted reply's usage the upstream did not report, and so need an estimate (valid once the converter has read its reply).
	 * A side counts as reported when its field is present (a real 0 stays 0); input includes cached tokens. A usage object that is absent, or
	 * has every field absent or zero, counts as not reported at all (the meter's rule). Pass-through replies are never estimated.
	 * @param {any} sent - Result of `request`.
	 * @returns {{input: boolean, output: boolean}} True for each side that is missing.
	 */
	const gaps = (sent) => {
		if (sent.state.native) return { input: false, output: false };
		const counts = normalize(sent.state.front === "anthropic" ? "openai" : "folded", sent.state.convert?.upstreamUsage);
		if (counts === null) return { input: true, output: true };
		return {
			input: counts.input_tokens === null && counts.cache_read_input_tokens === null && counts.cache_creation_input_tokens === null,
			output: counts.output_tokens === null
		};
	};
	/**
	 * Input estimate for a request: the driver's tokenizer when it has one and answers, else the character estimate. The tokenizer
	 * round trip is skipped when the client will not see the usage (an OpenAI-front stream that did not ask for it), so the end of the
	 * stream is not delayed.
	 * @param {any} sent - Result of `request`.
	 * @returns {Promise<number>} Estimated prompt tokens.
	 */
	const input = async (sent) => {
		const endpoint = captured.endpoint(sent.upstream);
		const driver = captured.driver(endpoint);
		const exact =
			driver.count && !(hide && sent.state.stream)
				? await driver.count({
						endpoint,
						request: sent.body,
						transport,
						signal: options.signal,
						timeout: captured.config.detectTimeout
					})
				: null;
		return exact ?? estimate(sent.body);
	};
	/**
	 * The estimates for the missing sides, or null when there are none.
	 * @param {any} sent - Result of `request`.
	 * @param {number} characters - Generated characters.
	 * @returns {Promise<{input_tokens: number | null, output_tokens: number | null} | null>} Counts, null for a side that was reported.
	 */
	const counts = async (sent, characters) => {
		const gap = gaps(sent);
		if (!gap.input && !gap.output) return null;
		return { input_tokens: gap.input ? await input(sent) : null, output_tokens: gap.output ? output(characters) : null };
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
	/**
	 * One endpoint's turn: the call, and the single retry without images or tools when that endpoint refuses them.
	 * @param {any} first - Result of `request` for the endpoint.
	 * @returns {Promise<{upstream: any, result: Response, failure?: any}>} The last request sent, its response and, when the body was read, the parsed failure.
	 */
	const attempt = async (first) => {
		let sent = first;
		let result = await call(transport, sent, options.signal);
		if (!result.ok && result.status === 400 && ((sent.images.sent && sent.images.retry) || (sent.tools.sent && sent.tools.retry))) {
			// A text-only model, or a vLLM server without tool parsing, behind an OpenAI-protocol upstream: ask once more without what it
			// refused. A refused image is remembered for the model; a refused tool list is not (the server may be restarted with the flags).
			const failure = await parse(result);
			const message = parseError(failure, 400).message;
			const retry = {};
			if (sent.images.sent && sent.images.retry && images.refused(message)) {
				textOnly.add(sent.images.key);
				retry.images = false;
			} else if (sent.tools.sent && sent.tools.retry && tools.refused(message)) retry.tools = false;
			if (!("images" in retry || "tools" in retry)) return { upstream: sent, result, failure };
			sent = await request(body, { ...ask, ...retry, endpoint: sent.upstream });
			note(sent);
			result = await call(transport, sent, options.signal);
		}
		return { upstream: sent, result };
	};
	let upstream = await request(body, ask);
	const names = upstream.pool;
	let turn = 0;
	// The endpoint whose in-flight slot this request holds.
	let held = null;
	const release = () => held.health.inflight--;
	let result;
	let failure;
	try {
		for (;;) {
			const endpoint = captured.endpoint(upstream.upstream);
			held = endpoint;
			endpoint.health.inflight++;
			endpoint.health.requests++;
			note(upstream);
			// Only a connection error or a 5xx before the first byte of the reply moves on to the next endpoint of the pool; 4xx, the abort
			// of the caller and anything that happens once the reply has started never do.
			let reason = null;
			try {
				({ upstream, result, failure } = await attempt(upstream));
				if (!result.ok && result.status >= 500) reason = `HTTP ${result.status}`;
			} catch (cause) {
				if (!(cause instanceof TranslatorError) || cause.code !== "upstream_unreachable") throw cause;
				reason = cause.message;
				result = undefined;
				failure = cause;
			}
			if (reason === null) {
				pool.succeeded(endpoint);
				break;
			}
			pool.failed(captured.config, endpoint, reason);
			if (turn + 1 >= names.length || options.signal?.aborted) {
				// Nothing left to try: the last endpoint's failure is the reply.
				if (result === undefined) throw failure;
				break;
			}
			await result?.body?.cancel();
			const next = await request(body, { ...ask, endpoint: names[++turn] });
			release();
			upstream = next;
		}
	} catch (cause) {
		release();
		throw cause;
	}
	// The slot is held until the reply is over (the meter settles for every outcome; a stream nobody reads never does).
	const slot = held;
	held = null;
	meter.usage.then(() => slot.health.inflight--);
	const headers = http.plain(result.headers);
	if (!result.ok) return fail(result.status, failure ?? (await parse(result)), headers, upstream.state, "upstream_error");
	if (upstream.state.stream) {
		const events = stream(result.body, upstream.state);
		const client = upstream.state.native
			? events
			: estimating(meter.meta.front, events, {
					gaps: () => gaps(upstream),
					input: () => input(upstream),
					report: (counts) => meter.estimate(counts)
				});
		return { status: 200, headers: SSE_HEADERS, stream: meter.track(client, options.signal, hide) };
	}
	const parsed = await parse(result);
	if (parsed === null || typeof parsed !== "object") {
		return fail(502, "The upstream returned a body that is not JSON", headers, upstream.state, "error");
	}
	const client = await response(parsed, upstream.state);
	const estimated = await counts(upstream, bodyLength(meter.meta.front, client));
	if (estimated) {
		client.usage = patch(meter.meta.front, client.usage, estimated);
		meter.estimate(estimated);
	}
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

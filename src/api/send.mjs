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
import { emit } from "../lib/events.mjs";
import * as pool from "../lib/pool.mjs";
import { createBudget } from "../lib/thinking.mjs";

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
 * @param {any} [options] - `{ signal, front, headers, clientHeaders, filter, onUsage, log }`: abort signal for the upstream call, per-call front, extra upstream headers, client headers forwarded to a native Anthropic upstream, the pass-through body filter (see `request`) and the usage callback (an exception in it is reported as a `usage` event and never breaks the reply) and the logger this request's events also go to (used by the server).
 * @returns {Promise<{status: number, headers: Record<string,string>, body: any, usage: Promise<any>} | {status: number, headers: Record<string,string>, stream: AsyncIterable<{event?: string, data: *}>, usage: Promise<any>}>} A JSON reply, or a stream reply when the client asked for streaming and the upstream accepted.
 */
export async function send(body, options = {}) {
	const { transport, textOnly, jsonInstruction } = context.state;
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
	const meter = createMeter(meta, options.onUsage, (message, details) =>
		warn(config, state, message, { type: "usage", ...details, log: options.log })
	);
	const attach = (reply) => Object.defineProperty(reply, "usage", { value: meter.usage, enumerable: false, configurable: true });
	try {
		return attach(await round({ transport, textOnly, jsonInstruction, request, response, stream, error, captured }, body, options, meter));
	} catch (cause) {
		if (!(cause instanceof TranslatorError)) {
			if (!options.signal?.aborted) {
				emit(captured, { type: "error", kind: "exception", level: "error", message: String(cause?.message ?? cause), log: options.log });
			}
			meter.finish(options.signal?.aborted ? "aborted" : "error");
			throw cause;
		}
		meter.finish("error");
		return attach(build(cause.status, cause.message, { type: cause.type, code: cause.code, param: cause.param, front: options.front }));
	}
}

/**
 * The round trip itself; throws `TranslatorError` for conversion and connection failures.
 * @param {any} api - Captured `{ transport, textOnly, jsonInstruction, request, response, stream, error, captured }` (`captured` is the `lib/capture` result).
 * @param {any} body - Client request body.
 * @param {any} options - `{ signal, front, headers, clientHeaders, filter }`.
 * @param {any} meter - Usage meter (see `lib/usage`); settled here for every outcome except a live stream.
 * @returns {Promise<any>} Client-protocol reply.
 */
async function round({ transport, textOnly, jsonInstruction, request, response, stream, error, captured }, body, options, meter) {
	const ask = {
		front: options.front,
		headers: options.headers,
		clientHeaders: options.clientHeaders,
		filter: options.filter,
		usage: true,
		budget: createBudget(),
		log: options.log
	};
	/**
	 * Emit an event of this request.
	 * @param {any} spec - Event spec (see `lib/events`).
	 * @returns {void}
	 */
	const announce = (spec) => emit(captured, { ...spec, log: options.log });
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
	 * One endpoint's turn: the call, and the single retry without images or tools, or with the JSON instruction, when that endpoint refuses them.
	 * @param {any} first - Result of `request` for the endpoint.
	 * @returns {Promise<{upstream: any, result: Response, failure?: any}>} The last request sent, its response and, when the body was read, the parsed failure.
	 */
	const attempt = async (first) => {
		let sent = first;
		let result = await call(transport, sent, options.signal, limitsNow());
		const status = result.status;
		const others = status === 400 && [sent.images, sent.tools].some((part) => part.sent && part.retry);
		// The schema that stands in for `json_object` is retried on a 400 or 422 whatever the message says: servers word it differently.
		const schema = (status === 400 || status === 422) && sent.json.sent && sent.json.retry;
		if (!result.ok && (others || schema)) {
			// A text-only model, or a vLLM server without tool parsing, behind an OpenAI-protocol upstream: ask once more without what it
			// refused. A refused image is remembered for the model; a refused tool list is not (the server may be restarted with the flags).
			const failure = await parse(result);
			const message = parseError(failure, status).message;
			const retry = {};
			if (status === 400 && sent.images.sent && sent.images.retry && images.refused(message)) {
				textOnly.add(sent.images.key);
				retry.images = false;
			} else if (status === 400 && sent.tools.sent && sent.tools.retry && tools.refused(message)) retry.tools = false;
			else if (schema) retry.jsonObject = "instruction";
			if (!("images" in retry || "tools" in retry || "jsonObject" in retry)) return { upstream: sent, result, failure };
			const original = { upstream: sent, result, failure };
			if ("images" in retry || "tools" in retry) {
				// The image and tool retries are announced when they are made; the JSON one only once it is known to have worked (below).
				const part = "images" in retry ? "images" : "tools";
				announce({
					type: "fallback",
					kind: part,
					level: "warn",
					message: `Upstream ${sent.upstream}: ${sent.state.model} refused ${part === "images" ? "images" : "tools"} (${status}: "${String(message).trim().slice(0, 500)}"); sent the request again without them.`,
					endpoint: sent.upstream,
					model: sent.body.model,
					status,
					reason: String(message).trim().slice(0, 500),
					action: part === "images" ? "text-only" : "without-tools"
				});
			}
			sent = await request(body, { ...ask, ...retry, endpoint: sent.upstream, retry: true });
			note(sent);
			result = await call(transport, sent, options.signal, limitsNow());
			if (schema && "jsonObject" in retry) {
				if (!result.ok) {
					// The instruction fared no better, so the schema was not the problem: the caller gets the original error and nothing is remembered.
					try {
						await result.body?.cancel?.();
					} catch {
						// A body that cannot be cancelled is dropped.
					}
					note(original.upstream);
					return original;
				}
				// The retry worked, which is what shows the schema was refused: remember it, and log the upstream's own words.
				jsonInstruction.add(original.upstream.json.key);
				announce({
					type: "fallback",
					kind: "json_object",
					level: "warn",
					message: `Upstream ${original.upstream.upstream}: ${original.upstream.state.model} rejected the json_object schema emulation (${status}: "${String(message).trim().slice(0, 500)}"); sent it as a system instruction instead. Set jsonObject: "instruction" on this upstream to skip the first attempt.`,
					endpoint: original.upstream.upstream,
					model: original.upstream.body.model,
					status,
					reason: String(message).trim().slice(0, 500),
					action: "instruction"
				});
			}
		}
		return { upstream: sent, result };
	};
	// `send` takes the in-flight slot when the endpoint is picked (see `request`), so concurrent requests see each other.
	let upstream = await request(body, { ...ask, hold: true });
	const names = upstream.pool;
	let turn = 0;
	// Timeouts apply only to endpoints that have pool mates to fail over to; a lone endpoint keeps the transport's no-timeout behaviour.
	const limits = names.length > 1 ? captured.config.pool : null;
	// The last untried endpoint has nothing to fail over to, so a slow first token must not become a 502 there: only the connect timeout applies.
	const limitsNow = () =>
		limits && { connectTimeout: limits.connectTimeout, headersTimeout: turn + 1 < names.length ? limits.headersTimeout : 0 };
	// The endpoint whose in-flight slot this request holds.
	let held = captured.endpoint(upstream.upstream);
	const release = () => held.health.inflight--;
	let result;
	let failure;
	try {
		for (;;) {
			const endpoint = held;
			endpoint.health.requests++;
			note(upstream);
			// Only a connection error (or timeout) or a 5xx before the first byte of the reply moves on to the next endpoint of the pool; 4xx,
			// the abort of the caller and anything that happens once the reply has started never do.
			let reason = null;
			try {
				({ upstream, result, failure } = await attempt(upstream));
				if (!result.ok && result.status >= 500) {
					reason = `HTTP ${result.status}`;
					announce({
						type: "error",
						kind: "upstream",
						level: "error",
						message: `Upstream ${endpoint.name} answered HTTP ${result.status}`,
						endpoint: endpoint.name,
						model: upstream.body.model,
						status: result.status
					});
				}
			} catch (cause) {
				if (!(cause instanceof TranslatorError) || cause.code !== "upstream_unreachable") throw cause;
				reason = cause.message;
				result = undefined;
				failure = cause;
				announce({
					type: "error",
					kind: "transport",
					level: "error",
					message: cause.message,
					endpoint: endpoint.name,
					model: upstream.body.model
				});
			}
			if (reason === null) {
				pool.succeeded(endpoint);
				break;
			}
			pool.failed(captured.config, endpoint, reason);
			// The next endpoint that still serves the model (the pool is recomputed per request, so a member may have dropped out meanwhile).
			let next = null;
			while (next === null && !options.signal?.aborted && turn + 1 < names.length) {
				try {
					next = await request(body, { ...ask, endpoint: names[++turn], hold: true });
				} catch (cause) {
					if (!(cause instanceof TranslatorError) || cause.code !== "endpoint_not_in_pool") throw cause;
				}
			}
			if (next === null) {
				// Nothing left to try: the last endpoint's failure is the reply.
				if (result === undefined) throw failure;
				break;
			}
			announce({
				type: "failover",
				level: "warn",
				message: `Upstream ${endpoint.name} failed (${reason}); trying ${next.upstream}`,
				from: endpoint.name,
				to: next.upstream,
				model: next.body.model,
				reason
			});
			try {
				await result?.body?.cancel?.();
			} catch {
				// A body that cannot be cancelled is dropped; failover goes on.
			}
			release();
			held = captured.endpoint(next.upstream);
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
		announce({
			type: "error",
			kind: "upstream",
			level: "error",
			message: `Upstream ${upstream.upstream} returned a body that is not JSON`,
			endpoint: upstream.upstream,
			model: upstream.body.model,
			status: 502
		});
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
 * One upstream call; connection failures and timeouts become `upstream_unreachable`.
 * @param {Function} transport - Fetch-compatible transport.
 * @param {any} upstream - Result of `request`.
 * @param {AbortSignal | undefined} signal - Abort signal.
 * @param {{connectTimeout: number, headersTimeout: number} | null} [limits] - Pool timeouts in ms (0 is off), or null for none.
 * @returns {Promise<Response>} Upstream response.
 */
async function call(transport, upstream, signal, limits = null) {
	let timer;
	let late = false;
	let guarded = signal;
	if (limits && limits.headersTimeout > 0) {
		// Aborts the request when no response headers arrive in time; the timer stops at the headers, so the body is never capped.
		const timeout = new AbortController();
		guarded = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
		timer = setTimeout(() => {
			late = true;
			timeout.abort();
		}, limits.headersTimeout);
	}
	try {
		return await transport(upstream.url, {
			method: upstream.method,
			headers: upstream.headers,
			body: JSON.stringify(upstream.body),
			signal: guarded,
			redirect: "error",
			...(limits && limits.connectTimeout > 0 ? { connectTimeout: limits.connectTimeout } : {})
		});
	} catch (cause) {
		if (signal?.aborted) throw cause;
		const why = late ? `no response headers within ${limits.headersTimeout} ms` : cause.message;
		throw new TranslatorError(`Could not reach the upstream (${upstream.upstream}): ${why}`, {
			code: "upstream_unreachable",
			status: 502,
			details: { cause }
		});
	} finally {
		clearTimeout(timer);
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

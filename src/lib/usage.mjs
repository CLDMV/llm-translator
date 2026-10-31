/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/usage.mjs
 *	@Date: 2026-10-31T14:00:00-07:00 (1793480400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-31T14:00:00-07:00 (1793480400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Usage metering for `send`: reads token counts from the client-protocol reply (JSON body or stream events) and
 * delivers one normalized report per request.
 * @module @cldmv/llm-translator/lib/usage
 */
import { toAnthropicUsage } from "./finish.mjs";

/**
 * @typedef {object} UsageReport
 * @property {number | null} input_tokens - Prompt tokens that were not served from cache, or null when unknown.
 * @property {number | null} output_tokens - Completion tokens, or null when unknown.
 * @property {number | null} cache_read_input_tokens - Prompt tokens served from cache, or null when unknown.
 * @property {number | null} cache_creation_input_tokens - Prompt tokens written to cache, or null when unknown.
 * @property {boolean} reported - True when the reply carried usage; false means every token field is null.
 * @property {boolean} complete - True only when the reply finished normally.
 * @property {"done" | "aborted" | "error" | "upstream_error"} reason - Why the report was produced.
 * @property {string | null} model - Model name sent upstream.
 * @property {string | null} requested - Model the client asked for.
 * @property {string | null} upstream - Upstream endpoint name.
 * @property {"anthropic" | "openai"} front - Client protocol.
 * @property {boolean} stream - Whether the client asked for a stream.
 */

const FIELDS = ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"];

/**
 * Normalize a usage object of the client protocol.
 * @param {"anthropic" | "openai"} front - Client protocol.
 * @param {any} usage - `usage` as carried by a reply or event.
 * @returns {Record<string, number | null> | null} Normalized counts, or null when there is no usage (an absent object, or all zeros, which a
 * converter writes when the upstream reported nothing and no real reply has).
 */
export function normalize(front, usage) {
	if (!usage || typeof usage !== "object") return null;
	const out =
		front === "openai"
			? toAnthropicUsage(usage)
			: Object.fromEntries(FIELDS.map((field) => [field, Number.isFinite(usage[field]) ? usage[field] : null]));
	if (FIELDS.every((field) => !out[field])) return null;
	return out;
}

/**
 * Create the meter for one request.
 * @param {{front: "anthropic" | "openai", requested: string | null, model: string | null, upstream: string | null, stream: boolean}} meta - Request facts; `model` and `upstream` may be filled in later.
 * @param {((report: UsageReport) => any) | undefined} onUsage - Caller's callback.
 * @param {(message: string) => void} warn - Receives a message when `onUsage` throws or rejects.
 * @returns {{meta: any, usage: Promise<UsageReport>, json: (body: any) => void, event: (data: any) => void, finish: (reason: UsageReport["reason"]) => void, track: (source: AsyncIterable<any>, signal?: AbortSignal) => any}} Meter.
 */
export function meter(meta, onUsage, warn) {
	/** @type {Record<string, number | null>} */
	const seen = Object.fromEntries(FIELDS.map((field) => [field, null]));
	let reported = false;
	let done = false;
	let failed = false;
	let settle;
	const usage = new Promise((resolve) => {
		settle = resolve;
	});

	/**
	 * Merge counts from a usage object (later values win, absent fields keep what was seen).
	 * @param {any} raw - Client-protocol usage object.
	 * @returns {void}
	 */
	const take = (raw) => {
		const counts = normalize(meta.front, raw);
		if (!counts) return;
		reported = true;
		for (const field of FIELDS) if (counts[field] !== null && counts[field] !== undefined) seen[field] = counts[field];
	};

	const finish = (reason) => {
		if (done) return;
		done = true;
		// A converter ends a broken stream with an in-band error event instead of throwing.
		const outcome = reason === "done" && failed ? "error" : reason;
		/** @type {any} */
		const report = { ...seen, reported, complete: outcome === "done", reason: outcome, ...meta };
		settle(report);
		try {
			Promise.resolve(onUsage?.(report)).catch((cause) => warn(`onUsage rejected: ${cause?.message ?? cause}`));
		} catch (cause) {
			warn(`onUsage threw: ${cause?.message ?? cause}`);
		}
	};

	return {
		meta,
		usage,
		json: (body) => take(body?.usage),
		/**
		 * Observe one client event.
		 * @param {any} data - Event data.
		 * @returns {void}
		 */
		event(data) {
			if (!data || typeof data !== "object") return;
			if (data.type === "error" || (meta.front === "openai" && data.error)) failed = true;
			if (meta.front === "anthropic") take(data.type === "message_start" ? data.message?.usage : data.usage);
			else take(data.usage);
		},
		finish,
		/**
		 * Wrap a client event stream: every event passes through unchanged, the report is delivered when the stream ends, throws or
		 * is returned early.
		 * @param {AsyncIterable<any>} source - Client events.
		 * @param {AbortSignal} [signal] - The request's abort signal.
		 * @returns {any} Equivalent async iterator.
		 */
		track(source, signal) {
			const inner = source[Symbol.asyncIterator]();
			const self = this;
			return {
				[Symbol.asyncIterator]() {
					return this;
				},
				async next() {
					try {
						const step = await inner.next();
						if (step.done) finish("done");
						else self.event(step.value?.data);
						return step;
					} catch (cause) {
						finish(signal?.aborted ? "aborted" : "error");
						throw cause;
					}
				},
				async return(value) {
					finish("aborted");
					return inner.return ? inner.return(value) : { done: true, value };
				},
				async throw(cause) {
					finish("error");
					if (inner.throw) return inner.throw(cause);
					throw cause;
				}
			};
		}
	};
}

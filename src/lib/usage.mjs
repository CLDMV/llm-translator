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
/**
 * @typedef {object} UsageReport
 * @property {number | null} input_tokens - Prompt tokens that were not served from cache, or null when unknown.
 * @property {number | null} output_tokens - Completion tokens, or null when unknown.
 * @property {number | null} cache_read_input_tokens - Prompt tokens served from cache, or null when unknown.
 * @property {number | null} cache_creation_input_tokens - Prompt tokens written to cache, or null when unknown.
 * @property {boolean} reported - True when the reply carried usage; false means every token field is null.
 * @property {{ input_tokens: number | null, output_tokens: number | null } | null} estimated - The estimates written into the client reply for the sides the upstream did not report (a side the upstream did report is null here); null when nothing was estimated (the upstream reported both sides, a pass-through reply, a reply that failed first). Never mixed into the token fields.
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
 * A finite number, or null.
 * @param {any} value - Candidate.
 * @returns {number | null} The number, or null when it is not one.
 */
const count = (value) => (Number.isFinite(value) ? value : null);

/**
 * Normalize a usage object. Fields the source did not carry stay null: unknown is never reported as 0.
 * @param {"anthropic" | "openai" | "folded"} protocol - Shape of `usage`: Anthropic (`input_tokens`, ...), OpenAI (`prompt_tokens`, ...) or `folded` (Anthropic, reported the way the OpenAI front does).
 * @param {any} usage - A `usage` object.
 * @returns {Record<string, number | null> | null} Normalized counts, or null when there is no usage (an absent object, or all zeros, which a
 * converter writes when the upstream reported nothing and no real reply has).
 */
export function normalize(protocol, usage) {
	if (!usage || typeof usage !== "object") return null;
	let out;
	if (protocol === "openai") {
		const prompt = count(usage.prompt_tokens);
		const cached = count(usage.prompt_tokens_details?.cached_tokens);
		out = {
			input_tokens: prompt === null ? null : Math.max(0, prompt - (cached ?? 0)),
			output_tokens: count(usage.completion_tokens),
			cache_read_input_tokens: cached,
			cache_creation_input_tokens: null
		};
	} else if (protocol === "folded") {
		// Anthropic usage as the OpenAI front reports it: cache creation is folded into the input count and cached tokens are
		// named only when there are some.
		const input = count(usage.input_tokens);
		out = {
			input_tokens: input === null ? null : input + (count(usage.cache_creation_input_tokens) ?? 0),
			output_tokens: count(usage.output_tokens),
			cache_read_input_tokens: count(usage.cache_read_input_tokens) || null,
			cache_creation_input_tokens: null
		};
	} else {
		out = Object.fromEntries(FIELDS.map((field) => [field, count(usage[field])]));
	}
	if (FIELDS.every((field) => !out[field])) return null;
	return out;
}

/**
 * Is this a final usage-only chunk of the OpenAI front (`choices: []` with a `usage` object)?
 * @param {any} data - Event data.
 * @returns {boolean} True for the usage chunk.
 */
function usageChunk(data) {
	return Boolean(data) && typeof data === "object" && Array.isArray(data.choices) && data.choices.length === 0 && Boolean(data.usage);
}

/**
 * Create the meter for one request.
 * @param {{front: "anthropic" | "openai", requested: string | null, model: string | null, upstream: string | null, stream: boolean}} meta - Request facts; `model` and `upstream` may be filled in later.
 * @param {((report: UsageReport) => any) | undefined} onUsage - Caller's callback.
 * @param {(message: string) => void} warn - Receives a message when `onUsage` throws or rejects.
 * @returns {{meta: any, usage: Promise<UsageReport>, json: (body: any) => void, event: (data: any) => void, finish: (reason: UsageReport["reason"]) => void, estimate: (counts: {input_tokens: number | null, output_tokens: number | null}) => void, source: (read: () => any, protocol?: "openai" | "folded") => void, track: (source: AsyncIterable<any>, signal?: AbortSignal, hide?: boolean) => any}} Meter.
 */
export function meter(meta, onUsage, warn) {
	/** @type {Record<string, number | null>} */
	const seen = Object.fromEntries(FIELDS.map((field) => [field, null]));
	let reported = false;
	// Estimates written into the client reply (see `estimate`); reported separately from the token fields.
	let estimated = null;
	let done = false;
	let failed = false;
	// The reply reached its terminal marker: a JSON body, `message_stop` or the `[DONE]` sentinel.
	let terminal = false;
	// Reads the upstream's own usage (see `source`); when set it replaces the usage seen in the client output.
	let raw = null;
	/** @type {"anthropic" | "openai" | "folded"} */
	let rawProtocol = "openai";
	let settle;
	const usage = new Promise((resolve) => {
		settle = resolve;
	});

	/**
	 * Merge counts from a usage object (later values win, absent fields keep what was seen).
	 * @param {any} value - Usage object.
	 * @param {"anthropic" | "openai" | "folded"} [protocol] - Its shape (default: the client protocol).
	 * @returns {void}
	 */
	const take = (value, protocol = meta.front) => {
		const counts = normalize(protocol, value);
		if (!counts) return;
		reported = true;
		for (const field of FIELDS) if (counts[field] !== null && counts[field] !== undefined) seen[field] = counts[field];
	};

	const finish = (reason) => {
		if (done) return;
		done = true;
		if (raw) take(raw(), rawProtocol);
		// A converter ends a broken stream with an in-band error event instead of throwing.
		const outcome = reason === "done" && failed ? "error" : reason;
		/** @type {any} */
		const report = { ...seen, reported, estimated, complete: outcome === "done", reason: outcome, ...meta };
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
		json(body) {
			terminal = true;
			if (!raw) take(body?.usage);
		},
		/**
		 * Take the counts from the upstream's own OpenAI-protocol usage instead of the client output, which a converter fills with zeros
		 * for what the upstream did not carry.
		 * @param {() => any} read - Returns the upstream's raw `usage` object, or undefined.
		 * @param {"openai" | "folded"} [protocol] - Shape of that object: OpenAI, or Anthropic reported the way the OpenAI front does (see `normalize`).
		 * @returns {void}
		 */
		source(read, protocol = "openai") {
			raw = read;
			rawProtocol = protocol;
		},
		/**
		 * Observe one client event.
		 * @param {any} data - Event data.
		 * @returns {void}
		 */
		event(data) {
			if (data === "[DONE]") terminal = true;
			if (!data || typeof data !== "object") return;
			if (data.type === "error" || (meta.front === "openai" && data.error)) failed = true;
			if (meta.front === "anthropic") {
				if (data.type === "message_stop") terminal = true;
				if (!raw) take(data.type === "message_start" ? data.message?.usage : data.usage);
			} else {
				if (!raw) take(data.usage);
			}
		},
		finish,
		/**
		 * Record the estimates that were written into the client reply because the upstream reported no usage.
		 * @param {{ input_tokens: number | null, output_tokens: number | null }} counts - Estimates (null for a side that was reported).
		 * @returns {void}
		 */
		estimate(counts) {
			estimated = counts;
		},
		/**
		 * Wrap a client event stream: every event passes through unchanged, the report is delivered when the stream ends, throws or
		 * is returned early.
		 * @param {AsyncIterable<any>} source - Client events.
		 * @param {AbortSignal} [signal] - The request's abort signal.
		 * @param {boolean} [hide] - Drop the final usage-only chunk from what the consumer sees (it is still metered).
		 * @returns {any} Equivalent async iterator. A stream that ends without its terminal marker is reported as `error`.
		 */
		track(source, signal, hide = false) {
			const inner = source[Symbol.asyncIterator]();
			const self = this;
			return {
				[Symbol.asyncIterator]() {
					return this;
				},
				async next() {
					try {
						for (;;) {
							const step = await inner.next();
							if (step.done) finish(terminal ? "done" : "error");
							else {
								self.event(step.value?.data);
								if (hide && usageChunk(step.value?.data)) continue;
							}
							return step;
						}
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

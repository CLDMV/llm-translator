/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/metrics.mjs
 *	@Date: 2026-11-17T09:00:00-08:00 (1794934800)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-17T09:00:00-08:00 (1794934800)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Prometheus metrics for the standalone server: a small registry that renders the text exposition format (version 0.0.4)
 * and a per-server recorder that observes requests. No dependencies.
 * @module @cldmv/llm-translator/lib/metrics
 */
import { describe } from "./pool.mjs";

/** `Content-Type` of the text exposition format. */
export const CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

/** Request duration buckets in seconds: LLM replies run from milliseconds (errors, embeddings) to minutes (long streams). */
export const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300];

/** How long a finished response waits for its usage report before it is recorded without one. */
const USAGE_WAIT = 10000;

const PREFIX = "llm_translator_";
const REQUESTS = `${PREFIX}requests_total`;
const DURATION = `${PREFIX}request_duration_seconds`;
const TOKENS = `${PREFIX}tokens_total`;
const ERRORS = `${PREFIX}errors_total`;
const UP = `${PREFIX}upstream_up`;

/**
 * Escape a label value: backslash, double quote and line feed.
 * @param {any} value - Label value.
 * @returns {string} Escaped text.
 */
export function escapeLabel(value) {
	return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/**
 * Escape `# HELP` text: backslash and line feed.
 * @param {string} text - Help text.
 * @returns {string} Escaped text.
 */
export function escapeHelp(text) {
	return text.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

/**
 * Format a sample value.
 * @param {number} value - Finite number or an infinity.
 * @returns {string} Exposition text.
 */
function format(value) {
	if (value === Infinity) return "+Inf";
	if (value === -Infinity) return "-Inf";
	return String(value);
}

/**
 * Render a label set as `{a="1",b="2"}` (empty string for none), keys in the order given.
 * @param {Record<string, any>} labels - Labels.
 * @returns {string} Label text.
 */
function braces(labels) {
	const pairs = Object.entries(labels).map(([name, value]) => `${name}="${escapeLabel(value)}"`);
	return pairs.length === 0 ? "" : `{${pairs.join(",")}}`;
}

/**
 * Create an empty registry.
 * @returns {{ counter: (name: string, help: string) => void, histogram: (name: string, help: string, buckets?: number[]) => void, inc: (name: string, labels: Record<string, any>, by?: number) => void, observe: (name: string, labels: Record<string, any>, value: number) => void, render: (gauges?: {name: string, help: string, samples: {labels: Record<string, any>, value: number}[]}[]) => string }} Registry.
 */
export function create() {
	/** @type {Map<string, any>} */
	const families = new Map();
	const key = (labels) => JSON.stringify(Object.entries(labels));
	return {
		/**
		 * Declare a counter.
		 * @param {string} name - Metric name.
		 * @param {string} help - Help text.
		 * @returns {void}
		 */
		counter(name, help) {
			families.set(name, { type: "counter", help, series: new Map() });
		},
		/**
		 * Declare a histogram.
		 * @param {string} name - Metric name.
		 * @param {string} help - Help text.
		 * @param {number[]} [buckets] - Upper bounds, ascending.
		 * @returns {void}
		 */
		histogram(name, help, buckets = BUCKETS) {
			families.set(name, { type: "histogram", help, buckets, series: new Map() });
		},
		/**
		 * Add to a counter series.
		 * @param {string} name - Declared counter.
		 * @param {Record<string, any>} labels - Labels.
		 * @param {number} [by] - Amount (default 1).
		 * @returns {void}
		 */
		inc(name, labels, by = 1) {
			const { series } = families.get(name);
			const id = key(labels);
			const entry = series.get(id) ?? { labels, value: 0 };
			entry.value += by;
			series.set(id, entry);
		},
		/**
		 * Record one observation in a histogram series.
		 * @param {string} name - Declared histogram.
		 * @param {Record<string, any>} labels - Labels.
		 * @param {number} value - Observation.
		 * @returns {void}
		 */
		observe(name, labels, value) {
			const { series, buckets } = families.get(name);
			const id = key(labels);
			const entry = series.get(id) ?? { labels, counts: buckets.map(() => 0), sum: 0, count: 0 };
			buckets.forEach((bound, at) => {
				if (value <= bound) entry.counts[at]++;
			});
			entry.sum += value;
			entry.count++;
			series.set(id, entry);
		},
		/**
		 * Render the exposition text. `gauges` are computed by the caller at scrape time.
		 * @param {{name: string, help: string, samples: {labels: Record<string, any>, value: number}[]}[]} [gauges] - Gauge families.
		 * @returns {string} Text in the Prometheus exposition format 0.0.4.
		 */
		render(gauges = []) {
			const lines = [];
			for (const [name, family] of families) {
				lines.push(`# HELP ${name} ${escapeHelp(family.help)}`, `# TYPE ${name} ${family.type}`);
				for (const entry of family.series.values()) {
					if (family.type === "counter") {
						lines.push(`${name}${braces(entry.labels)} ${format(entry.value)}`);
						continue;
					}
					family.buckets.forEach((bound, at) => {
						lines.push(`${name}_bucket${braces({ ...entry.labels, le: format(bound) })} ${entry.counts[at]}`);
					});
					lines.push(`${name}_bucket${braces({ ...entry.labels, le: "+Inf" })} ${entry.count}`);
					lines.push(`${name}_sum${braces(entry.labels)} ${format(entry.sum)}`);
					lines.push(`${name}_count${braces(entry.labels)} ${entry.count}`);
				}
			}
			for (const gauge of gauges) {
				lines.push(`# HELP ${gauge.name} ${escapeHelp(gauge.help)}`, `# TYPE ${gauge.name} gauge`);
				for (const sample of gauge.samples) lines.push(`${gauge.name}${braces(sample.labels)} ${format(sample.value)}`);
			}
			return `${lines.join("\n")}\n`;
		}
	};
}

/**
 * The kind of an error, or null when the request did not fail: `upstream` (the upstream answered with an error or could not be reached
 * as far as the usage report knows), `translator` (a failure in the translator itself, a 5xx or an in-band stream error) and `client`
 * (a refused request: bad body, authentication, unknown model or route). A client that left is not an error.
 * @param {number} status - HTTP status as written (499 when the client left).
 * @param {any} report - The request's usage report, or null.
 * @returns {"upstream" | "translator" | "client" | null} Kind.
 */
export function kind(status, report) {
	if (status === 499 || report?.reason === "aborted") return null;
	if (report?.reason === "upstream_error") return "upstream";
	if (report?.reason === "error") return status >= 400 && status < 500 ? "client" : "translator";
	if (status >= 500) return "translator";
	return status >= 400 ? "client" : null;
}

/**
 * Create the metrics of one server: a registry plus the request recorder and the scrape renderer. Label values stay bounded: `front` is
 * one of two protocols, `route` is the route pattern (never the URL), `driver` is a driver name, `upstream` a configured upstream name
 * and `code` an HTTP status. The model a client asked for, request ids and API keys are never labels.
 * @param {{ front: "anthropic" | "openai", endpoints: () => any[] }} source - The server's front and its runtime endpoints.
 * @returns {{ hook: (request: any, reply: any) => Promise<void>, attach: (request: any, sending: Promise<any>) => void, render: () => string }} Recorder.
 */
export function recorder(source) {
	const registry = create();
	registry.counter(
		REQUESTS,
		"Requests handled, by front protocol, route, upstream driver and HTTP status code (499 when the client left before the reply finished)."
	);
	registry.histogram(DURATION, "Seconds from the request arriving to the end of the response, streams included.");
	registry.counter(TOKENS, "Tokens reported by upstreams, by driver and type (input, output, cache_read, cache_creation).");
	registry.counter(ERRORS, "Failed requests by kind: upstream, translator or client.");
	// What a request attached about itself while it ran: the pending `send` result, from which the usage report comes.
	const pending = new WeakMap();

	/**
	 * Record a finished response.
	 * @param {any} request - Fastify request.
	 * @param {any} reply - Fastify reply.
	 * @param {bigint} start - `process.hrtime.bigint()` when the request arrived.
	 * @returns {Promise<void>} Resolves once recorded.
	 */
	const finish = async (request, reply, start) => {
		const raw = reply.raw;
		const left = !raw.writableFinished;
		const sending = pending.get(request);
		let report = null;
		if (sending) {
			let timer;
			const timeout = new Promise((resolve) => {
				timer = setTimeout(resolve, USAGE_WAIT, null);
				timer.unref();
			});
			report = await Promise.race([
				sending.then(
					(result) => result.usage,
					() => null
				),
				timeout
			]);
			clearTimeout(timer);
		}
		const seconds = Number(process.hrtime.bigint() - start) / 1e9;
		const status = left ? 499 : raw.statusCode;
		const endpoint = report?.upstream ? source.endpoints().find((entry) => entry.name === report.upstream) : undefined;
		const driver = endpoint ? String(endpoint.driver ?? "unknown") : "none";
		const labels = { front: source.front, route: request.routeOptions?.url ?? "unmatched", driver, code: status };
		registry.inc(REQUESTS, labels);
		registry.observe(DURATION, labels, seconds);
		const failure = kind(status, report);
		if (failure) registry.inc(ERRORS, { kind: failure });
		if (report?.reported) {
			for (const [type, field] of [
				["input", "input_tokens"],
				["output", "output_tokens"],
				["cache_read", "cache_read_input_tokens"],
				["cache_creation", "cache_creation_input_tokens"]
			]) {
				if (Number.isFinite(report[field]) && report[field] > 0) registry.inc(TOKENS, { driver, type }, report[field]);
			}
		}
	};

	return {
		/**
		 * `onRequest` hook: start timing and record when the response closes (also for a hijacked stream). The metrics route itself is not counted.
		 * @param {any} request - Fastify request.
		 * @param {any} reply - Fastify reply.
		 * @returns {Promise<void>} Resolves at once.
		 */
		hook: async (request, reply) => {
			if (request.routeOptions?.config?.metrics) return;
			const start = process.hrtime.bigint();
			reply.raw.once("close", () => {
				finish(request, reply, start).catch(() => {});
			});
		},
		/**
		 * Hand over the pending `send` result of a request so its usage report (driver, tokens, error kind) is recorded with it.
		 * @param {any} request - Fastify request.
		 * @param {Promise<any>} sending - Pending result of `send` or `embeddings.send`.
		 * @returns {void}
		 */
		attach: (request, sending) => {
			pending.set(request, sending);
		},
		/**
		 * Render every metric, with the upstream health gauges read now.
		 * @returns {string} Exposition text.
		 */
		render: () =>
			registry.render([
				{
					name: UP,
					help: "1 while an upstream is healthy (not backing off after a failure and not reported not ready by its readiness probe), else 0.",
					samples: source.endpoints().map((endpoint) => ({
						labels: { upstream: endpoint.name, driver: String(endpoint.driver ?? "unknown") },
						value: describe(endpoint).healthy ? 1 : 0
					}))
				}
			])
	};
}

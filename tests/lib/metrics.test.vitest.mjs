/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/metrics.test.vitest.mjs
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
 * @fileoverview Prometheus registry: exposition format, escaping, histogram buckets and the error kinds.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { health } from "../../src/lib/pool.mjs";
import { BUCKETS, create, escapeHelp, escapeLabel, kind, recorder } from "../../src/lib/metrics.mjs";

describe("escaping", () => {
	it("escapes backslash, quote and line feed in label values", () => {
		expect(escapeLabel('a\\b"c\nd')).toBe('a\\\\b\\"c\\nd');
		expect(escapeLabel(502)).toBe("502");
	});

	it("escapes backslash and line feed in help text, but not quotes", () => {
		expect(escapeHelp('a\\b"c\nd')).toBe('a\\\\b"c\\nd');
	});
});

describe("registry", () => {
	it("renders HELP and TYPE for a family without samples", () => {
		const registry = create();
		registry.counter("x_total", "Things.");
		expect(registry.render()).toBe("# HELP x_total Things.\n# TYPE x_total counter\n");
	});

	it("renders counters per label set, with escaped values", () => {
		const registry = create();
		registry.counter("x_total", "Things.");
		registry.inc("x_total", { a: 'q"1' });
		registry.inc("x_total", { a: 'q"1' }, 2);
		registry.inc("x_total", {});
		expect(registry.render()).toBe('# HELP x_total Things.\n# TYPE x_total counter\nx_total{a="q\\"1"} 3\nx_total 1\n');
	});

	it("renders cumulative histogram buckets, sum and count", () => {
		const registry = create();
		registry.histogram("d_seconds", "Time.", [0.1, 1]);
		registry.observe("d_seconds", { r: "a" }, 0.05);
		registry.observe("d_seconds", { r: "a" }, 0.5);
		registry.observe("d_seconds", { r: "a" }, 5);
		expect(registry.render().split("\n")).toEqual([
			"# HELP d_seconds Time.",
			"# TYPE d_seconds histogram",
			'd_seconds_bucket{r="a",le="0.1"} 1',
			'd_seconds_bucket{r="a",le="1"} 2',
			'd_seconds_bucket{r="a",le="+Inf"} 3',
			'd_seconds_sum{r="a"} 5.55',
			'd_seconds_count{r="a"} 3',
			""
		]);
	});

	it("renders gauges passed at scrape time and formats infinities", () => {
		const registry = create();
		const text = registry.render([
			{
				name: "g",
				help: "Gauge.",
				samples: [
					{ labels: { u: "a" }, value: 1 },
					{ labels: {}, value: Infinity },
					{ labels: {}, value: -Infinity }
				]
			}
		]);
		expect(text).toBe('# HELP g Gauge.\n# TYPE g gauge\ng{u="a"} 1\ng +Inf\ng -Inf\n');
	});

	it("has ascending buckets", () => {
		expect([...BUCKETS].sort((a, b) => a - b)).toEqual(BUCKETS);
	});
});

describe("kind", () => {
	it.each([
		[200, { reason: "done" }, null],
		[200, null, null],
		[499, null, null],
		[200, { reason: "aborted" }, null],
		[502, { reason: "upstream_error" }, "upstream"],
		[400, { reason: "upstream_error" }, "upstream"],
		[400, { reason: "error" }, "client"],
		[502, { reason: "error" }, "translator"],
		[200, { reason: "error" }, "translator"],
		[500, null, "translator"],
		[401, null, "client"],
		[404, null, "client"]
	])("status %i with %j is %j", (status, report, expected) => {
		expect(kind(status, report)).toBe(expected);
	});
});

describe("recorder", () => {
	/**
	 * A request/reply pair as far as the recorder reads them.
	 * @param {number} [statusCode] - Status the response carries.
	 * @returns {{request: any, reply: any}} Pair.
	 */
	const pair = (statusCode = 200) => {
		const raw = Object.assign(new EventEmitter(), { statusCode, writableFinished: true });
		return { request: { routeOptions: { url: "/v1/messages" } }, reply: { raw } };
	};
	const endpoints = [{ name: "a", driver: null, health: health() }];
	const text = async (source, run) => {
		const watch = recorder(source);
		const { request, reply } = pair();
		await watch.hook(request, reply);
		run(watch, request);
		reply.raw.emit("close");
		await vi.waitFor(() => expect(watch.render()).toContain("requests_total{"));
		return watch.render();
	};

	it("labels an endpoint whose driver is not detected yet as unknown", async () => {
		const out = await text({ front: "openai", endpoints: () => endpoints }, (watch, request) =>
			watch.attach(request, Promise.resolve({ usage: { upstream: "a", reason: "done", reported: true, input_tokens: 3 } }))
		);
		expect(out).toContain('driver="unknown",code="200"} 1');
		expect(out).toContain('llm_translator_tokens_total{driver="unknown",type="input"} 3');
		expect(out).toContain('llm_translator_upstream_up{upstream="a",driver="unknown"} 1');
	});

	it("records without a report when the send rejected", async () => {
		const out = await text({ front: "openai", endpoints: () => endpoints }, (watch, request) =>
			watch.attach(request, Promise.reject(new Error("gone")))
		);
		expect(out).toContain('driver="none",code="200"} 1');
	});

	it("records without a report when the usage never settles", async () => {
		vi.useFakeTimers();
		try {
			const watch = recorder({ front: "openai", endpoints: () => endpoints });
			const { request, reply } = pair();
			await watch.hook(request, reply);
			watch.attach(request, new Promise(() => {}));
			reply.raw.emit("close");
			await vi.advanceTimersByTimeAsync(10001);
			expect(watch.render()).toContain('driver="none",code="200"} 1');
		} finally {
			vi.useRealTimers();
		}
	});

	it("never lets a failed recording escape as an unhandled rejection", async () => {
		const watch = recorder({
			front: "openai",
			endpoints: () => {
				throw new Error("state gone");
			}
		});
		const { request, reply } = pair();
		await watch.hook(request, reply);
		watch.attach(request, Promise.resolve({ usage: { upstream: "a", reason: "done" } }));
		reply.raw.emit("close");
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(() => watch.render()).toThrow("state gone");
	});

	it("labels a route the router did not name as unmatched", async () => {
		const watch = recorder({ front: "openai", endpoints: () => [] });
		const { reply } = pair();
		const request = { routeOptions: {} };
		await watch.hook(request, reply);
		reply.raw.emit("close");
		await vi.waitFor(() => expect(watch.render()).toContain('route="unmatched"'));
	});
});

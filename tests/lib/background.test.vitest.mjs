/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/lib/background.test.vitest.mjs
 *	@Date: 2026-11-23T12:00:00-08:00 (1795550400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-23T12:00:00-08:00 (1795550400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Background jobs: running a response to the end, keeping and following its events, cancelling.
 */

import { describe, expect, test } from "vitest";
import { cancel, create, end, follow, run } from "../../src/lib/background.mjs";

const event = (type, sequence, response) => ({ event: type, data: { type, sequence_number: sequence, ...(response ? { response } : {}) } });
const snapshot = (status, extra = {}) => ({ id: "resp_1", status, output: [], ...extra });
const collect = async (iterable) => {
	const out = [];
	for await (const item of iterable) out.push(item);
	return out;
};
async function* events(list) {
	yield* list;
}
const parts = (overrides = {}) => {
	const saved = [];
	return {
		saved,
		snapshot,
		sending: async () => ({ status: 200, body: { ok: true } }),
		toResponse: async () => snapshot("completed", { output: [1] }),
		toEvents: (source) => source,
		save: async (response) => void saved.push(response.status),
		...overrides
	};
};

describe("run", () => {
	test("a plain response: in progress, then its conversion, kept", async () => {
		const jobs = new Map();
		const job = create("resp_1", false);
		jobs.set("resp_1", job);
		const p = parts();
		await run(jobs, job, p);
		expect(p.saved).toEqual(["in_progress", "completed"]);
		expect(job).toMatchObject({ done: true, events: [] });
	});

	test("an upstream error answers a failed response with its message", async () => {
		const job = create("resp_1", false);
		const p = parts({ sending: async () => ({ status: 429, body: { error: { code: "rate_limited", message: "slow down" } } }) });
		await run(new Map(), job, p);
		expect(p.saved).toEqual(["in_progress", "failed"]);
		const odd = parts({ sending: async () => ({ status: 500, body: "plain text" }) });
		await run(new Map(), create("resp_1", false), odd);
		expect(odd.saved).toEqual(["in_progress", "failed"]);
	});

	test("anything thrown becomes a failed response, and a response that cannot be kept does not stop the job", async () => {
		const p = parts({
			sending: async () => {
				throw new Error("boom");
			}
		});
		const job = create("resp_1", false);
		await run(new Map(), job, p);
		expect(p.saved).toEqual(["in_progress", "failed"]);
		const lost = parts({
			save: async (response) => {
				if (response.status === "completed") throw new Error("disk full");
			}
		});
		const other = create("resp_1", false);
		await run(new Map(), other, lost);
		expect(other.done).toBe(true);
	});

	test("a stream is kept event by event and ends with its own closing event", async () => {
		const job = create("resp_1", true);
		const list = [
			event("response.created", 0, snapshot("in_progress")),
			event("response.output_text.delta", 1),
			event("response.completed", 2, snapshot("completed"))
		];
		const p = parts({ sending: async () => ({ stream: events(list) }) });
		await run(new Map(), job, p);
		expect(job.events).toEqual(list);
		expect(p.saved).toEqual(["in_progress", "completed"]);
	});

	test("a streamed response whose upstream failed gets the closing event it lacks", async () => {
		const job = create("resp_1", true);
		await run(new Map(), job, parts({ sending: async () => ({ status: 500, body: { error: { message: "no" } } }) }));
		expect(job.events).toHaveLength(1);
		expect(job.events[0]).toMatchObject({
			event: "response.failed",
			data: { type: "response.failed", sequence_number: 0, response: { status: "failed", error: { message: "no" } } }
		});
		const broken = create("resp_1", true);
		const list = [event("response.created", 0, snapshot("in_progress")), event("response.output_text.delta", 1)];
		async function* failing() {
			yield* list;
			throw new Error("cut");
		}
		await run(new Map(), broken, parts({ sending: async () => ({ stream: failing() }) }));
		expect(broken.events.at(-1)).toMatchObject({ event: "response.failed", data: { sequence_number: 2 } });
	});

	test("cancelling before the upstream answers, or while a stream runs, ends the job without keeping anything", async () => {
		const jobs = new Map();
		const early = create("resp_1", true);
		jobs.set("resp_1", early);
		const p = parts({
			sending: async (signal) => {
				cancel(jobs, early);
				expect(signal.aborted).toBe(true);
				return { status: 200, body: {} };
			}
		});
		await run(jobs, early, p);
		expect(p.saved).toEqual(["in_progress"]);
		expect(early).toMatchObject({ cancelled: true, done: true, events: [] });
		const late = create("resp_2", true);
		async function* slow() {
			yield event("response.created", 0, snapshot("in_progress"));
			cancel(jobs, late);
			yield event("response.output_text.delta", 1);
		}
		const q = parts({ sending: async () => ({ stream: slow() }) });
		await run(jobs, late, q);
		expect(late.events).toHaveLength(1);
		expect(q.saved).toEqual(["in_progress"]);
		const thrown = create("resp_3", false);
		const r = parts({
			sending: async () => {
				cancel(jobs, thrown);
				throw new Error("aborted");
			}
		});
		await run(jobs, thrown, r);
		expect(r.saved).toEqual(["in_progress"]);
	});
});

describe("follow", () => {
	test("replays the events, from after a sequence number, then waits for new ones until the job ends", async () => {
		const jobs = new Map();
		const job = create("resp_1", true);
		job.events.push(event("a", 0), event("b", 1));
		const seen = [];
		const reading = (async () => {
			for await (const item of follow(job, 0)) seen.push(item.data.type);
		})();
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(seen).toEqual(["b"]);
		job.events.push(event("c", 2));
		for (const waiter of job.waiters) waiter();
		await new Promise((resolve) => setTimeout(resolve, 5));
		expect(seen).toEqual(["b", "c"]);
		end(jobs, job);
		await reading;
		expect(seen).toEqual(["b", "c"]);
		expect((await collect(follow(job))).map((item) => item.data.type)).toEqual(["a", "b", "c"]);
	});
});

describe("end", () => {
	test("is safe twice, and forgets the oldest finished jobs past the limit but never a running one", () => {
		const jobs = new Map();
		const running = create("running", false);
		jobs.set("running", running);
		const made = Array.from({ length: 34 }, (_, index) => create(`job${index}`, false));
		for (const job of made) {
			jobs.set(job.id, job);
			end(jobs, job);
			end(jobs, job);
		}
		expect(jobs.has("running")).toBe(true);
		expect(jobs.has("job0")).toBe(false);
		expect(jobs.has("job1")).toBe(false);
		expect(jobs.has("job2")).toBe(true);
		expect(jobs.size).toBe(33);
	});
});

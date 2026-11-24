/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/background.mjs
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
 * @fileoverview Background Responses: a job runs a response to the end whether or not a client is connected, keeps the events of a streamed one so a
 * client can read them again from any point, and can be cancelled.
 * @module @cldmv/llm-translator/lib/background
 */
import { failureOf } from "./responses.mjs";

/** The events that end a response stream. */
const ENDINGS = ["response.completed", "response.incomplete", "response.failed"];

/** Finished jobs whose events stay readable; older ones are forgotten (their responses stay in the store). */
const KEEP = 32;

/**
 * Make a job.
 * @param {string} id - Response id.
 * @param {boolean} streaming - Whether the response was asked for with `stream: true` (its events are kept).
 * @returns {{ id: string, streaming: boolean, controller: AbortController, events: any[], done: boolean, cancelled: boolean, waiters: Set<() => void> }} Job.
 */
export function create(id, streaming) {
	return { id, streaming, controller: new AbortController(), events: [], done: false, cancelled: false, waiters: new Set() };
}

/**
 * Wake whoever waits for the job to move on.
 * @param {{ waiters: Set<() => void> }} job - Job.
 */
function wake(job) {
	for (const waiter of job.waiters) waiter();
	job.waiters.clear();
}

/**
 * Mark a job finished and forget the oldest finished ones. Safe to call twice.
 * @param {Map<string, any>} jobs - The translator's jobs.
 * @param {any} job - Job.
 */
export function end(jobs, job) {
	job.done = true;
	wake(job);
	const finished = [...jobs.values()].filter((entry) => entry.done);
	for (const old of finished.slice(0, Math.max(0, finished.length - KEEP))) jobs.delete(old.id);
}

/**
 * Cancel a job: abort its upstream request and end it. What it had gathered is dropped.
 * @param {Map<string, any>} jobs - The translator's jobs.
 * @param {any} job - Job.
 */
export function cancel(jobs, job) {
	job.cancelled = true;
	job.controller.abort();
	end(jobs, job);
}

/**
 * The events of a job from the one after `after` (a `sequence_number`), then each new one, until the job ends.
 * @param {any} job - Job.
 * @param {number} [after] - `sequence_number` to start after; -1 for all.
 * @returns {AsyncGenerator<any>} Events.
 */
export async function* follow(job, after = -1) {
	let at = 0;
	for (;;) {
		while (at < job.events.length) {
			const event = job.events[at++];
			if (event.data.sequence_number > after) yield event;
		}
		if (job.done) return;
		await new Promise((resolve) => job.waiters.add(resolve));
	}
}

/**
 * Run a background response to the end. Never rejects: whatever goes wrong becomes a `failed` response.
 * @param {Map<string, any>} jobs - The translator's jobs.
 * @param {any} job - Job.
 * @param {object} parts - What the run needs.
 * @param {(status: string, extra?: any) => any} parts.snapshot - The response object in a status (no output unless `extra` has it).
 * @param {(signal: AbortSignal) => Promise<any>} parts.sending - Send the request upstream; resolves to the `send` result.
 * @param {(body: any) => Promise<any>} parts.toResponse - Convert a non-streaming upstream body to the response object.
 * @param {(source: AsyncIterable<any>) => AsyncIterable<any>} parts.toEvents - Convert an upstream stream to Responses events.
 * @param {(response: any) => Promise<void>} parts.save - Keep the response (its progress, and its end).
 * @returns {Promise<void>} Resolves when the job is over.
 */
export async function run(jobs, job, { snapshot, sending, toResponse, toEvents, save }) {
	/** @type {any} */
	let last;
	try {
		await save(snapshot("in_progress"));
		const result = await sending(job.controller.signal);
		if (!job.cancelled) {
			if (result.stream) {
				for await (const event of toEvents(result.stream)) {
					if (job.cancelled) break;
					job.events.push(event);
					wake(job);
					last = event.data.response ?? last;
				}
			} else if (result.status >= 400) {
				last = snapshot("failed", { error: failureOf(result.body?.error) });
			} else {
				last = await toResponse(result.body);
			}
		}
	} catch (error) {
		last = snapshot("failed", { error: failureOf(error) });
	}
	if (job.cancelled) return end(jobs, job);
	// A streamed response that ends without its own closing event (the upstream failed before one) gets the one event that says so.
	if (job.streaming && !ENDINGS.includes(job.events.at(-1)?.data.type)) {
		const sequence = (job.events.at(-1)?.data.sequence_number ?? -1) + 1;
		job.events.push({
			event: `response.${last.status}`,
			data: { type: `response.${last.status}`, response: last, sequence_number: sequence }
		});
	}
	try {
		await save(last);
	} catch {
		// A response that cannot be kept is lost to later retrievals; the job's events are still served from memory.
	}
	end(jobs, job);
}

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/fanout.mjs
 *	@Date: 2026-11-08T12:00:00-08:00 (1794254400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-08T12:00:00-08:00 (1794254400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview `n` above 1 on the OpenAI front, answered by `n` parallel upstream requests when the upstream speaks the Anthropic
 * protocol (which has no `n`): the branches run as ordinary single-choice requests, and their replies are combined into one reply
 * with the choices numbered 0 to n-1 and the usage summed.
 * @module @cldmv/llm-translator/lib/fanout
 */
import { TranslatorError, openaiError } from "./errors.mjs";
import { resolve } from "./route.mjs";
import { combine, deliver } from "./usage.mjs";

/** The largest `n` that is fanned out (OpenAI's own limit for the parameter). */
export const MAX = 128;

const DONE = { data: "[DONE]" };

/**
 * How many branches a request needs: `n` when the OpenAI-front body asks for more than one choice and the router would send it to an
 * Anthropic-protocol upstream, else 0 (the request goes the normal way: an OpenAI-protocol upstream handles `n` itself, and a value
 * that is not an integer above 1 is left to the converter's own validation). The decision is made on the endpoint the router picks
 * first; each branch is then routed and failed over like any request.
 * @param {any} c - Captured translator parts (`capture`).
 * @param {any} body - Client request body.
 * @returns {number} Branch count, or 0 for no fan-out.
 * @throws {TranslatorError} `invalid_request` when `n` is above {@link MAX}.
 */
export function wants(c, body) {
	if (c.front !== "openai" || !body || typeof body !== "object" || Array.isArray(body)) return 0;
	if (!Number.isInteger(body.n) || body.n < 2) return 0;
	if (resolve(c, body).convert === null) return 0;
	if (body.n > MAX) throw new TranslatorError(`n: at most ${MAX} choices`, { code: "invalid_request", param: "n" });
	return body.n;
}

/**
 * Add two usage objects field by field (numbers add, nested objects such as `prompt_tokens_details` recurse, a field only one side has is kept).
 * @param {any} left - Usage object.
 * @param {any} right - Usage object.
 * @returns {any} The sum.
 */
export function add(left, right) {
	if (typeof left === "number" && typeof right === "number") return left + right;
	if (left && right && typeof left === "object" && typeof right === "object") {
		const out = { ...left };
		for (const key of Object.keys(right)) out[key] = key in left ? add(left[key], right[key]) : right[key];
		return out;
	}
	return left ?? right;
}

/**
 * Combine the replies of the branches of a non-streaming request: the first branch's reply with every branch's choice, numbered by
 * branch, and the usage summed.
 * @param {any[]} bodies - Chat completion bodies, one per branch, in order.
 * @returns {any} The combined body.
 */
export function join(bodies) {
	const choices = bodies.flatMap((body, index) => (body.choices ?? []).map((choice) => ({ ...choice, index })));
	const usage = bodies.map((body) => body.usage).reduce((sum, value) => (sum === undefined ? value : add(sum, value)), undefined);
	return { ...bodies[0], choices, ...(usage === undefined ? {} : { usage }) };
}

/**
 * Read a branch stream to its end, so the branch settles its own report (an error chunk is followed by `[DONE]` and the end of the
 * stream, and the report then says `error` instead of `aborted`).
 * @param {AsyncIterator<any>} iterator - Branch stream iterator.
 * @returns {Promise<void>} Resolves when the stream has ended or failed.
 */
async function finished(iterator) {
	try {
		while (!(await iterator.next()).done);
	} catch {
		// A branch that fails while it is being finished has already reported that failure.
	}
}

/**
 * Merge the streams of the branches into one: chunks go out as they arrive from any branch, each re-indexed to its branch and carrying
 * the first chunk's id; the branches' own `[DONE]` sentinels and usage chunks are held back, and the stream ends with one usage chunk
 * holding the sum (when the branches sent one) and a single `[DONE]`. A branch that sends an error chunk or throws ends the merged
 * stream the way the stream converter ends a failed one: the error chunk, then `[DONE]`; the other branches are cancelled. Closing
 * the merged stream early cancels every branch.
 * @param {AsyncIterable<{event?: string, data: any}>[]} streams - Branch streams, in choice order.
 * @param {() => void} abort - Aborts the branches' requests.
 * @param {(index: number) => void} trip - Called with the index of the branch whose failure ended the stream.
 * @returns {AsyncIterableIterator<{event?: string, data: any}>} Merged stream, closable with `return()`.
 */
export function weave(streams, abort, trip) {
	const iterators = streams.map((stream) => stream[Symbol.asyncIterator]());
	let closed = false;
	/**
	 * Cancel every branch (idempotent).
	 * @returns {Promise<void>} Resolves once every branch was told to stop.
	 */
	const close = async () => {
		if (closed) return;
		closed = true;
		abort();
		await Promise.allSettled(iterators.map((iterator) => iterator.return?.()));
	};
	const generator = (async function* () {
		const pending = new Map();
		const arm = (index) =>
			pending.set(
				index,
				iterators[index].next().then(
					(step) => ({ index, step }),
					(error) => ({ index, error })
				)
			);
		iterators.forEach((_, index) => arm(index));
		let id;
		let last;
		let usage;
		try {
			while (pending.size > 0) {
				const { index, step, error } = await Promise.race(pending.values());
				pending.delete(index);
				if (error) {
					trip(index);
					yield { data: openaiError(String(error?.message ?? error), { type: error?.type ?? "server_error" }) };
					yield DONE;
					return;
				}
				if (step.done) continue;
				arm(index);
				const data = step.value?.data;
				if (data === "[DONE]") continue;
				if (data?.error) {
					trip(index);
					yield step.value;
					await finished(iterators[index]);
					yield DONE;
					return;
				}
				if (Array.isArray(data?.choices) && data.choices.length === 0 && data.usage) {
					last = data;
					usage = usage === undefined ? data.usage : add(usage, data.usage);
					continue;
				}
				id ??= data?.id;
				yield { ...step.value, data: { ...data, id, choices: data.choices.map((choice) => ({ ...choice, index })) } };
			}
			if (usage !== undefined) yield { data: { ...last, id, choices: [], usage } };
			yield DONE;
		} finally {
			await close();
		}
	})();
	return {
		[Symbol.asyncIterator]() {
			return this;
		},
		next: () => generator.next(),
		async return(value) {
			await close();
			return generator.return(value);
		},
		async throw(cause) {
			await close();
			return generator.throw(cause);
		}
	};
}

/**
 * Answer a request with `count` parallel single-choice requests. Each branch is a full `send` of the body with `n: 1` (so it is routed,
 * failed over, captured and metered like any request, and its own `onUsage` feeds the combined report). The first branch to fail
 * (an error reply, or a thrown error such as an abort) ends the request: the others are aborted, the failure is the reply (or is
 * rethrown), and the streams of branches that had already started are closed so their usage settles. The caller's signal cancels every
 * branch. A branch that fails after the stream has started is handled by {@link weave}.
 * @param {object} spec - `{ body, count, options, send, warn }`.
 * @param {any} spec.body - Client request body (`n` above 1).
 * @param {number} spec.count - Number of branches.
 * @param {any} spec.options - The `send` options of the request.
 * @param {(body: any, options: any) => Promise<any>} spec.send - The single-request send.
 * @param {(message: string, details: {kind: "threw" | "rejected"}) => void} spec.warn - Receives a message when `onUsage` throws or rejects.
 * @returns {Promise<any>} The reply, with a non-enumerable `usage` promise of the combined report.
 */
export async function run({ body, count, options, send, warn }) {
	const controller = new AbortController();
	const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
	const waits = Array.from({ length: count }, () => {
		let resolve;
		const promise = new Promise((done) => {
			resolve = done;
		});
		return { promise, resolve };
	});
	let lead = -1;
	/**
	 * Record the branch whose failure ends the request, and abort the rest.
	 * @param {number} index - Branch index.
	 * @returns {void}
	 */
	const trip = (index) => {
		if (lead >= 0) return;
		lead = index;
		controller.abort();
	};
	const usage = Promise.all(waits.map((wait) => wait.promise)).then((reports) => {
		const report = combine(reports, lead);
		deliver(report, options.onUsage, warn);
		return report;
	});
	const attach = (reply) => Object.defineProperty(reply, "usage", { value: usage, enumerable: false, configurable: true });
	/** @type {{reply?: any, error?: any}[]} */
	const outcomes = await Promise.all(
		waits.map((wait, index) =>
			send({ ...body, n: 1 }, { ...options, signal, onUsage: wait.resolve }).then(
				(reply) => {
					if (reply.status >= 400) trip(index);
					return { reply };
				},
				(error) => {
					trip(index);
					return { error };
				}
			)
		)
	);
	if (lead >= 0) {
		// Streams that were already accepted are never read: close them so each branch's report is delivered.
		await Promise.all(outcomes.map((outcome) => outcome.reply?.stream?.return?.()));
		await usage;
		const failed = outcomes[lead];
		if ("error" in failed) throw failed.error;
		return attach(failed.reply);
	}
	const replies = outcomes.map((outcome) => outcome.reply);
	if (body.stream === true) {
		const merged = weave(
			replies.map((reply) => reply.stream),
			() => controller.abort(),
			trip
		);
		return attach({ status: 200, headers: replies[0].headers, stream: merged });
	}
	await usage;
	return attach({ status: 200, headers: replies[0].headers, body: join(replies.map((reply) => reply.body)) });
}

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/batch-run.mjs
 *	@Date: 2026-11-22T12:00:00-08:00 (1795464000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T12:00:00-08:00 (1795464000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The batch runner shared by both Batch APIs: it keeps the batch store, runs a batch's requests in the background through the translator's
 * normal request path (`send`, the Responses converters and the embeddings forward) with bounded concurrency, and finishes a batch on completion,
 * cancellation, expiry or shutdown.
 * @module @cldmv/llm-translator/lib/batch-run
 */
import { randomBytes } from "node:crypto";
import { TranslatorError } from "./errors.mjs";
import { capture } from "./capture.mjs";
import { create as createStore, newId as newBatchId } from "./batchstore.mjs";
import { newId as newFileId } from "./filestore.mjs";
import { storeOf } from "./files.mjs";
import { anthropicBatch, anthropicItems, disabled, missing, openaiBatch, openaiParams, parseInput, problem } from "./batches.mjs";
import { resolve as routeTo } from "./route.mjs";
import { resolve as settingsOf } from "./settings.mjs";
import { emit } from "./events.mjs";

/** The longest delay a timer takes (a 32-bit count of ms). */
const MAX_TIMER = 2 ** 31 - 1;

/**
 * A counting semaphore whose waits can be abandoned: the slots that bound how many batch requests run against the upstreams at once, across batches.
 * @param {number} limit - Slots.
 * @returns {{ acquire: (signal: AbortSignal) => Promise<boolean>, release: () => void }} Semaphore; `acquire` answers false when the signal aborts while it waits.
 */
export function semaphore(limit) {
	let free = limit;
	const waiting = [];
	return {
		acquire(signal) {
			if (free > 0) {
				free -= 1;
				return Promise.resolve(true);
			}
			return new Promise((resolve) => {
				const waiter = () => {
					signal.removeEventListener("abort", leave);
					resolve(true);
				};
				const leave = () => {
					waiting.splice(waiting.indexOf(waiter), 1);
					resolve(false);
				};
				waiting.push(waiter);
				signal.addEventListener("abort", leave, { once: true });
			});
		},
		release() {
			const next = waiting.shift();
			if (next === undefined) free += 1;
			else next();
		}
	};
}

/**
 * A token count of a usage report: a whole number, 0 for anything that is not one (`| 0` turns `null` and `undefined` into 0).
 * @param {any} value - The report's field.
 * @returns {number} Tokens.
 */
const tokens = (value) => Number(value) | 0;

/**
 * The reply of a request that failed before or outside `send` (a conversion error, a thrown exception), in the front's error shape.
 * @param {"anthropic" | "openai"} front - Client protocol.
 * @param {any} cause - What was thrown.
 * @returns {{ status: number, body: any, usage: Promise<any> }} Reply.
 */
function failure(front, cause) {
	const error = cause instanceof TranslatorError ? cause : new TranslatorError(String(cause.message), { status: 500 });
	return { status: error.status, body: front === "openai" ? error.toOpenAI() : error.toAnthropic(), usage: Promise.resolve({}) };
}

/**
 * Start the runner for a translator.
 * @param {any} self - The api (`self` of a leaf).
 * @param {any} context - Leaf context (`config`, `state`).
 * @param {import("./batchstore.mjs").BatchesSetting} setting - The `batches` setting.
 * @returns {any} Runner.
 */
function start(self, context, setting) {
	const { config, state } = context;
	// Everything a run needs later is captured now: `self` and `context` only work synchronously inside a leaf call.
	const captured = capture(self, context, "openai");
	const { send } = self;
	const embed = self.embeddings.send;
	const responses = {
		request: self.convert.openai.responses.to.openai.chat.request,
		response: self.convert.openai.chat.to.openai.responses.response
	};
	const filter = config.settings.passthroughFilter !== false;
	const store = createStore(setting);
	const slots = semaphore(setting.concurrency);
	const running = new Map();
	const now = Date.now;

	/**
	 * Make one request of a batch. Never throws: a request that cannot be made is an error reply.
	 * @param {any} record - The batch.
	 * @param {any} item - The request.
	 * @param {AbortSignal} signal - Aborts the request.
	 * @returns {Promise<any>} The reply (`{ status, body, usage }`).
	 */
	const call = async (record, item, signal) => {
		try {
			if (record.front === "anthropic") {
				if (item.request.stream === true) {
					throw new TranslatorError("stream: Streaming is not supported in batches", {
						code: "invalid_request",
						status: 400,
						param: "stream"
					});
				}
				return await send(item.request, { front: "anthropic", signal, filter });
			}
			const { url, body } = item.request;
			if (url === "/v1/embeddings") return await embed(body, { signal });
			if (url === "/v1/chat/completions") return await send(body, { front: "openai", signal, filter });
			const routed = routeTo(captured, body, { wire: "responses" });
			const settings = captured.settings(routed.endpoint, routed.protocol);
			const converted = await responses.request(body, settings);
			const reply = await send(converted.body, { front: "openai", wire: "responses", signal, filter });
			if (reply.status >= 400) return reply;
			// `usage` is not enumerable on a reply, so a copy has to carry it by hand.
			return { status: reply.status, body: await responses.response(reply.body, converted.state, settings), usage: reply.usage };
		} catch (cause) {
			return failure(record.front, cause);
		}
	};

	/**
	 * Record the outcome of a request on its batch.
	 * @param {any} record - The batch.
	 * @param {any} item - The request.
	 * @param {"succeeded" | "errored" | "canceled" | "expired"} outcome - What happened to it.
	 * @param {any} result - Its result (Message Batches' `result` object, or OpenAI's output or error line).
	 * @returns {void}
	 */
	const settle = (record, item, outcome, result) => {
		item.outcome = outcome;
		item.result = result;
		item.request = null;
		record.counts.pending -= 1;
		record.counts[outcome] += 1;
	};

	/**
	 * Make the result of a request from its reply.
	 * @param {any} record - The batch.
	 * @param {any} item - The request.
	 * @param {{ status: number, body: any, usage: Promise<any> }} reply - The reply.
	 * @returns {Promise<void>} Resolves when the batch has the result.
	 */
	const answer = async (record, item, reply) => {
		const ok = reply.status < 400;
		const report = await reply.usage;
		record.usage.input += tokens(report.input_tokens);
		record.usage.output += tokens(report.output_tokens);
		record.usage.cached += tokens(report.cache_read_input_tokens);
		if (record.front === "anthropic") {
			settle(
				record,
				item,
				ok ? "succeeded" : "errored",
				ok ? { type: "succeeded", message: reply.body } : { type: "errored", error: reply.body }
			);
			return;
		}
		const line = {
			id: `batch_req_${randomBytes(12).toString("hex")}`,
			custom_id: item.custom_id,
			response: { status_code: reply.status, request_id: `req_${randomBytes(12).toString("hex")}`, body: reply.body },
			error: null
		};
		settle(record, item, ok ? "succeeded" : "errored", line);
	};

	/**
	 * Take requests one by one, each within a slot, until none are left or the batch is stopped.
	 * @param {any} record - The batch.
	 * @param {any} run - The run (`controller`, `next`).
	 * @returns {Promise<void>} Resolves when the worker is done.
	 */
	const worker = async (record, run) => {
		const { signal } = run.controller;
		while (!signal.aborted) {
			const item = record.items[run.next];
			if (item === undefined) return;
			run.next += 1;
			// A request taken but not run (the batch was stopped while it waited for a slot) stays without an outcome and is ended with the batch.
			if (!(await slots.acquire(signal))) return;
			try {
				const reply = await call(record, item, signal);
				// A reply that arrives after the batch was stopped is the abort itself (or a request that finished too late to count).
				if (!signal.aborted) await answer(record, item, reply);
			} finally {
				slots.release();
			}
		}
	};

	/**
	 * Read and check an OpenAI batch's input file. Problems fail the batch; a batch stopped meanwhile goes on to be finished as stopped.
	 * @param {any} record - The batch.
	 * @param {Buffer} data - The input file.
	 * @returns {boolean} Whether the batch can run.
	 */
	const validate = (record, data) => {
		const { items, errors } = parseInput(data.toString("utf8"), record.endpoint, setting.maxRequests);
		if (errors.length > 0) {
			record.errors = errors;
			return false;
		}
		record.items = items;
		record.counts.pending = items.length;
		record.model = typeof items[0].request.body.model === "string" ? items[0].request.body.model : null;
		return true;
	};

	/**
	 * End a batch: requests that did not run get their result, OpenAI batches write their output and error files, the batch takes its final state and is saved.
	 * @param {any} record - The batch.
	 * @param {any} run - The run.
	 * @param {string} outcome - `completed`, or `failed` when the input file was refused.
	 * @returns {Promise<void>} Resolves when the batch is saved.
	 */
	const finish = async (record, run, outcome) => {
		clearTimeout(run.timer);
		const expired = record.reason === "expired";
		let final = outcome;
		if (record.reason !== null) final = expired ? "expired" : "cancelled";
		const unrun = expired ? "expired" : "canceled";
		const why = expired
			? { code: "batch_expired", message: "This request could not be run before the batch expired." }
			: { code: "batch_cancelled", message: "The batch was cancelled before this request ran." };
		for (const item of record.items) {
			if (item.outcome !== null) continue;
			const line = { id: `batch_req_${randomBytes(12).toString("hex")}`, custom_id: item.custom_id, response: null, error: why };
			settle(record, item, unrun, record.front === "anthropic" ? { type: unrun } : line);
		}
		if (record.front === "openai" && record.items.length > 0) {
			const files = storeOf(config, state);
			const write = async (outcomes, purpose, suffix) => {
				const lines = record.items.filter((item) => outcomes.includes(item.outcome)).map((item) => `${JSON.stringify(item.result)}\n`);
				if (lines.length === 0) return null;
				const meta = await files.put({
					id: newFileId("openai"),
					filename: `${record.id}_${suffix}.jsonl`,
					mimeType: "application/jsonl",
					purpose,
					data: Buffer.from(lines.join("")),
					expiresIn: record.output_expires_after ?? undefined
				});
				return meta.id;
			};
			try {
				record.output_file_id = await write(["succeeded"], "batch_output", "output");
				record.error_file_id = await write(["errored", "canceled", "expired"], "batch_error", "error");
			} catch (cause) {
				record.errors = [{ code: cause.code, message: String(cause.message), line: null, param: null }];
				final = "failed";
			}
		}
		record.state = final;
		record.at.ended = now();
		await store.save(record);
	};

	/**
	 * Run a batch from its start to its end.
	 * @param {any} record - The batch.
	 * @param {any} run - The run.
	 * @param {Buffer | null} input - The input file (OpenAI batches).
	 * @returns {Promise<void>} Resolves when the batch has ended.
	 */
	const drive = async (record, run, input) => {
		if (record.front === "openai" && !validate(record, /** @type {Buffer} */ (input))) {
			await finish(record, run, "failed");
			return;
		}
		record.state = "in_progress";
		record.at.in_progress = now();
		const workers = Array.from({ length: Math.min(setting.concurrency, record.items.length) }, () => worker(record, run));
		await Promise.all(workers);
		if (record.reason === null) {
			record.state = "finalizing";
			record.at.finalizing = now();
		}
		await finish(record, run, "completed");
	};

	/**
	 * Stop a run for a reason (the first reason stays): its requests are aborted, the batch ends once they have settled.
	 * @param {any} run - The run.
	 * @param {"cancelled" | "expired" | "shutdown"} reason - Why.
	 * @returns {void}
	 */
	function halt(run, reason) {
		if (run.record.reason !== null) return;
		run.record.reason = reason;
		clearTimeout(run.timer);
		run.controller.abort();
	}

	return {
		setting,
		store,
		running,
		/** Resolves once batches that an earlier process left running are ended. */
		ready: null,
		/**
		 * Make and store a batch record.
		 * @param {"anthropic" | "openai"} front - Client protocol.
		 * @param {any} fields - Front-specific fields (`items`, `endpoint`, `input_file_id`, `metadata`, `output_expires_after`).
		 * @returns {Promise<any>} The stored record.
		 */
		async open(front, fields) {
			const created = now();
			const record = {
				id: newBatchId(front),
				front,
				state: front === "openai" ? "validating" : "in_progress",
				created_at: created,
				expires_at: created + setting.window * 1000,
				keep_until: setting.ttl === 0 ? null : created + setting.ttl * 1000,
				at: { in_progress: front === "openai" ? null : created, finalizing: null, cancelling: null, ended: null },
				reason: null,
				counts: { pending: 0, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
				usage: { input: 0, output: 0, cached: 0 },
				endpoint: null,
				model: null,
				input_file_id: null,
				output_file_id: null,
				error_file_id: null,
				errors: null,
				metadata: null,
				output_expires_after: null,
				items: [],
				...fields
			};
			record.counts.pending = record.items.length;
			await store.add(record);
			return record;
		},
		/**
		 * Start running a stored batch in the background.
		 * @param {any} record - The batch.
		 * @param {Buffer | null} [input] - The input file of an OpenAI batch.
		 * @returns {void}
		 */
		submit(record, input = null) {
			const run = { record, controller: new AbortController(), next: 0, timer: null, done: null };
			// A batch's end of life is a timer on the run, cleared when the batch ends and never held open for the process.
			const wait = Math.min(Math.max(record.expires_at - now(), 0), MAX_TIMER);
			run.timer = setTimeout(halt, wait, run, "expired");
			run.timer.unref();
			running.set(record.id, run);
			run.done = drive(record, run, input)
				.catch(async (cause) => {
					const message = `Batch ${record.id} failed: ${String(cause.message)}`;
					emit(captured, { type: "error", kind: "batch", level: "error", message });
					// A batch that broke inside the runner ends as failed rather than staying in progress for good.
					record.state = "failed";
					record.errors = [{ code: "batch_failed", message, line: null, param: null }];
					record.at.ended = now();
					try {
						await store.save(record);
					} catch {
						// The store is what failed; the batch stays readable from memory.
					}
				})
				.finally(() => running.delete(record.id));
		},
		/**
		 * Cancel a batch that has not ended: its unfinished requests are stopped and the batch ends as cancelled once they are.
		 * @param {any} record - The batch.
		 * @returns {void}
		 */
		cancel(record) {
			halt(running.get(record.id), "cancelled");
			record.state = "cancelling";
			record.at.cancelling = now();
		},
		/**
		 * Stop every running batch (they end as cancelled) and wait until they have.
		 * @returns {Promise<void>} Resolves when no batch is running.
		 */
		async stop() {
			await this.ready;
			const runs = [...running.values()];
			for (const run of runs) halt(run, "shutdown");
			await Promise.all(runs.map((run) => run.done));
		}
	};
}

/**
 * The batch runner of the translator, made on first use from the `batches` setting (the global one).
 * @param {any} self - `self` of the calling leaf.
 * @param {any} context - `context` of the calling leaf.
 * @returns {any} The runner.
 * @throws {TranslatorError} 404 `batches_disabled` when `batches` is null.
 */
export function runnerOf(self, context) {
	const { config, state } = context;
	if (state.batches === undefined) {
		const setting = settingsOf(config.settings).batches;
		state.batches = setting === null ? null : start(self, context, setting);
		if (state.batches !== null) state.batches.ready = recover(state.batches);
	}
	if (state.batches === null) throw disabled();
	return state.batches;
}

/**
 * End the batches a store holds as running that no run in this process is working on: the process that started them ended, so their requests cannot
 * finish. They end as expired.
 * @param {any} runner - The runner.
 * @returns {Promise<void>} Resolves when they are saved.
 */
async function recover(runner) {
	for (const record of await runner.store.orphans()) {
		record.state = "expired";
		record.at.ended = Date.now();
		for (const item of record.items) {
			record.counts.pending -= 1;
			record.counts.expired += 1;
			item.outcome = "expired";
			item.request = null;
			item.result = { type: "expired" };
		}
		await runner.store.save(record);
	}
}

/**
 * Find a batch of a front.
 * @param {any} runner - The runner.
 * @param {string} id - Batch id.
 * @param {"anthropic" | "openai"} front - Client protocol; a batch made through the other front is not found.
 * @returns {Promise<any>} The stored batch.
 * @throws {TranslatorError} 404 `batch_not_found`.
 */
export async function find(runner, id, front) {
	await runner.ready;
	const record = await runner.store.get(id);
	if (record === null || record.front !== front) throw missing(front, id);
	return record;
}

/**
 * Create a message batch and start running it.
 * @param {any} runner - The runner.
 * @param {any} body - `{ requests: [{ custom_id, params }] }`.
 * @param {string} [base] - Origin for the `results_url`.
 * @returns {Promise<any>} The message batch.
 * @throws {TranslatorError} 400 for a body that is not valid, `storage_limit_exceeded`.
 */
export async function createAnthropic(runner, body, base) {
	const items = anthropicItems(body, runner.setting.maxRequests);
	await runner.ready;
	const record = await runner.open("anthropic", { items });
	const view = anthropicBatch(record, base);
	runner.submit(record);
	return view;
}

/**
 * Create an OpenAI batch and start validating and running it.
 * @param {any} runner - The runner.
 * @param {any} files - The file store (null when the Files API is off).
 * @param {any} body - `{ input_file_id, endpoint, completion_window, metadata, output_expires_after }`.
 * @returns {Promise<any>} The batch, `validating`.
 * @throws {TranslatorError} 400 for a body that is not valid or an input file that is not there or not a batch file, 404 `files_disabled`, `storage_limit_exceeded`.
 */
export async function createOpenai(runner, files, body) {
	const params = openaiParams(body);
	if (files === null)
		throw new TranslatorError("The Files API is off (the files setting is null)", { code: "files_disabled", status: 404 });
	const file = await files.get(params.input_file_id);
	const id = params.input_file_id;
	if (file === null) throw problem(400, `No such File object: ${id}`, "invalid_value", "input_file_id");
	if (file.meta.purpose !== "batch") {
		throw problem(
			400,
			`The file ${id} has purpose '${file.meta.purpose}'; a batch input file needs purpose 'batch'`,
			"invalid_value",
			"input_file_id"
		);
	}
	await runner.ready;
	const record = await runner.open("openai", {
		endpoint: params.endpoint,
		input_file_id: id,
		metadata: params.metadata,
		output_expires_after: params.expiresIn
	});
	const view = openaiBatch(record);
	runner.submit(record, file.data);
	return view;
}

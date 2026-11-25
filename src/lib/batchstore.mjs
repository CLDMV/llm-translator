/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/batchstore.mjs
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
 * @fileoverview The batch store behind the Batch APIs: batch records with their requests and results, kept in memory or in a directory, with limits on
 * the number of batches held and on the size of one batch, and a retention time.
 * @module @cldmv/llm-translator/lib/batchstore
 */
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { TranslatorError } from "./errors.mjs";

/**
 * The `batches` setting.
 * @typedef {{ store: "memory" | "disk", dir: string | null, concurrency: number, maxRequests: number, maxCount: number, window: number, ttl: number }} BatchesSetting
 */

/** Defaults of the `batches` setting: a day to finish (both APIs' completion window), 29 days of retention (Anthropic's). */
export const DEFAULTS = Object.freeze(
	/** @type {BatchesSetting} */ ({
		store: "memory",
		dir: null,
		concurrency: 4,
		maxRequests: 10000,
		maxCount: 1000,
		window: 86400,
		ttl: 2505600
	})
);

const KEYS = Object.keys(DEFAULTS);

/** What a batch id looks like: OpenAI's `batch_...` and Anthropic's `msgbatch_...`. */
export const ID = /^(?:batch|msgbatch)_[A-Za-z0-9]{8,64}$/;

/** The states a batch does not leave (OpenAI's names; Anthropic's `ended` covers all four). */
export const TERMINAL = Object.freeze(["completed", "failed", "expired", "cancelled"]);

/**
 * Throw an invalid `batches` setting.
 * @param {string} key - Setting key (`batches` or `batches.<field>`).
 * @param {any} value - The value.
 * @param {string} expected - What was expected.
 * @throws {TranslatorError} `invalid_setting`.
 */
function invalid(key, value, expected) {
	throw new TranslatorError(`Invalid setting ${key}: ${JSON.stringify(value)} (${expected})`, {
		code: "invalid_setting",
		status: 500,
		details: { key }
	});
}

/**
 * Check the `batches` setting. `null` turns both Batch APIs off.
 * @param {any} value - The setting after the layers were merged.
 * @returns {null | BatchesSetting} The setting.
 * @throws {TranslatorError} `invalid_setting` for anything that is not `null` or an object of the documented fields.
 */
export function normalize(value) {
	if (value === null) return null;
	if (typeof value !== "object" || Array.isArray(value)) invalid("batches", value, "expected null or an object");
	for (const key of Object.keys(value))
		if (!KEYS.includes(key)) invalid(`batches.${key}`, value[key], `not a batches setting; expected one of ${KEYS.join(", ")}`);
	if (value.store !== "memory" && value.store !== "disk") invalid("batches.store", value.store, 'expected "memory" or "disk"');
	if (value.store === "disk" && (typeof value.dir !== "string" || value.dir === "")) {
		invalid("batches.dir", value.dir, 'expected a directory path, which store "disk" needs');
	}
	if (value.dir !== null && typeof value.dir !== "string") invalid("batches.dir", value.dir, "expected a directory path or null");
	for (const key of ["concurrency", "maxRequests", "maxCount", "window"]) {
		if (!Number.isSafeInteger(value[key]) || value[key] < 1) invalid(`batches.${key}`, value[key], "expected a positive integer");
	}
	if (!Number.isSafeInteger(value.ttl) || value.ttl < 0)
		invalid("batches.ttl", value.ttl, "expected seconds as a whole number, 0 for no limit");
	return value;
}

/**
 * Make a batch id.
 * @param {"anthropic" | "openai"} front - The client protocol the batch is created through; it decides the prefix (`msgbatch_` or `batch_`).
 * @returns {string} Id.
 */
export function newId(front) {
	return `${front === "openai" ? "batch_" : "msgbatch_"}${randomBytes(12).toString("hex")}`;
}

/**
 * Backend that keeps batch records in memory.
 * @returns {{ write: Function, read: Function, all: Function, erase: Function }} Backend.
 */
function memory() {
	const records = new Map();
	return {
		write: async (record) => void records.set(record.id, record),
		read: async (id) => records.get(id) ?? null,
		all: async () => [...records.values()],
		erase: async (id) => records.delete(id)
	};
}

/**
 * Backend that keeps each batch in a directory as `<id>.json`.
 * @param {string} dir - Directory (created when missing).
 * @returns {{ write: Function, read: Function, all: Function, erase: Function }} Backend.
 */
function disk(dir) {
	const ready = mkdir(dir, { recursive: true });
	const at = (id) => path.join(dir, `${id}.json`);
	return {
		write: async (record) => {
			await ready;
			await writeFile(at(record.id), JSON.stringify(record));
		},
		read: async (id) => {
			await ready;
			try {
				return JSON.parse(await readFile(at(id), "utf8"));
			} catch (cause) {
				if (cause?.code === "ENOENT") return null;
				throw cause;
			}
		},
		all: async () => {
			await ready;
			const records = [];
			for (const name of await readdir(dir)) {
				if (name.endsWith(".json")) records.push(JSON.parse(await readFile(path.join(dir, name), "utf8")));
			}
			return records;
		},
		erase: async (id) => {
			await ready;
			const found = await readFile(at(id)).then(
				() => true,
				() => false
			);
			await rm(at(id), { force: true });
			return found;
		}
	};
}

/**
 * Create a store. Ids are checked against `ID` before they reach the backend, so a directory store never builds a path from client text. A batch that is
 * still being processed lives in this process, so the store hands out that very object (its counts and states are current); the backend holds the
 * last saved copy.
 * @param {BatchesSetting} options - The `batches` setting.
 * @param {() => number} [now] - Clock in ms.
 * @returns {{ add: Function, get: Function, list: Function, save: Function, remove: Function, orphans: Function }} Store.
 */
export function create(options, now = Date.now) {
	const backend = options.store === "disk" ? disk(/** @type {string} */ (options.dir)) : memory();
	const live = new Map();
	const view = (record) => live.get(record.id) ?? record;
	// Finished batches past their retention are removed whenever the store is used.
	const sweep = async () => {
		const stamp = now();
		const records = await backend.all();
		for (const record of records) {
			if (TERMINAL.includes(record.state) && record.keep_until !== null && record.keep_until <= stamp) await backend.erase(record.id);
		}
		return records
			.filter((record) => !(TERMINAL.includes(record.state) && record.keep_until !== null && record.keep_until <= stamp))
			.map(view);
	};
	return {
		/**
		 * Store a new batch. When the store is full the oldest finished batch makes room.
		 * @param {any} record - The batch record (`id`, `state`, `created_at`, ...).
		 * @returns {Promise<void>} Resolves once the batch is saved.
		 * @throws {TranslatorError} 400 `storage_limit_exceeded` when every held batch is still being processed.
		 */
		async add(record) {
			const held = await sweep();
			if (held.length >= options.maxCount) {
				const finished = held.filter((entry) => TERMINAL.includes(entry.state)).sort((left, right) => left.created_at - right.created_at);
				if (finished.length === 0) {
					throw new TranslatorError(`The batch store holds its limit of ${options.maxCount} batches and all of them are still processing`, {
						code: "storage_limit_exceeded",
						status: 400,
						type: "invalid_request_error"
					});
				}
				await backend.erase(finished[0].id);
			}
			if (!TERMINAL.includes(record.state)) live.set(record.id, record);
			await backend.write(record);
		},
		/**
		 * A stored batch.
		 * @param {string} id - Batch id.
		 * @returns {Promise<any | null>} The record, or null when it is unknown, malformed or past its retention.
		 */
		async get(id) {
			if (!ID.test(id)) return null;
			const record = live.get(id) ?? (await backend.read(id));
			if (record === null) return null;
			if (TERMINAL.includes(record.state) && record.keep_until !== null && record.keep_until <= now()) {
				await backend.erase(id);
				return null;
			}
			return record;
		},
		/**
		 * Every stored batch, newest first.
		 * @returns {Promise<any[]>} Records.
		 */
		async list() {
			return (await sweep()).sort((left, right) => right.created_at - left.created_at);
		},
		/**
		 * Save a batch after its state changed; a batch that reached a terminal state is no longer held live.
		 * @param {any} record - The batch record.
		 * @returns {Promise<void>} Resolves once the batch is saved.
		 */
		async save(record) {
			await backend.write(record);
			if (TERMINAL.includes(record.state)) live.delete(record.id);
		},
		/**
		 * Delete a batch.
		 * @param {string} id - Batch id.
		 * @returns {Promise<boolean>} Whether it existed.
		 */
		async remove(id) {
			if (!ID.test(id)) return false;
			live.delete(id);
			return backend.erase(id);
		},
		/**
		 * Batches the backend holds as being processed that no run in this process is working on (the process that started them ended).
		 * @returns {Promise<any[]>} Records.
		 */
		async orphans() {
			return (await backend.all()).filter((record) => !TERMINAL.includes(record.state) && !live.has(record.id));
		}
	};
}

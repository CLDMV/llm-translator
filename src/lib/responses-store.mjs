/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/responses-store.mjs
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
 * @fileoverview The response store behind the stateful Responses API: stored responses (with their input items and the history they were answered
 * against) and conversations, kept in memory or in a directory, with limits on the number of entries and bytes, eviction of the oldest and an
 * optional lifetime.
 *
 * Store interface (every method returns a promise): `get(kind, id)` reads a record (null when unknown, malformed or expired), `put(kind, id, value)`
 * writes one and evicts the oldest records over the limits, `update(kind, id, change)` is a serialized read-modify-write (`change` gets the current
 * record or null and returns the record to write, or undefined to leave it as it is), and `remove(kind, id)` deletes one (true when it existed).
 * `all(kind)` reads every live record of a kind, newest write first. `kind` is `"response"` or `"conversation"`; records are JSON values.
 *
 * Backend interface (what `responses.store` can be set to instead of `"memory"` or `"disk"`; every method returns a promise, and records are text):
 * `scan(kind)` lists what the backend already holds as `[{ id, size, at }]` (size in bytes, `at` the write time in ms, oldest first; `[]` for a backend
 * that starts empty), `read(kind, id)` gives the text of a record or null, `write(kind, id, text)` stores it, and `erase(kind, id)` deletes it. The store
 * does the rest (limits, eviction, ttl, locking, JSON). `memory` and `disk` are the two provided.
 * @module @cldmv/llm-translator/lib/responses-store
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { TranslatorError } from "./errors.mjs";
import { normalize as normalizePrompts } from "./prompts.mjs";

/**
 * The `responses` setting.
 * @typedef {{ store: "memory" | "disk" | { scan: Function, read: Function, write: Function, erase: Function }, dir: string | null, maxCount: number, maxTotalBytes: number, ttl: number, maxConversations: number, maxItems: number, prompts: Record<string, any> }} ResponsesSetting
 */

/** Defaults of the `responses` setting. */
export const DEFAULTS = Object.freeze(
	/** @type {ResponsesSetting} */ ({
		store: "memory",
		dir: null,
		maxCount: 1000,
		maxTotalBytes: 128 * 1024 * 1024,
		ttl: 0,
		maxConversations: 1000,
		maxItems: 10000,
		prompts: Object.freeze({})
	})
);

const KEYS = Object.keys(DEFAULTS);

/** The functions of a backend. */
const BACKEND = ["scan", "read", "write", "erase"];

/** The record kinds and the id shape of each (the id is checked before it reaches a backend, so a directory store never builds a path from client text). */
export const IDS = Object.freeze({
	response: /^resp_[A-Za-z0-9]{8,64}$/,
	conversation: /^conv_[A-Za-z0-9]{8,64}$/
});

/**
 * Throw an invalid `responses` setting.
 * @param {string} key - Setting key (`responses` or `responses.<field>`).
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
 * Check the `responses` setting. `null` turns the stateful Responses API off.
 * @param {any} value - The setting after the layers were merged.
 * @returns {null | ResponsesSetting} The setting.
 * @throws {TranslatorError} `invalid_setting` for anything that is not `null` or an object of the documented fields.
 */
export function normalize(value) {
	if (value === null) return null;
	if (typeof value !== "object" || Array.isArray(value)) invalid("responses", value, "expected null or an object");
	for (const key of Object.keys(value))
		if (!KEYS.includes(key)) invalid(`responses.${key}`, value[key], `not a responses setting; expected one of ${KEYS.join(", ")}`);
	if (value.store !== null && typeof value.store === "object") {
		for (const name of BACKEND) {
			if (typeof value.store[name] !== "function")
				invalid(`responses.store.${name}`, value.store[name], `a custom store needs a ${name}() function (${BACKEND.join(", ")})`);
		}
	} else if (value.store !== "memory" && value.store !== "disk") {
		invalid("responses.store", value.store, 'expected "memory", "disk" or an object with scan, read, write and erase functions');
	}
	if (value.store === "disk" && (typeof value.dir !== "string" || value.dir === "")) {
		invalid("responses.dir", value.dir, 'expected a directory path, which store "disk" needs');
	}
	if (value.dir !== null && typeof value.dir !== "string") invalid("responses.dir", value.dir, "expected a directory path or null");
	for (const key of ["maxCount", "maxTotalBytes", "maxConversations", "maxItems"]) {
		if (!Number.isSafeInteger(value[key]) || value[key] < 1) invalid(`responses.${key}`, value[key], "expected a positive integer");
	}
	if (!Number.isSafeInteger(value.ttl) || value.ttl < 0)
		invalid("responses.ttl", value.ttl, "expected seconds as a whole number, 0 for no limit");
	normalizePrompts(value.prompts);
	return value;
}

/**
 * Backend that keeps records in memory.
 * @returns {{ scan: Function, read: Function, write: Function, erase: Function }} Backend.
 */
function memory() {
	const held = new Map();
	return {
		scan: async () => [],
		read: async (kind, id) => held.get(`${kind}/${id}`),
		write: async (kind, id, text) => void held.set(`${kind}/${id}`, text),
		erase: async (kind, id) => void held.delete(`${kind}/${id}`)
	};
}

/**
 * Backend that keeps each record in a directory as `<kind>/<id>.json`.
 * @param {string} dir - Directory (created when missing).
 * @returns {{ scan: Function, read: Function, write: Function, erase: Function }} Backend.
 */
function disk(dir) {
	const at = (kind, id) => path.join(dir, kind, `${id}.json`);
	const ready = Promise.all(Object.keys(IDS).map((kind) => mkdir(path.join(dir, kind), { recursive: true })));
	return {
		scan: async (kind) => {
			await ready;
			const found = [];
			for (const name of await readdir(path.join(dir, kind))) {
				const id = name.slice(0, -".json".length);
				if (!name.endsWith(".json") || !IDS[kind].test(id)) continue;
				const info = await stat(at(kind, id));
				found.push({ id, size: info.size, at: info.mtimeMs });
			}
			return found.sort((left, right) => left.at - right.at);
		},
		read: async (kind, id) => {
			await ready;
			try {
				return await readFile(at(kind, id), "utf8");
			} catch (cause) {
				if (cause?.code === "ENOENT") return null;
				throw cause;
			}
		},
		write: async (kind, id, text) => {
			await ready;
			await writeFile(at(kind, id), text);
		},
		erase: async (kind, id) => {
			await ready;
			await rm(at(kind, id), { force: true });
		}
	};
}

/**
 * Create a store.
 * @param {ResponsesSetting} options - The `responses` setting.
 * @param {() => number} [now] - Clock in ms.
 * @returns {{ get: Function, all: Function, put: Function, update: Function, remove: Function }} Store.
 */
export function create(options, now = Date.now) {
	let backend = options.store;
	if (backend === "disk") backend = disk(/** @type {string} */ (options.dir));
	else if (backend === "memory") backend = memory();
	// What the store holds per kind, oldest write first: id -> { size, at }. Built from the backend on first use, so a directory that already holds
	// records (a restart) is counted and evicted like the rest.
	const index = {};
	const loaded = {};
	const limits = {
		response: { count: options.maxCount, bytes: options.maxTotalBytes },
		conversation: { count: options.maxConversations, bytes: Infinity }
	};
	const known = async (kind) => {
		loaded[kind] ??= backend.scan(kind).then((found) => {
			index[kind] = new Map(found.map((entry) => [entry.id, { size: entry.size, at: entry.at }]));
		});
		await loaded[kind];
		return index[kind];
	};
	const expired = (entry) => options.ttl > 0 && entry.at + options.ttl * 1000 <= now();
	const forget = async (kind, id) => {
		(await known(kind)).delete(id);
		await backend.erase(kind, id);
	};
	// One chain per record, so two changes to the same record never interleave.
	const tails = new Map();
	const locked = async (key, task) => {
		const tail = tails.get(key) ?? Promise.resolve();
		const run = tail.then(task, task);
		const next = run.catch(() => {});
		tails.set(key, next);
		try {
			return await run;
		} finally {
			if (tails.get(key) === next) tails.delete(key);
		}
	};
	const read = async (kind, id) => {
		if (!IDS[kind].test(id)) return null;
		const entry = (await known(kind)).get(id);
		if (entry === undefined) return null;
		if (expired(entry)) {
			await forget(kind, id);
			return null;
		}
		const text = await backend.read(kind, id);
		return text === null ? null : JSON.parse(text);
	};
	const write = async (kind, id, value) => {
		const held = await known(kind);
		const text = JSON.stringify(value);
		await backend.write(kind, id, text);
		held.delete(id);
		held.set(id, { size: Buffer.byteLength(text), at: now() });
		for (const [other, entry] of [...held]) if (expired(entry)) await forget(kind, other);
		const limit = limits[kind];
		let bytes = 0;
		for (const entry of held.values()) bytes += entry.size;
		// The oldest go first; the record just written stays, even when it alone is over a limit.
		for (const [other, entry] of [...held]) {
			if (held.size <= limit.count && bytes <= limit.bytes) break;
			if (other === id) continue;
			bytes -= entry.size;
			await forget(kind, other);
		}
	};
	return {
		/**
		 * Read a record.
		 * @param {"response" | "conversation"} kind - Record kind.
		 * @param {string} id - Record id.
		 * @returns {Promise<any | null>} The record, or null when it is unknown, malformed or expired.
		 */
		get: (kind, id) => read(kind, id),
		/**
		 * Every live record of a kind, newest write first (expired ones are removed on the way).
		 * @param {"response" | "conversation"} kind - Record kind.
		 * @returns {Promise<any[]>} Records.
		 */
		all: async (kind) => {
			const found = [];
			for (const id of [...(await known(kind)).keys()].reverse()) {
				const record = await read(kind, id);
				if (record !== null) found.push(record);
			}
			return found;
		},
		/**
		 * Write a record, evicting the oldest ones over the limits.
		 * @param {"response" | "conversation"} kind - Record kind.
		 * @param {string} id - Record id (checked against the kind's shape).
		 * @param {any} value - JSON value.
		 * @returns {Promise<void>} Resolves when written.
		 */
		put: (kind, id, value) => locked(`${kind}/${id}`, () => write(kind, id, value)),
		/**
		 * Change a record without another change interleaving.
		 * @param {"response" | "conversation"} kind - Record kind.
		 * @param {string} id - Record id.
		 * @param {(current: any | null) => any | undefined | Promise<any | undefined>} change - Gets the record (null when there is none) and returns the record to write, or undefined to leave it.
		 * @returns {Promise<any | null>} The record after the change.
		 */
		update: (kind, id, change) =>
			locked(`${kind}/${id}`, async () => {
				const current = await read(kind, id);
				const next = await change(current);
				if (next === undefined) return current;
				await write(kind, id, next);
				return next;
			}),
		/**
		 * Delete a record.
		 * @param {"response" | "conversation"} kind - Record kind.
		 * @param {string} id - Record id.
		 * @returns {Promise<boolean>} Whether it existed.
		 */
		remove: (kind, id) =>
			locked(`${kind}/${id}`, async () => {
				if (!IDS[kind].test(id) || !(await known(kind)).has(id)) return false;
				await forget(kind, id);
				return true;
			})
	};
}

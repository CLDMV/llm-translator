/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/filestore.mjs
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
 * @fileoverview The file store behind the Files API: stored files with their metadata, kept in memory or in a directory, with limits on the size of
 * a file, the bytes and the number of files held, and an optional lifetime.
 * @module @cldmv/llm-translator/lib/filestore
 */
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { TranslatorError } from "./errors.mjs";

/**
 * The `files` setting.
 * @typedef {{ store: "memory" | "disk", dir: string | null, maxFileSize: number, maxTotalBytes: number, maxCount: number, ttl: number }} FilesSetting
 */

/** Defaults of the `files` setting. */
export const DEFAULTS = Object.freeze(
	/** @type {FilesSetting} */ ({
		store: "memory",
		dir: null,
		maxFileSize: 32 * 1024 * 1024,
		maxTotalBytes: 256 * 1024 * 1024,
		maxCount: 1000,
		ttl: 0
	})
);

const KEYS = Object.keys(DEFAULTS);

/** What a file id looks like: Anthropic's `file_...` and OpenAI's `file-...`, hex or base62 after the prefix. */
export const ID = /^file[-_][A-Za-z0-9]{8,64}$/;

/**
 * Throw an invalid `files` setting.
 * @param {string} key - Setting key (`files` or `files.<field>`).
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
 * Check the `files` setting. `null` turns the Files API off.
 * @param {any} value - The setting after the layers were merged.
 * @returns {null | FilesSetting} The setting.
 * @throws {TranslatorError} `invalid_setting` for anything that is not `null` or an object of the documented fields.
 */
export function normalize(value) {
	if (value === null) return null;
	if (typeof value !== "object" || Array.isArray(value)) invalid("files", value, "expected null or an object");
	for (const key of Object.keys(value))
		if (!KEYS.includes(key)) invalid(`files.${key}`, value[key], `not a files setting; expected one of ${KEYS.join(", ")}`);
	if (value.store !== "memory" && value.store !== "disk") invalid("files.store", value.store, 'expected "memory" or "disk"');
	if (value.store === "disk" && (typeof value.dir !== "string" || value.dir === "")) {
		invalid("files.dir", value.dir, 'expected a directory path, which store "disk" needs');
	}
	if (value.dir !== null && typeof value.dir !== "string") invalid("files.dir", value.dir, "expected a directory path or null");
	for (const key of ["maxFileSize", "maxTotalBytes", "maxCount"]) {
		if (!Number.isSafeInteger(value[key]) || value[key] < 1) invalid(`files.${key}`, value[key], "expected a positive integer");
	}
	if (!Number.isSafeInteger(value.ttl) || value.ttl < 0)
		invalid("files.ttl", value.ttl, "expected seconds as a whole number, 0 for no limit");
	return value;
}

/**
 * Make a file id.
 * @param {"anthropic" | "openai"} front - The client protocol the file is uploaded through; it decides the prefix (`file_` or `file-`).
 * @returns {string} Id.
 */
export function newId(front) {
	return `${front === "openai" ? "file-" : "file_"}${randomBytes(12).toString("hex")}`;
}

/**
 * Backend that keeps files in memory.
 * @returns {{ write: Function, read: Function, all: Function, erase: Function }} Backend.
 */
function memory() {
	const files = new Map();
	return {
		write: async (meta, data) => void files.set(meta.id, { meta, data }),
		read: async (id) => files.get(id) ?? null,
		all: async () => [...files.values()].map((entry) => entry.meta),
		erase: async (id) => files.delete(id)
	};
}

/**
 * Backend that keeps each file in a directory as `<id>.json` (the metadata) and `<id>.bin` (the bytes).
 * @param {string} dir - Directory (created when missing).
 * @returns {{ write: Function, read: Function, all: Function, erase: Function }} Backend.
 */
function disk(dir) {
	const ready = mkdir(dir, { recursive: true });
	const at = (id, extension) => path.join(dir, `${id}.${extension}`);
	return {
		write: async (meta, data) => {
			await ready;
			await writeFile(at(meta.id, "bin"), data);
			await writeFile(at(meta.id, "json"), JSON.stringify(meta));
		},
		read: async (id) => {
			await ready;
			try {
				return { meta: JSON.parse(await readFile(at(id, "json"), "utf8")), data: await readFile(at(id, "bin")) };
			} catch (cause) {
				if (cause?.code === "ENOENT") return null;
				throw cause;
			}
		},
		all: async () => {
			await ready;
			const metas = [];
			for (const name of await readdir(dir)) {
				if (name.endsWith(".json")) metas.push(JSON.parse(await readFile(path.join(dir, name), "utf8")));
			}
			return metas;
		},
		erase: async (id) => {
			await ready;
			const found = await readFile(at(id, "json")).then(
				() => true,
				() => false
			);
			await rm(at(id, "json"), { force: true });
			await rm(at(id, "bin"), { force: true });
			return found;
		}
	};
}

/**
 * Create a store. Ids are checked against `ID` before they reach the backend, so a directory store never builds a path from client text.
 * @param {FilesSetting} options - The `files` setting.
 * @param {() => number} [now] - Clock in ms.
 * @returns {{ put: Function, get: Function, head: Function, list: Function, remove: Function }} Store.
 */
export function create(options, now = Date.now) {
	const backend = options.store === "disk" ? disk(/** @type {string} */ (options.dir)) : memory();
	// Files past their expiry are removed whenever the store is used.
	const sweep = async () => {
		const stamp = now();
		const metas = await backend.all();
		for (const meta of metas) if (meta.expires_at !== null && meta.expires_at <= stamp) await backend.erase(meta.id);
		return metas.filter((meta) => meta.expires_at === null || meta.expires_at > stamp);
	};
	return {
		/**
		 * Store a file.
		 * @param {{ id: string, filename: string, mimeType: string, purpose: string, data: Buffer, expiresIn?: number }} file - The file; `expiresIn` is seconds and can only shorten the `ttl` setting.
		 * @returns {Promise<any>} Metadata: `{ id, filename, mime_type, size, purpose, created_at, expires_at }` (times in ms, `expires_at` null for none).
		 * @throws {TranslatorError} 413 `file_too_large`, 400 `storage_limit_exceeded` (bytes or count).
		 */
		async put(file) {
			const size = file.data.length;
			if (size > options.maxFileSize) {
				throw new TranslatorError(`The file is ${size} bytes; the limit is ${options.maxFileSize} bytes`, {
					code: "file_too_large",
					status: 413,
					type: "request_too_large"
				});
			}
			const held = await sweep();
			const total = held.reduce((sum, meta) => sum + meta.size, 0);
			if (held.length >= options.maxCount || total + size > options.maxTotalBytes) {
				throw new TranslatorError(
					held.length >= options.maxCount
						? `The file store holds its limit of ${options.maxCount} files`
						: `The file store would pass its limit of ${options.maxTotalBytes} bytes`,
					{ code: "storage_limit_exceeded", status: 400, type: "invalid_request_error" }
				);
			}
			const created = now();
			const lifetime = [options.ttl, file.expiresIn].filter((seconds) => seconds > 0);
			const meta = {
				id: file.id,
				filename: file.filename,
				mime_type: file.mimeType,
				size,
				purpose: file.purpose,
				created_at: created,
				expires_at: lifetime.length === 0 ? null : created + Math.min(...lifetime) * 1000
			};
			await backend.write(meta, file.data);
			return meta;
		},
		/**
		 * A stored file with its bytes.
		 * @param {string} id - File id.
		 * @returns {Promise<{ meta: any, data: Buffer } | null>} The file, or null when it is unknown, malformed or expired.
		 */
		async get(id) {
			if (!ID.test(id)) return null;
			const found = await backend.read(id);
			if (found === null) return null;
			if (found.meta.expires_at !== null && found.meta.expires_at <= now()) {
				await backend.erase(id);
				return null;
			}
			return found;
		},
		/**
		 * The metadata of a stored file.
		 * @param {string} id - File id.
		 * @returns {Promise<any | null>} Metadata, or null.
		 */
		async head(id) {
			return (await this.get(id))?.meta ?? null;
		},
		/**
		 * Every stored file, newest first.
		 * @returns {Promise<any[]>} Metadata.
		 */
		async list() {
			return (await sweep()).sort((left, right) => right.created_at - left.created_at);
		},
		/**
		 * Delete a file.
		 * @param {string} id - File id.
		 * @returns {Promise<boolean>} Whether it existed.
		 */
		async remove(id) {
			if (!ID.test(id)) return false;
			return backend.erase(id);
		}
	};
}

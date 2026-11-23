/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/files.mjs
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
 * @fileoverview The Files API: the file objects of both fronts, upload checks, listing with pagination, and resolving file references in a request
 * into base64 content before it is converted.
 * @module @cldmv/llm-translator/lib/files
 */
import { TranslatorError } from "./errors.mjs";
import { ID, create } from "./filestore.mjs";
import { resolve as settingsOf } from "./settings.mjs";

/**
 * The translator's file store, made on first use from the `files` setting (the global one; an upstream's own `settings` do not apply to a store the
 * fronts share).
 * @param {any} config - Translator config.
 * @param {any} state - Translator state (holds the store).
 * @returns {ReturnType<typeof create> | null} The store, or null when `files` is null (the Files API is off).
 */
export function storeOf(config, state) {
	if (state.files === undefined) {
		const files = settingsOf(config.settings).files;
		state.files = files === null ? null : create(files);
	}
	return state.files;
}

/** The `anthropic-beta` value that selects the beta shapes of the Files API (cursor pagination, no `expires_at`). */
export const BETA = "files-api-2025-04-14";

/** The purposes OpenAI accepts on upload. */
export const PURPOSES = Object.freeze(["assistants", "batch", "fine-tune", "vision", "user_data", "evals"]);

const EXTENSIONS = {
	pdf: "application/pdf",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	txt: "text/plain",
	md: "text/plain",
	csv: "text/csv",
	json: "application/json"
};

/**
 * Whether a request's `anthropic-beta` header names the Files API beta.
 * @param {string | string[] | undefined} header - Header value.
 * @returns {boolean} True when `files-api-2025-04-14` is listed.
 */
export function beta(header) {
	return [header ?? ""].flat().some((value) => value.split(",").some((item) => item.trim() === BETA));
}

/**
 * The media type of an uploaded file: the type the part declared, or one guessed from the file name.
 * @param {string | undefined} declared - The part's `content-type`.
 * @param {string} filename - File name.
 * @returns {string} Media type.
 */
export function mimeOf(declared, filename) {
	if (typeof declared === "string" && declared.trim() !== "") return declared.split(";")[0].trim().toLowerCase();
	return EXTENSIONS[filename.split(".").pop().toLowerCase()] ?? "application/octet-stream";
}

/**
 * A client error.
 * @param {number} status - HTTP status.
 * @param {string} message - Message.
 * @param {string} code - Error code.
 * @param {string} [param] - Offending parameter.
 * @returns {TranslatorError} Error.
 */
function problem(status, message, code, param) {
	return new TranslatorError(message, { code, status, param, type: status === 404 ? "not_found_error" : "invalid_request_error" });
}

/**
 * The error for an unknown file, worded like the front's own.
 * @param {"anthropic" | "openai"} front - Client protocol.
 * @param {string} id - The id asked for.
 * @returns {TranslatorError} 404 `file_not_found`.
 */
export function missing(front, id) {
	return problem(404, front === "openai" ? `No such File object: ${id}` : `File \`${id}\` not found.`, "file_not_found", "file_id");
}

/**
 * Check an upload's file name (Anthropic's rule: 1 to 255 characters, none of `< > : " | ? * \ /` or a control character).
 * @param {any} filename - File name.
 * @returns {string} The name.
 * @throws {TranslatorError} 400 `invalid_filename`.
 */
export function filenameOf(filename) {
	// eslint-disable-next-line no-control-regex
	if (typeof filename !== "string" || filename.length < 1 || filename.length > 255 || /[<>:"|?*\\/\u0000-\u001f]/.test(filename)) {
		throw problem(
			400,
			'The file name must be 1 to 255 characters without any of < > : " | ? * \\ / or control characters',
			"invalid_filename",
			"filename"
		);
	}
	return filename;
}

/**
 * The lifetime an upload asks for, in seconds. Anthropic's field is `expires_in_seconds` (3600 to 7776000); OpenAI's is `expires_after` with
 * `anchor: "created_at"` and `seconds` (3600 to 2592000).
 * @param {"anthropic" | "openai"} front - Client protocol.
 * @param {Record<string, string>} fields - The form's text fields.
 * @returns {number | undefined} Seconds, or undefined when the upload does not ask for one.
 * @throws {TranslatorError} 400 `invalid_expiry`.
 */
export function expiryOf(front, fields) {
	const key = front === "openai" ? "expires_after[seconds]" : "expires_in_seconds";
	const raw = fields[key];
	if (raw === undefined) return undefined;
	const max = front === "openai" ? 2592000 : 7776000;
	const seconds = Number(raw);
	if (!Number.isInteger(seconds) || seconds < 3600 || seconds > max) {
		throw problem(400, `${key} must be a whole number of seconds between 3600 and ${max}`, "invalid_expiry", key);
	}
	if (front === "openai" && fields["expires_after[anchor]"] !== "created_at") {
		throw problem(400, "expires_after[anchor] must be created_at", "invalid_expiry", "expires_after[anchor]");
	}
	return seconds;
}

/**
 * Anthropic's file object. The beta shape (`files-api-2025-04-14`) has no `expires_at`.
 * @param {any} meta - Stored metadata.
 * @param {boolean} [legacy] - The beta shape.
 * @returns {any} File object.
 */
export function anthropicFile(meta, legacy = false) {
	return {
		id: meta.id,
		type: "file",
		filename: meta.filename,
		mime_type: meta.mime_type,
		size_bytes: meta.size,
		created_at: new Date(meta.created_at).toISOString(),
		downloadable: false,
		...(legacy ? {} : { expires_at: meta.expires_at === null ? null : new Date(meta.expires_at).toISOString() })
	};
}

/**
 * OpenAI's file object.
 * @param {any} meta - Stored metadata.
 * @returns {any} File object.
 */
export function openaiFile(meta) {
	return {
		id: meta.id,
		object: "file",
		bytes: meta.size,
		created_at: Math.floor(meta.created_at / 1000),
		...(meta.expires_at === null ? {} : { expires_at: Math.floor(meta.expires_at / 1000) }),
		filename: meta.filename,
		purpose: meta.purpose,
		status: "processed"
	};
}

/**
 * A page size from a query value.
 * @param {any} value - The value, or undefined.
 * @param {number} fallback - Default.
 * @param {number} max - Largest allowed.
 * @returns {number} Page size.
 * @throws {TranslatorError} 400 `invalid_limit`.
 */
function limitOf(value, fallback, max) {
	if (value === undefined) return fallback;
	const limit = Number(value);
	if (!Number.isInteger(limit) || limit < 1 || limit > max)
		throw problem(400, `limit must be a whole number from 1 to ${max}`, "invalid_limit", "limit");
	return limit;
}

/**
 * Anthropic's file list, newest first. The current shape pages with an opaque `page` cursor and answers `{ data, next_page }`; up to 100 `ids`
 * look files up directly (never together with `page` or `limit`) and leave out the ones that do not exist. The beta shape pages with `before_id`
 * and `after_id` and answers `{ data, has_more, first_id, last_id }`.
 * @param {any[]} metas - Stored metadata, newest first.
 * @param {{ limit?: any, page?: string, before_id?: string, after_id?: string, ids?: string[] }} query - Query parameters.
 * @param {boolean} legacy - The beta shape.
 * @returns {any} List.
 * @throws {TranslatorError} 400 for a bad `limit`, combined parameters or a cursor the shape does not take.
 */
export function anthropicList(metas, query, legacy) {
	if (query.ids !== undefined) {
		if (legacy || query.page !== undefined || query.limit !== undefined)
			throw problem(400, "ids cannot be combined with page or limit", "invalid_ids", "ids");
		if (query.ids.length > 100) throw problem(400, "ids takes at most 100 file ids", "invalid_ids", "ids");
		const wanted = new Set(query.ids);
		return { data: metas.filter((meta) => wanted.has(meta.id)).map((meta) => anthropicFile(meta)), next_page: null };
	}
	const limit = limitOf(query.limit, 20, 1000);
	if (!legacy && (query.before_id !== undefined || query.after_id !== undefined)) {
		throw problem(400, "before_id and after_id need the files-api-2025-04-14 beta; use page", "invalid_cursor", "after_id");
	}
	if (legacy && query.page !== undefined)
		throw problem(400, "page is not part of the files-api-2025-04-14 beta; use after_id", "invalid_cursor", "page");
	let from = 0;
	let to = metas.length;
	const cursor = (id, param) => {
		const index = metas.findIndex((meta) => meta.id === id);
		if (index === -1) throw problem(400, `${param} does not name a stored file`, "invalid_cursor", param);
		return index;
	};
	// `page` and `after_id` continue after a file (older ones), `before_id` stops before one (newer ones).
	const after = legacy ? query.after_id : query.page;
	if (after !== undefined) from = cursor(after, legacy ? "after_id" : "page") + 1;
	if (legacy && query.before_id !== undefined) {
		to = cursor(query.before_id, "before_id");
		from = Math.max(from, Math.max(0, to - limit));
	}
	const window = metas.slice(from, to);
	const data = window.slice(0, limit).map((meta) => anthropicFile(meta, legacy));
	const more = window.length > limit;
	if (!legacy) return { data, next_page: more ? data.at(-1).id : null };
	return { data, has_more: more, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null };
}

/**
 * OpenAI's file list (`purpose`, `limit` up to 10000, `after`, `order`).
 * @param {any[]} metas - Stored metadata, newest first.
 * @param {{ purpose?: string, limit?: any, after?: string, order?: string }} query - Query parameters.
 * @returns {any} List.
 * @throws {TranslatorError} 400 for a bad `limit`, `order` or `after`.
 */
export function openaiList(metas, query) {
	if (query.order !== undefined && query.order !== "asc" && query.order !== "desc")
		throw problem(400, "order must be asc or desc", "invalid_order", "order");
	const limit = limitOf(query.limit, 10000, 10000);
	let list = query.purpose === undefined ? metas : metas.filter((meta) => meta.purpose === query.purpose);
	if (query.order === "asc") list = [...list].reverse();
	if (query.after !== undefined) {
		const index = list.findIndex((meta) => meta.id === query.after);
		if (index === -1) throw problem(400, "after does not name a stored file", "invalid_cursor", "after");
		list = list.slice(index + 1);
	}
	const data = list.slice(0, limit).map(openaiFile);
	return { object: "list", data, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null, has_more: list.length > limit };
}

/**
 * A data URL for stored bytes.
 * @param {{ meta: any, data: Buffer }} file - Stored file.
 * @returns {string} `data:<type>;base64,<bytes>`.
 */
function dataUrl(file) {
	return `data:${file.meta.mime_type};base64,${file.data.toString("base64")}`;
}

/**
 * Resolve file references in a request into base64 content, before conversion: Anthropic `image` and `document` blocks with a `{ type: "file", file_id }`
 * source (also inside tool results), and OpenAI `file` parts with a `file_id` and `image_url` parts whose url is a stored file id.
 * An id the store holds always becomes content: the upstream does not have the file. An id it does not hold is the front's `file_not_found` (404) when
 * `strict`, and is left as it is otherwise (a request forwarded as it is may name files of the upstream's own).
 * @param {any} body - Client request body.
 * @param {{ front: "anthropic" | "openai", store: { get: (id: string) => Promise<any> }, strict: boolean }} options - Front, store, and whether unknown ids are an error.
 * @returns {Promise<any>} The body; the same object when nothing was resolved.
 * @throws {TranslatorError} `file_not_found` (404), or 400 `invalid_file_type` when a file is not what its block needs.
 */
export async function resolve(body, { front, store, strict }) {
	if (!Array.isArray(body?.messages)) return body;
	const found = new Map();
	const lookup = async (id) => {
		if (!found.has(id)) found.set(id, await store.get(id));
		const file = found.get(id);
		if (file === null && strict) throw missing(front, id);
		return file;
	};
	const wrong = (id, needs) => problem(400, `The file ${id} is not ${needs}`, "invalid_file_type", "file_id");
	const anthropic = async (block) => {
		if ((block?.type !== "image" && block?.type !== "document") || block.source?.type !== "file") return block;
		const file = await lookup(block.source.file_id);
		if (file === null) return block;
		const type = file.meta.mime_type;
		if (block.type === "image" && !type.startsWith("image/")) throw wrong(file.meta.id, "an image");
		if (block.type === "document" && type !== "application/pdf" && type !== "text/plain")
			throw wrong(file.meta.id, "a PDF or plain text file");
		return { ...block, source: { type: "base64", media_type: type, data: file.data.toString("base64") } };
	};
	const openai = async (part) => {
		if (part?.type === "file" && typeof part.file?.file_id === "string") {
			const file = await lookup(part.file.file_id);
			if (file === null) return part;
			const { file_id: _, ...rest } = part.file;
			return { ...part, file: { ...rest, file_data: dataUrl(file), filename: part.file.filename ?? file.meta.filename } };
		}
		if (part?.type === "image_url" && typeof part.image_url?.url === "string" && ID.test(part.image_url.url)) {
			const file = await lookup(part.image_url.url);
			if (file === null) return part;
			if (!file.meta.mime_type.startsWith("image/")) throw wrong(file.meta.id, "an image");
			return { ...part, image_url: { ...part.image_url, url: dataUrl(file) } };
		}
		return part;
	};
	const each = async (list, one) => {
		const out = [];
		let changed = false;
		for (const item of list) {
			let next = await one(item);
			if (next?.type === "tool_result" && Array.isArray(next.content)) {
				const inner = await each(next.content, one);
				if (inner !== next.content) next = { ...next, content: inner };
			}
			if (next !== item) changed = true;
			out.push(next);
		}
		return changed ? out : list;
	};
	const one = front === "anthropic" ? anthropic : openai;
	let changed = false;
	const messages = [];
	for (const message of body.messages) {
		const content = Array.isArray(message?.content) ? await each(message.content, one) : message?.content;
		if (content !== message?.content) {
			changed = true;
			messages.push({ ...message, content });
		} else messages.push(message);
	}
	return changed ? { ...body, messages } : body;
}

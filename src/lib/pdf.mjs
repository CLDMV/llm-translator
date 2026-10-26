/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/pdf.mjs
 *	@Date: 2026-10-25T12:28:19-07:00 (1792956499)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:02-07:00 (1792958342)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview PDF text extraction and page rendering (unpdf + @napi-rs/canvas), loaded explicitly via `load()`.
 */

import { TranslatorError } from "./errors.mjs";

let unpdf = null;
let canvas = null;
let loaded = false;

/**
 * Load the PDF libraries. Safe to call repeatedly; each call re-imports. A library that fails to load is reported
 * in the result instead of throwing, so the translator can degrade (text only, or a note).
 * @param {(name: string) => Promise<any>} [importer] - Module importer (overridable for tests).
 * @returns {Promise<{ unpdf: boolean, canvas: boolean, errors: { unpdf?: string, canvas?: string } }>} Load result.
 */
export async function load(importer = (name) => import(name)) {
	const errors = {};
	unpdf = null;
	canvas = null;
	try {
		unpdf = await importer("unpdf");
	} catch (error) {
		errors.unpdf = error.message;
	}
	try {
		canvas = await importer("@napi-rs/canvas");
	} catch (error) {
		errors.canvas = error.message;
	}
	loaded = true;
	return { unpdf: unpdf !== null, canvas: canvas !== null, errors };
}

/**
 * Which libraries are currently loaded.
 * @returns {{ unpdf: boolean, canvas: boolean }} Availability.
 */
export function available() {
	return { unpdf: unpdf !== null, canvas: canvas !== null };
}

/**
 * Load lazily when `load()` has never run, then require unpdf.
 * @returns {Promise<void>} Resolves when unpdf is usable.
 */
async function ensure() {
	if (!loaded) await load();
	if (unpdf === null)
		throw new TranslatorError("PDF support is unavailable: the unpdf library could not be loaded", {
			code: "pdf_unavailable",
			status: 501
		});
}

/**
 * Open a document, enforcing the size and page limits.
 * @param {Uint8Array} bytes - PDF bytes.
 * @param {{ maxPages: number, maxBytes: number }} limits - Limits.
 * @returns {Promise<any>} unpdf document proxy.
 */
async function open(bytes, limits) {
	await ensure();
	if (bytes.length > limits.maxBytes) {
		throw new TranslatorError(`PDF is too large: ${bytes.length} bytes exceeds the ${limits.maxBytes} byte maximum`, {
			code: "pdf_too_large",
			status: 413,
			type: "request_too_large"
		});
	}
	let proxy;
	try {
		proxy = await unpdf.getDocumentProxy(new Uint8Array(bytes));
	} catch (error) {
		throw new TranslatorError(`The PDF could not be read: ${error.message}`, {
			code: "pdf_unreadable",
			status: 400,
			details: { name: error.name }
		});
	}
	if (proxy.numPages > limits.maxPages) {
		await proxy.loadingTask.destroy();
		throw new TranslatorError(`A maximum of ${limits.maxPages} PDF pages may be provided (this document has ${proxy.numPages})`, {
			code: "pdf_too_many_pages",
			status: 400
		});
	}
	return proxy;
}

/**
 * Extract the text of every page.
 * @param {Uint8Array} bytes - PDF bytes.
 * @param {{ maxPages: number, maxBytes: number }} limits - Limits (Anthropic: 100 pages, 32 MB).
 * @returns {Promise<{ pageCount: number, title: string|null, pages: string[] }>} Page texts and the document title.
 * @throws {TranslatorError} `pdf_too_large`, `pdf_too_many_pages`, `pdf_unreadable` or `pdf_unavailable`.
 */
export async function extract(bytes, limits) {
	const proxy = await open(bytes, limits);
	try {
		const { text } = await unpdf.extractText(proxy, { mergePages: false });
		const { info } = await unpdf.getMeta(proxy);
		return { pageCount: proxy.numPages, title: typeof info?.Title === "string" && info.Title !== "" ? info.Title : null, pages: text };
	} finally {
		await proxy.loadingTask.destroy();
	}
}

/**
 * Render pages to PNG images.
 * @param {Uint8Array} bytes - PDF bytes.
 * @param {number[]} pageNumbers - 1-based page numbers.
 * @param {{ maxPages: number, maxBytes: number, scale: number }} options - Limits and render scale.
 * @returns {Promise<{ media_type: "image/png", data: string }[]>} Base64 PNGs in page order.
 * @throws {TranslatorError} `pdf_unavailable` when @napi-rs/canvas is not loaded.
 */
export async function render(bytes, pageNumbers, options) {
	const proxy = await open(bytes, options);
	try {
		if (canvas === null) {
			throw new TranslatorError("PDF page rendering is unavailable: @napi-rs/canvas could not be loaded", {
				code: "pdf_unavailable",
				status: 501
			});
		}
		const images = [];
		for (const page of pageNumbers) {
			const png = await unpdf.renderPageAsImage(proxy, page, { canvasImport: async () => canvas, scale: options.scale });
			images.push({ media_type: "image/png", data: Buffer.from(png).toString("base64") });
		}
		return images;
	} finally {
		await proxy.loadingTask.destroy();
	}
}

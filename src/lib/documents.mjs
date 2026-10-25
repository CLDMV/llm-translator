/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/documents.mjs
 *	@Date: 2026-10-25T12:28:19-07:00 (1792956499)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:01-07:00 (1792958341)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Anthropic `document` blocks to plain content blocks (text and images), reproducing the
 * server-side PDF preprocessing the Anthropic API does (per-page text plus page images).
 */

import { TranslatorError } from "./errors.mjs";
import * as pdf from "./pdf.mjs";

const NOTE_CODES = new Set(["pdf_unreadable", "pdf_unavailable"]);

/**
 * Context for converting documents.
 * @typedef {object} DocumentContext
 * @property {import("./settings.mjs").Settings} settings - Resolved settings.
 * @property {Map<string, any>} toolInputs - `tool_use` inputs by id, to recover file paths.
 * @property {string|null} toolUseId - Id of the tool call whose result contains the document, if any.
 */

/**
 * Convert a document block into Anthropic text/image blocks.
 * @param {any} block - Anthropic `document` block.
 * @param {DocumentContext} ctx - Conversion context.
 * @returns {Promise<any[]>} Content blocks (`text` and `image`).
 * @throws {TranslatorError} When `documents` is `"error"` or a PDF violates the size/page limits.
 */
export async function expand(block, ctx) {
	const { settings } = ctx;
	if (settings.documentConverter) return await settings.documentConverter(block, ctx);
	if (settings.documents === "error") {
		throw new TranslatorError("Document content blocks are not supported by this translator configuration", {
			code: "unsupported_document",
			param: "messages"
		});
	}
	const name = nameOf(block, ctx);
	if (settings.documents === "note") return [note(name, "document conversion is disabled", ctx)];
	const source = block.source ?? {};
	if (source.type === "text") return [wrap(block, source.data)];
	if (source.type === "content") return typeof source.content === "string" ? [{ type: "text", text: source.content }] : source.content;
	if (source.type === "base64" && source.media_type === "application/pdf")
		return await expandPdf(block, Buffer.from(source.data, "base64"), name, ctx);
	if (source.type === "base64" && source.media_type === "text/plain")
		return [wrap(block, Buffer.from(source.data, "base64").toString("utf8"))];
	if (source.type === "url") return [note(name, "documents referenced by URL cannot be fetched by the translator", ctx)];
	return [
		note(name, `document sources of type ${source.type}${source.media_type ? ` (${source.media_type})` : ""} are not supported`, ctx)
	];
}

/**
 * Convert PDF bytes: page text always, page images when enabled and available.
 * @param {any} block - Document block.
 * @param {Buffer} bytes - PDF bytes.
 * @param {string} name - Display name.
 * @param {DocumentContext} ctx - Conversion context.
 * @returns {Promise<any[]>} Content blocks.
 */
async function expandPdf(block, bytes, name, ctx) {
	const { settings } = ctx;
	let extracted;
	try {
		extracted = await pdf.extract(bytes, settings.pdf);
	} catch (error) {
		if (error instanceof TranslatorError && NOTE_CODES.has(error.code)) return [note(name, error.message, ctx)];
		throw error;
	}
	const title = block.title ?? extracted.title;
	const heading = `${title ? `Document "${title}"` : "Document"} (${extracted.pageCount} page${extracted.pageCount === 1 ? "" : "s"})`;
	const wantImages = settings.images && settings.pdf.pages && pdf.available().canvas;
	if (!wantImages) {
		const pages = extracted.pages.map((text, i) => `--- Page ${i + 1} ---\n${text}`);
		return [{ type: "text", text: `${heading}\n\n${pages.join("\n\n")}` }];
	}
	const count = Math.min(extracted.pageCount, settings.pdf.maxImages);
	let images;
	try {
		images = await pdf.render(
			bytes,
			Array.from({ length: count }, (_, i) => i + 1),
			settings.pdf
		);
	} catch {
		// Rendering is best effort: the page text is still delivered.
		images = [];
	}
	/** @type {any[]} */
	const out = [{ type: "text", text: heading }];
	extracted.pages.forEach((text, i) => {
		out.push({ type: "text", text: `--- Page ${i + 1} ---\n${text}` });
		if (i < images.length) out.push({ type: "image", source: { type: "base64", ...images[i] } });
	});
	return out;
}

/**
 * Wrap plain document text, honouring `title` and `context`.
 * @param {any} block - Document block.
 * @param {string} body - Document text.
 * @returns {{ type: "text", text: string }} Text block.
 */
function wrap(block, body) {
	const attr = block.title ? ` title="${block.title}"` : "";
	const context = block.context ? `${block.context}\n\n` : "";
	return { type: "text", text: `<document${attr}>\n${context}${body}\n</document>` };
}

/**
 * Display name for a document: its title, else the file path of the originating tool call, else a placeholder.
 * @param {any} block - Document block.
 * @param {DocumentContext} ctx - Conversion context.
 * @returns {string} Name.
 */
function nameOf(block, ctx) {
	return block.title ?? pathOf(ctx) ?? "(unnamed)";
}

/**
 * File path of the tool call that produced the document, when its input has one.
 * @param {DocumentContext} ctx - Conversion context.
 * @returns {string|null} Path or null.
 */
function pathOf(ctx) {
	const input = ctx.toolUseId === null ? undefined : ctx.toolInputs.get(ctx.toolUseId);
	return input?.file_path ?? null;
}

/**
 * Text block telling the model a document could not be read, with a shell hint when a path is known.
 * @param {string} name - Display name.
 * @param {string} reason - Why the document is unavailable.
 * @param {DocumentContext} ctx - Conversion context.
 * @returns {{ type: "text", text: string }} Note block.
 */
function note(name, reason, ctx) {
	const path = pathOf(ctx);
	const hint = path ? ` To read it, run \`pdftotext -layout ${path} -\` with the shell tool.` : "";
	return { type: "text", text: `[The document "${name}" could not be read by this model. ${reason.replace(/\.$/, "")}.${hint}]` };
}

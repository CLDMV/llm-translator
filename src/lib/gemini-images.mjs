/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/gemini-images.mjs
 *	@Date: 2026-11-22T10:00:00-08:00 (1795370400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T10:00:00-08:00 (1795370400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Images for Gemini: a GIF (which Gemini does not read) is turned into a PNG of its first frame before the body is built, whether it came inline or, with the `documentUrls` setting, from a URL.
 * @module @cldmv/llm-translator/lib/gemini-images
 */
import { canvasModule } from "./pdf.mjs";
import { fetchUrl, FetchError } from "./fetch-url.mjs";
import { display } from "./document-urls.mjs";

/** The content type a fetched GIF is accepted as. */
const GIF = new Map([["image/gif", "image/gif"]]);

/**
 * Turn GIF bytes into a PNG data URL (the first frame).
 * @param {Buffer} bytes - GIF file.
 * @returns {Promise<string | null>} The data URL, or null when the image cannot be decoded (or the canvas library is not loaded).
 */
async function png(bytes) {
	const canvas = canvasModule();
	if (canvas === null) return null;
	try {
		const image = await canvas.loadImage(bytes);
		const surface = canvas.createCanvas(image.width, image.height);
		surface.getContext("2d").drawImage(image, 0, 0);
		return `data:image/png;base64,${surface.toBuffer("image/png").toString("base64")}`;
	} catch {
		return null;
	}
}

/**
 * Replace every GIF image part of a Chat Completions body by a PNG one. A base64 GIF is decoded; a GIF at an http(s) URL is fetched when the
 * `documentUrls` setting is on (with its allow list and limits, and nothing else is fetched) and decoded. A GIF that cannot be had stays as it is,
 * and the body builder leaves a note in its place. The body is not changed: a copy is returned when anything was replaced.
 * @param {any} body - Chat Completions body.
 * @param {{options: any, report?: (event: {kind: string, message: string, [detail: string]: any}) => void, signal?: AbortSignal, fetch?: Function, deps?: any}} spec - The normalized `documentUrls` setting (null when fetching is off), a function that receives one event per fetch, the caller's abort signal, and replaceable parts for tests.
 * @returns {Promise<any>} The body.
 */
export async function prepare(body, { options, report, signal, fetch = fetchUrl, deps }) {
	if (!Array.isArray(body?.messages)) return body;
	let changed = false;
	const messages = [];
	for (const message of body.messages) {
		if (!Array.isArray(message?.content)) {
			messages.push(message);
			continue;
		}
		const content = [];
		for (const part of message.content) {
			content.push(part?.type === "image_url" ? await replace(part, { options, report, signal, fetch, deps }) : part);
		}
		if (content.some((part, at) => part !== message.content[at])) {
			changed = true;
			messages.push({ ...message, content });
		} else messages.push(message);
	}
	return changed ? { ...body, messages } : body;
}

/**
 * One image part, as a PNG part when it is a GIF that can be had.
 * @param {any} part - `image_url` content part.
 * @param {any} spec - See `prepare`.
 * @returns {Promise<any>} The part, or the same part.
 */
async function replace(part, { options, report, signal, fetch, deps }) {
	const url = String(part.image_url?.url ?? part.image_url ?? "");
	const inline = /^data:image\/gif;base64,(.*)$/s.exec(url);
	let bytes = inline === null ? null : Buffer.from(inline[1], "base64");
	if (bytes === null && options !== null && /^https?:\/\/[^?#]*\.gif(?:$|[?#])/i.test(url)) {
		try {
			bytes = (await fetch(url, { ...options, types: GIF, signal }, deps)).bytes;
			report?.({ kind: "fetched", level: "debug", message: `Fetched image ${display(url)} (${bytes.length} bytes)`, url: display(url) });
		} catch (cause) {
			const failure =
				cause instanceof FetchError ? cause : new FetchError("network", "the connection failed", String(cause?.message ?? cause));
			report?.({
				kind: "fetch",
				level: "warn",
				message: `Image ${display(url)} was not fetched: ${failure.detail}`,
				url: display(url),
				reason: failure.kind
			});
		}
	}
	if (bytes === null) return part;
	const converted = await png(bytes);
	return converted === null
		? part
		: { ...part, image_url: { ...(typeof part.image_url === "object" ? part.image_url : {}), url: converted } };
}

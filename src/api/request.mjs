/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/request.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:00-07:00 (1792958340)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Root api: turn a client request into a ready-to-send upstream request.
 * @module @cldmv/llm-translator/request
 */
import { context, self } from "../lib/runtime.mjs";
import { capture } from "../lib/capture.mjs";
import { TranslatorError } from "../lib/errors.mjs";
import { pick } from "../lib/route.mjs";
import * as http from "../lib/http.mjs";
import { filterChatBody } from "../lib/passthrough.mjs";
import * as images from "../lib/images.mjs";

/**
 * Route a client request body (in the configured `front` protocol) to an upstream and convert it to that upstream's
 * protocol. Does no I/O.
 * @param {any} body - Client request body (Anthropic Messages or OpenAI Chat Completions, per `front`).
 * @param {any} [options] - `{ front, headers, clientHeaders, filter, images }`. `front` overrides the configured front for this call, `headers` are extra upstream headers, `clientHeaders` are client headers forwarded only to a native Anthropic upstream, `filter` restricts a forwarded OpenAI body to known fields (default: the `passthroughFilter` setting, off), `images: false` sends the request without images (used by the image fallback).
 * @returns {Promise<{upstream: string, method: string, url: string, path: string, headers: Record<string,string>, body: any, state: any, images: {sent: boolean, retry: boolean, key: string}}>} The upstream request and the state `response`/`stream`/`error` need. `images` tells `send` whether the body carries images, whether a refusal may be retried without them and the key under which a refusal is remembered.
 */
export async function request(body, options = {}) {
	const c = capture(self, context, options.front);
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		throw new TranslatorError("The request body must be a JSON object", { code: "invalid_body", status: 400 });
	}
	const { endpoint, model, unserved } = pick(c.config, c.state.endpoints, body.model);
	const driver = c.driver(endpoint);
	const key = `${endpoint.name}\n${model}`;
	// A refusal remembered earlier in this process, or an explicit `images: false`, sends the request without images.
	const text = options.images === false || (c.state.textOnly.has(key) && c.settings(endpoint).imageFallback);
	const settings = text ? { ...c.settings(endpoint), images: false } : c.settings(endpoint);
	const convert = c.converters(endpoint);
	const stream = body.stream === true;
	let upstream;
	let converted;
	if (convert) {
		({ body: upstream, state: converted } = await convert.request(body, settings));
	} else {
		upstream = c.front === "openai" && (options.filter ?? settings.passthroughFilter === true) ? filterChatBody(body) : { ...body };
	}
	if (text && !convert && c.front === "openai") upstream = images.strip(upstream);
	upstream.model = model;
	if (driver.request) upstream = await driver.request(upstream, { endpoint, settings, state: converted });
	const path = endpoint.protocol === "openai.chat" ? driver.info.paths.chat : driver.info.paths.messages;
	return {
		upstream: endpoint.name,
		method: "POST",
		url: http.join(endpoint.url, path),
		path,
		headers: {
			"content-type": "application/json",
			accept: stream ? "text/event-stream" : "application/json",
			...driver.info.headers,
			...(convert === null && endpoint.protocol === "anthropic.messages" ? options.clientHeaders : undefined),
			...http.headers(endpoint, driver.info.auth, options.headers)
		},
		body: upstream,
		state: {
			v: 1,
			upstream: endpoint.name,
			front: c.front,
			native: convert === null,
			model: body.model,
			stream,
			unserved,
			convert: converted
		},
		images: { sent: images.carries(upstream), retry: settings.imageFallback && endpoint.protocol === "openai.chat", key }
	};
}

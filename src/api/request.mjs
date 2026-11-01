/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/request.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-31T14:45:53-07:00 (1793483153)
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
import { resolve } from "../lib/route.mjs";
import * as http from "../lib/http.mjs";
import { filterChatBody } from "../lib/passthrough.mjs";
import * as images from "../lib/images.mjs";
import * as tools from "../lib/tools.mjs";
import { LIMITS } from "../lib/toolsearch.mjs";
import { warn } from "../lib/warn.mjs";

/**
 * Who produced reasoning data signed for this endpoint: driver, protocol and host, so two upstreams on the generic driver stay apart.
 * @param {any} endpoint - Runtime endpoint.
 * @returns {string} `driver:protocol:host`.
 */
function producerOf(endpoint) {
	return `${endpoint.driver}:${endpoint.protocol}:${URL.canParse(endpoint.url) ? new URL(endpoint.url).host : endpoint.url}`;
}

/**
 * Route a client request body (in the configured `front` protocol) to an upstream and convert it to that upstream's
 * protocol. Does no I/O.
 * @param {any} body - Client request body (Anthropic Messages or OpenAI Chat Completions, per `front`).
 * @param {any} [options] - `{ front, headers, clientHeaders, filter, images, usage }`. `front` overrides the configured front for this call, `headers` are extra upstream headers, `clientHeaders` are client headers forwarded only to a native Anthropic upstream, `filter` restricts a forwarded OpenAI body to known fields (default: the `passthroughFilter` setting, off), `images: false` sends the request without images (used by the image fallback), `endpoint` sends to that member of the model's pool (used for failover; default: the first in the pool's order), `hold: true` (used by `send`) advances a round robin and takes the chosen endpoint's in-flight slot, which the caller then releases, `tools: false` sends the request without tools (used by the tool fallback), `usage: true` (used by `send`) makes a streaming OpenAI-front request always ask the upstream for its final usage chunk, `budget` (from `createBudget`, one per `send` for all its attempts) limits the cost of decoding reasoning signatures.
 * @returns {Promise<{upstream: string, method: string, url: string, path: string, headers: Record<string,string>, body: any, state: any, pool: string[], images: {sent: boolean, retry: boolean, key: string}, tools: {sent: boolean, retry: boolean}}>} The upstream request and the state `response`/`stream`/`error` need. `pool` lists the names of the endpoints serving the model in the order they are tried (`upstream` is the first); `images` tells `send` whether the body carries images, whether a refusal may be retried without them and the key under which a refusal is remembered; `tools` tells it whether the body carries tools and whether a tool-parser refusal may be retried without them.
 */
export async function request(body, options = {}) {
	const c = capture(self, context, options.front);
	const picked = resolve(c, body, { endpoint: options.endpoint, advance: options.hold === true && options.endpoint === undefined });
	if (options.hold !== true) return prepare(c, body, options, picked);
	// `send` takes the in-flight slot of the chosen endpoint here, in the same synchronous step as the pick, so concurrent requests see it.
	picked.endpoint.health.inflight++;
	try {
		return await prepare(c, body, options, picked);
	} catch (cause) {
		picked.endpoint.health.inflight--;
		throw cause;
	}
}

/**
 * Convert the client body for the chosen endpoint and describe the upstream call (the part of `request` after the pick).
 * @param {any} c - Captured translator parts.
 * @param {any} body - Client request body.
 * @param {any} options - The `request` options.
 * @param {any} picked - Result of `resolve`.
 * @returns {Promise<any>} The `request` result.
 */
async function prepare(c, body, options, picked) {
	const { endpoint, model, unserved, convert, pool } = picked;
	const driver = c.driver(endpoint);
	const key = `${endpoint.name}\n${model}`;
	// A refusal remembered earlier in this process, or an explicit `images: false`, sends the request without images.
	const text = options.images === false || (c.state.textOnly.has(key) && c.settings(endpoint).imageFallback);
	const settings = text ? { ...c.settings(endpoint), images: false } : c.settings(endpoint);
	const stream = body.stream === true;
	let upstream;
	let converted;
	if (convert) {
		({ body: upstream, state: converted } = await convert.request(body, settings, {
			producer: producerOf(endpoint),
			budget: options.budget
		}));
		if (converted.toolSearch?.capped) {
			warn(
				c.config,
				c.state,
				`Tool search: more than ${LIMITS.definitions} tool definitions came back in ToolSearch results for ${endpoint.name}; the rest are not offered.`
			);
		}
	} else {
		upstream =
			c.front === "openai" && (options.filter ?? settings.passthroughFilter === true)
				? filterChatBody(body, driver.info.fields)
				: { ...body };
	}
	if (options.usage === true && stream && c.front === "openai") {
		// Internal (used by `send`): always ask for the final usage chunk so usage can be metered; `send` hides it from clients that did not ask.
		if (convert) converted.includeUsage = true;
		else if (settings.streamUsage) {
			// Not forced when `streamUsage` is off (an upstream that rejects `stream_options`); the client's own stream_options pass through as before.
			const given = upstream.stream_options && typeof upstream.stream_options === "object" ? upstream.stream_options : {};
			upstream.stream_options = { ...given, include_usage: true };
		}
	}
	if (text && !convert && c.front === "openai") upstream = images.strip(upstream);
	if (options.tools === false) upstream = tools.strip(upstream);
	upstream.model = model;
	if (converted?.reasoningMissing) {
		warn(
			c.config,
			c.state,
			`Upstream ${endpoint.name}: assistant turns with tool calls have no reasoning to send back (the client dropped its thinking blocks or their signatures), which servers that need it with tools will refuse.`
		);
	}
	if (driver.request)
		upstream = await driver.request(upstream, {
			endpoint,
			settings,
			state: converted,
			warn: (message) => warn(c.config, c.state, message)
		});
	const path = endpoint.protocol === "openai.chat" ? driver.info.paths.chat : driver.info.paths.messages;
	return {
		upstream: endpoint.name,
		pool: pool.map((entry) => entry.name),
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
		images: { sent: images.carries(upstream), retry: settings.imageFallback && endpoint.protocol === "openai.chat", key },
		tools: { sent: tools.carries(upstream), retry: settings.toolFallback && endpoint.protocol === "openai.chat" }
	};
}

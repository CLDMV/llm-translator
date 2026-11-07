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
import { addSampling } from "../lib/sampling.mjs";
import * as images from "../lib/images.mjs";
import * as tools from "../lib/tools.mjs";
import { LIMITS } from "../lib/toolsearch.mjs";
import { warn } from "../lib/warn.mjs";
import { emit } from "../lib/events.mjs";
import { fit, pinBody } from "../lib/effort.mjs";

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
 * @param {any} [options] - `{ front, headers, clientHeaders, filter, images, usage }`. `front` overrides the configured front for this call, `headers` are extra upstream headers, `clientHeaders` are client headers forwarded only to a native Anthropic upstream, `filter` restricts a forwarded OpenAI body to known fields (default: the `passthroughFilter` setting, off), `images: false` sends the request without images (used by the image fallback), `endpoint` sends to that member of the model's pool (used for failover; default: the first in the pool's order), `hold: true` (used by `send`) advances a round robin and takes the chosen endpoint's in-flight slot, which the caller then releases, `jsonObject: "instruction"` sends a `json_object` response format as a system instruction (used by the JSON fallback, and applied by itself once a refusal is remembered for the endpoint and model), `tools: false` sends the request without tools (used by the tool fallback), `usage: true` (used by `send`) makes a streaming OpenAI-front request always ask the upstream for its final usage chunk, `retry: true` (used by `send` for the same request sent again) keeps the `dropped` event from repeating, `log` is the logger events of this request also go to (used by the server), `budget` (from `createBudget`, one per `send` for all its attempts) limits the cost of decoding reasoning signatures.
 * @returns {Promise<{upstream: string, method: string, url: string, path: string, headers: Record<string,string>, body: any, state: any, pool: string[], images: {sent: boolean, retry: boolean, key: string}, tools: {sent: boolean, retry: boolean}, json: {sent: boolean, retry: boolean, key: string}}>} The upstream request and the state `response`/`stream`/`error` need. `pool` lists the names of the endpoints serving the model in the order they are tried (`upstream` is the first); `images` tells `send` whether the body carries images, whether a refusal may be retried without them and the key under which a refusal is remembered; `tools` tells it whether the body carries tools and whether a tool-parser refusal may be retried without them; `json` tells it whether the body carries the schema emulation of `json_object`, whether a refusal may be retried with the instruction and the key under which a refusal is remembered.
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
	const { endpoint, model, unserved, convert, pool, pin } = picked;
	const levels = Object.hasOwn(c.config.efforts, model) ? c.config.efforts[model] : undefined;
	// An alias that pins settings overrides what the request asked for, before conversion; a pinned effort is always mapped.
	if (pin) body = pinBody(body, pin, c.front);
	const driver = c.driver(endpoint);
	const key = `${endpoint.name}\n${model}`;
	// A refusal remembered earlier in this process, or an explicit `images: false`, sends the request without images.
	const text = options.images === false || (c.state.textOnly.has(key) && c.settings(endpoint).imageFallback);
	const base = c.settings(endpoint);
	// Likewise a remembered refusal of the JSON schema, or an explicit `jsonObject: "instruction"`, sends `json_object` as an instruction.
	const instruction = options.jsonObject === "instruction" || (c.state.jsonInstruction.has(key) && base.jsonObjectFallback);
	const settings = {
		...(text ? { ...base, images: false } : base),
		...(instruction ? { jsonObject: "instruction" } : {}),
		...(pin?.effort === undefined ? {} : { effort: true })
	};
	const stream = body.stream === true;
	let upstream;
	let converted;
	if (convert) {
		({ body: upstream, state: converted } = await convert.request(body, settings, {
			producer: producerOf(endpoint),
			budget: options.budget,
			listed: levels !== undefined
		}));
		if (converted.toolSearch?.capped) {
			warn(
				c.config,
				c.state,
				`Tool search: more than ${LIMITS.definitions} tool definitions came back in ToolSearch results for ${endpoint.name}; the rest are not offered.`,
				{ kind: "toolsearch", endpoint: endpoint.name, log: options.log }
			);
		}
	} else {
		upstream =
			c.front === "openai" && (options.filter ?? settings.passthroughFilter === true)
				? filterChatBody(body, driver.info.fields)
				: { ...body };
	}
	// Sampling extensions: the upstream's `sampling` setting and an Anthropic request's `metadata.sampling` (which is not a real metadata key,
	// so it never travels upstream as such).
	const asked = c.front === "anthropic" ? body.metadata?.sampling : undefined;
	if (endpoint.protocol === "openai.chat") {
		const dropped = [];
		upstream = addSampling(upstream, asked, settings, driver.info.fields, dropped);
		if (converted && dropped.length > 0) for (const name of dropped) if (!converted.dropped.includes(name)) converted.dropped.push(name);
	} else if (!convert && asked !== undefined && upstream.metadata?.sampling !== undefined) {
		const { sampling: _, ...rest } = upstream.metadata;
		upstream = { ...upstream, metadata: rest };
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
	// A model with a configured level list gets an effort it supports (and the default one when the request names none).
	if (levels && endpoint.protocol === "openai.chat")
		fit(upstream, levels, model, (message, details) =>
			warn(c.config, c.state, message, { type: "effort", endpoint: endpoint.name, model, ...details, log: options.log })
		);
	if (converted?.reasoningMissing) {
		warn(
			c.config,
			c.state,
			`Upstream ${endpoint.name}: assistant turns with tool calls have no reasoning to send back (the client dropped its thinking blocks or their signatures), which servers that need it with tools will refuse.`,
			{ kind: "reasoning", endpoint: endpoint.name, log: options.log }
		);
	}
	if (driver.request)
		upstream = await driver.request(upstream, {
			endpoint,
			settings,
			levels,
			state: converted,
			warn: (message) => warn(c.config, c.state, message, { kind: "driver", endpoint: endpoint.name, log: options.log })
		});
	// The fields the conversion and the driver left out, once per upstream request (a retry of the same request does not repeat it).
	if (converted?.dropped?.length > 0 && options.retry !== true) {
		emit(c, {
			type: "dropped",
			level: "debug",
			message: `Upstream ${endpoint.name}: dropped ${converted.dropped.join(", ")}`,
			endpoint: endpoint.name,
			model,
			fields: [...converted.dropped],
			log: options.log
		});
	}
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
		tools: { sent: tools.carries(upstream), retry: settings.toolFallback && endpoint.protocol === "openai.chat" },
		// Only an Anthropic-protocol upstream gets the emulated schema, so this never overlaps with the image and tool retries above.
		json: {
			sent: converted?.jsonSchemaEmulated === true,
			retry: settings.jsonObjectFallback && endpoint.protocol === "anthropic.messages",
			key
		}
	};
}

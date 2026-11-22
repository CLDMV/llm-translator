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
import { addConstraint } from "../lib/constraint.mjs";
import { addCache } from "../lib/cache.mjs";
import * as images from "../lib/images.mjs";
import * as tools from "../lib/tools.mjs";
import { LIMITS } from "../lib/toolsearch.mjs";
import { warn } from "../lib/warn.mjs";
import { emit } from "../lib/events.mjs";
import { fit, pinBody } from "../lib/effort.mjs";
import { relax, strictTools } from "../lib/strict.mjs";
import { TranslatorError } from "../lib/errors.mjs";
import * as vllm from "../lib/vllm.mjs";
import * as documentUrls from "../lib/document-urls.mjs";
import { PROTOCOL as RESPONSES } from "../lib/responses-upstream.mjs";
import { CONVERSE, GEMINI } from "../lib/protocol.mjs";

/**
 * Who produced reasoning data signed for this endpoint: driver, protocol and host, so two upstreams on the generic driver stay apart.
 * @param {any} endpoint - Runtime endpoint.
 * @param {string} protocol - The protocol of the request.
 * @returns {string} `driver:protocol:host`.
 */
function producerOf(endpoint, protocol) {
	return `${endpoint.driver}:${protocol}:${URL.canParse(endpoint.url) ? new URL(endpoint.url).host : endpoint.url}`;
}

/**
 * Route a client request body (in the configured `front` protocol) to an upstream and convert it to that upstream's
 * protocol. Does no I/O.
 * @param {any} body - Client request body (Anthropic Messages or OpenAI Chat Completions, per `front`).
 * @param {any} [options] - `{ front, headers, clientHeaders, filter, images, usage, signal }`. `signal` aborts the fetching of `url` documents (the `documentUrls` setting). `front` overrides the configured front for this call, `tokens: true` (used by `token.count`) never picks a native Messages route on a server whose own protocol is another, because the tokenizer reads Chat Completions messages, and sends no credentials (a driver's `auth` leaf is skipped; the count call builds its own headers), `wire: "responses"` says the body is the Chat Completions form of a Responses API request (so the protocol is chosen for a Responses client), `headers` are extra upstream headers, `clientHeaders` are client headers forwarded only to a native Anthropic upstream, `filter` restricts a forwarded OpenAI body to known fields (default: the `passthroughFilter` setting, off), `images: false` sends the request without images (used by the image fallback), `endpoint` sends to that member of the model's pool (used for failover; default: the first in the pool's order), `hold: true` (used by `send`) advances a round robin and takes the chosen endpoint's in-flight slot, which the caller then releases, `jsonObject: "instruction"` sends a `json_object` response format as a system instruction (used by the JSON fallback, and applied by itself once a refusal is remembered for the endpoint and model), `tools: false` sends the request without tools (used by the tool fallback), `usage: true` (used by `send`) makes a streaming OpenAI-front request always ask the upstream for its final usage chunk, `cacheSalt` (a trusted per-call vLLM `cache_salt`, which replaces the upstream's `cacheSalt` setting), `retry: true` (used by `send` for the same request sent again) keeps the `dropped` event from repeating, `log` is the logger events of this request also go to (used by the server), `budget` (from `createBudget`, one per `send` for all its attempts) limits the cost of decoding reasoning signatures.
 * @returns {Promise<{upstream: string, method: string, url: string, path: string, headers: Record<string,string>, body: any, state: any, pool: string[], more: boolean, images: {sent: boolean, retry: boolean, key: string}, tools: {sent: boolean, retry: boolean}, json: {sent: boolean, retry: boolean, key: string}}>} The upstream request and the state `response`/`stream`/`error` need. `pool` lists the names of the endpoints serving the model in the order they are tried (`upstream` is the first); `more` is true when the upstream is `api: "auto"` and has another protocol to fall back to; `images` tells `send` whether the body carries images, whether a refusal may be retried without them and the key under which a refusal is remembered; `tools` tells it whether the body carries tools and whether a tool-parser refusal may be retried without them; `json` tells it whether the body carries the schema emulation of `json_object`, whether a refusal may be retried with the instruction and the key under which a refusal is remembered.
 */
export async function request(body, options = {}) {
	const c = capture(self, context, options.front);
	const picked = resolve(c, body, {
		endpoint: options.endpoint,
		wire: options.wire,
		tokens: options.tokens,
		advance: options.hold === true && options.endpoint === undefined
	});
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
 * Handle strict tools the upstream cannot honour. A schema outside the strict subset is an error under `unknownFields: "error"`;
 * otherwise the tool is sent without `strict` (also on a retry, which only skips the warnings) and a warning says so. A driver whose
 * backend does not enforce strict use gets a warning listing the tools that are still strict. Tools with conforming schemas keep `strict`.
 * @param {any} c - Captured translator parts.
 * @param {any} upstream - Upstream body.
 * @param {any} endpoint - Chosen endpoint.
 * @param {any} driver - The endpoint's driver.
 * @param {any} settings - Resolved settings for the endpoint.
 * @param {any} options - The `request` options.
 * @returns {any} The upstream body to send: `upstream` itself, or a copy when `strict` was removed from a tool.
 * @throws {TranslatorError} For a schema outside the subset when `unknownFields` is `"error"`.
 */
function checkStrict(c, upstream, endpoint, driver, settings, options) {
	const strict = strictTools(upstream);
	if (strict.length === 0) return upstream;
	const bad = strict.filter((tool) => tool.problems.length > 0);
	if (bad.length > 0 && settings.unknownFields === "error") {
		throw new TranslatorError(`tools: ${bad[0].name}: schema is outside the strict subset (${bad[0].problems.join("; ")})`, {
			code: "unsupported_content",
			param: "tools"
		});
	}
	const sent = relax(upstream);
	if (options.retry === true) return sent;
	const tell = (message, kind) => warn(c.config, c.state, message, { kind, endpoint: endpoint.name, log: options.log });
	for (const tool of bad) {
		tell(
			`Upstream ${endpoint.name}: strict tool ${tool.name} has a schema outside the strict subset: ${tool.problems.join("; ")} (sent without strict)`,
			"strict"
		);
	}
	const kept = strict.filter((tool) => tool.problems.length === 0);
	if (driver.info.strict !== true && kept.length > 0) {
		tell(
			`Upstream ${endpoint.name}: the ${driver.name} backend does not enforce strict tool use (${kept.map((t) => t.name).join(", ")})`,
			"strict"
		);
	}
	return sent;
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
	const { endpoint, model, unserved, convert, pool, pin, protocol } = picked;
	const levels = Object.hasOwn(c.config.efforts, model) ? c.config.efforts[model] : undefined;
	// An alias that pins settings overrides what the request asked for, before conversion; a pinned effort is always mapped.
	if (pin) body = pinBody(body, pin, c.front);
	const driver = c.driver(endpoint);
	// A constraint (constrained decoding) rides in `constraint` on the OpenAI front and in `metadata.constraint` on the Anthropic front; it is never
	// a field of the converted body, so it is taken out of the OpenAI body before conversion.
	// The Anthropic front's prompt cache key is `metadata.prompt_cache_key`, an extension that never travels upstream as such.
	const cacheKey = c.front === "anthropic" ? body.metadata?.prompt_cache_key : undefined;
	let constraint = c.front === "anthropic" ? body.metadata?.constraint : undefined;
	if (c.front === "openai" && body.constraint !== undefined) ({ constraint, ...body } = body);
	const key = `${endpoint.name}\n${model}`;
	// A refusal remembered earlier in this process, or an explicit `images: false`, sends the request without images.
	const text = options.images === false || (c.state.textOnly.has(key) && c.settings(endpoint, protocol).imageFallback);
	const base = c.settings(endpoint, protocol);
	// Likewise a remembered refusal of the JSON schema, or an explicit `jsonObject: "instruction"`, sends `json_object` as an instruction.
	const instruction = options.jsonObject === "instruction" || (c.state.jsonInstruction.has(key) && base.jsonObjectFallback);
	const settings = {
		...(text ? { ...base, images: false } : base),
		...(instruction ? { jsonObject: "instruction" } : {}),
		...(pin?.effort === undefined ? {} : { effort: true })
	};
	const stream = body.stream === true;
	// A native pass-through to a server whose own protocol is another: vLLM's `/v1/messages`, which takes an Anthropic body.
	const viaMessages = protocol === "anthropic.messages" && convert === null && driver.info.protocol !== "anthropic.messages";
	// The `url` sources of document blocks are fetched here, before conversion, which does no I/O. A request that is forwarded as it is goes to
	// an Anthropic server that fetches them itself.
	if (convert && c.front === "anthropic" && documentUrls.wanted(settings)) {
		body = await documentUrls.resolve(body, {
			options: settings.documentUrls,
			signal: options.signal,
			report: (spec) => emit(c, { type: "document", ...spec, endpoint: endpoint.name, model, log: options.log })
		});
	}
	let upstream;
	let converted;
	if (convert) {
		({ body: upstream, state: converted } = await convert.request(body, settings, {
			producer: producerOf(endpoint, protocol),
			budget: options.budget,
			listed: levels !== undefined,
			model,
			toolCallIds: driver.info.toolCallIds,
			signal: options.signal,
			report: (spec) => emit(c, { type: "document", ...spec, endpoint: endpoint.name, model, log: options.log })
		}));
		if (converted.toolSearch?.capped) {
			warn(
				c.config,
				c.state,
				`Tool search: more than ${LIMITS.definitions} tool definitions came back in ToolSearch results for ${endpoint.name}; the rest are not offered.`,
				{ kind: "toolsearch", endpoint: endpoint.name, log: options.log }
			);
		}
	} else if (viaMessages) {
		upstream = vllm.request(body, settings);
	} else {
		upstream =
			c.front === "openai" && (options.filter ?? settings.passthroughFilter === true)
				? filterChatBody(body, driver.info.fields)
				: { ...body };
	}
	// Sampling extensions: the upstream's `sampling` setting and an Anthropic request's `metadata.sampling` (which is not a real metadata key,
	// so it never travels upstream as such).
	const asked = c.front === "anthropic" ? body.metadata?.sampling : undefined;
	if (protocol === "openai.chat") {
		const dropped = [];
		upstream = addSampling(upstream, asked, settings, driver.info.fields, dropped);
		if (converted) converted.dropped.push(...dropped.filter((name) => !converted.dropped.includes(name)));
	} else if (!convert && asked !== undefined && upstream.metadata?.sampling !== undefined) {
		const { sampling: _, ...rest } = upstream.metadata;
		upstream = { ...upstream, metadata: rest };
	}
	if (protocol === "openai.chat") {
		const dropped = [];
		const target = { name: driver.info.name, version: endpoint.facts?.version ?? endpoint.version };
		upstream = addConstraint(upstream, constraint, settings, target, dropped);
		upstream = addCache(upstream, { salt: options.cacheSalt, key: cacheKey }, settings, target.name, dropped);
		if (converted) converted.dropped.push(...dropped.filter((name) => !converted.dropped.includes(name)));
	} else {
		if (converted && !converted.dropped.includes("cache_salt") && (options.cacheSalt ?? settings.cacheSalt) != null)
			converted.dropped.push("cache_salt");
		if (converted && !converted.dropped.includes("prompt_cache_key") && (cacheKey ?? settings.promptCacheKey) != null)
			converted.dropped.push("prompt_cache_key");
		if (!convert && upstream.metadata?.prompt_cache_key !== undefined) {
			const { prompt_cache_key: _, ...rest } = upstream.metadata;
			upstream = { ...upstream, metadata: rest };
		}
		// No native constrained decoding to map to: a conversion records the drop; a forwarded Anthropic body must not carry the extension.
		if (converted && (constraint ?? settings.constraint) != null && !converted.dropped.includes("constraint"))
			converted.dropped.push("constraint");
		if (!convert && upstream.metadata?.constraint !== undefined) {
			const { constraint: _, ...rest } = upstream.metadata;
			upstream = { ...upstream, metadata: rest };
		}
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
	upstream = checkStrict(c, upstream, endpoint, driver, settings, options);
	// A model with a configured level list gets an effort it supports (and the default one when the request names none).
	if (levels && protocol === "openai.chat")
		fit(upstream, levels, model, (message, details) =>
			warn(c.config, c.state, message, { type: "effort", endpoint: endpoint.name, model, ...details, log: options.log })
		);
	// A Responses upstream never needs reasoning sent back to accept tool calls (a model without reasoning has none), so it gets no warning.
	if (converted?.reasoningMissing && protocol !== RESPONSES) {
		warn(
			c.config,
			c.state,
			`Upstream ${endpoint.name}: assistant turns with tool calls have no reasoning to send back (the client dropped its thinking blocks or their signatures), which servers that need it with tools will refuse.`,
			{ kind: "reasoning", endpoint: endpoint.name, log: options.log }
		);
	}
	// The driver's request leaf shapes a Chat Completions body, which neither a native `/v1/messages` body nor a Responses one is.
	if (driver.request && !viaMessages && protocol !== RESPONSES)
		upstream = await driver.request(upstream, {
			endpoint,
			settings,
			levels,
			protocol,
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
	const kind =
		protocol === "anthropic.messages"
			? "messages"
			: protocol === RESPONSES
				? "responses"
				: protocol === CONVERSE
					? "converse"
					: protocol === GEMINI
						? "gemini"
						: "chat";
	const path = await http.pathOf(driver, kind, endpoint, model, protocol, stream);
	const url = http.join(endpoint.url, path);
	let headers = {
		"content-type": "application/json",
		accept: stream ? "text/event-stream" : "application/json",
		...driver.info.headers,
		...(convert === null && endpoint.protocol === "anthropic.messages" ? options.clientHeaders : undefined),
		...http.headers(endpoint, driver.info.auth, options.headers)
	};
	// A driver whose credentials are fetched (Google's access tokens) has an `auth` leaf that returns the headers to send; token counting sends none of these headers.
	if (driver.auth && options.tokens !== true)
		headers = await driver.auth({ endpoint, headers, transport: c.state.transport, timeout: c.config.detectTimeout });
	// A driver that signs its calls (Amazon Bedrock's SigV4) sees the finished URL, headers and body, and returns the headers to send.
	if (driver.sign) headers = await driver.sign({ endpoint, protocol, method: "POST", url, headers, body: upstream, stream });
	// A driver whose server caches (Gemini's cached contents) turns the conversation up to a `cache_control` breakpoint into a cache and sends only what follows it; a token count sends the whole prompt.
	if (driver.cache && converted?.cache && converted.local === undefined && options.tokens !== true) {
		upstream = await driver.cache({
			endpoint,
			model,
			cache: converted.cache,
			body: upstream,
			headers,
			transport: c.state.transport,
			timeout: c.config.detectTimeout,
			warn: (message) => warn(c.config, c.state, message, { kind: "cache", endpoint: endpoint.name, log: options.log })
		});
	}
	return {
		upstream: endpoint.name,
		pool: pool.map((entry) => entry.name),
		method: "POST",
		url,
		path,
		headers,
		body: upstream,
		state: {
			v: 1,
			upstream: endpoint.name,
			front: c.front,
			native: convert === null,
			protocol,
			messages: viaMessages,
			responses: protocol === RESPONSES,
			model: body.model,
			stream,
			unserved,
			convert: converted
		},
		more: picked.more,
		images: { sent: images.carries(upstream), retry: settings.imageFallback && protocol === "openai.chat", key },
		tools: { sent: tools.carries(upstream), retry: settings.toolFallback && protocol === "openai.chat" },
		// Only an Anthropic-protocol upstream gets the emulated schema, so this never overlaps with the image and tool retries above.
		json: {
			sent: converted?.jsonSchemaEmulated === true,
			retry: settings.jsonObjectFallback && protocol === "anthropic.messages",
			key
		}
	};
}

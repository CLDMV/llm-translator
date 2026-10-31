/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/routes.mjs
 *	@Date: 2026-10-25T12:56:43-07:00 (1792958203)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-31T14:45:55-07:00 (1793483155)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Fastify routes for the Anthropic and OpenAI fronts, shared by `server.start` and `server.plugin`.
 * @module @cldmv/llm-translator/lib/routes
 */
import { timingSafeEqual } from "node:crypto";
import { TranslatorError } from "./errors.mjs";
import { messageId } from "./ids.mjs";
import { sign } from "./thinking.mjs";

const BODY_LIMIT = 64 * 1024 * 1024;
const SSE_HEADERS = { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", "x-accel-buffering": "no" };

const STALLED = Symbol("stalled");
const GONE = Symbol("gone");

/**
 * Wait for `promise`, but give up waiting after `interval` ms so the caller can commit to a streaming reply.
 * @param {Promise<any>} promise - Pending upstream round trip.
 * @param {number} interval - Maximum wait in ms; `0` waits indefinitely.
 * @returns {Promise<any>} The promise's value, or `STALLED` when the interval elapsed first.
 */
async function settle(promise, interval) {
	if (!(interval > 0)) return promise;
	let timer;
	const stalled = new Promise((resolve) => {
		timer = setTimeout(resolve, interval, STALLED);
	});
	try {
		return await Promise.race([promise, stalled]);
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Events for a stream reply committed before the upstream answered: the upstream's stream when it accepted, else its error
 * as a final error event (the HTTP status is already 200, so the error travels in-band).
 * @param {Promise<any>} sending - Pending `send` result.
 * @param {any} api - Captured translator parts.
 * @param {string} [model] - Model the client asked for (used in the early `message_start`).
 * @returns {AsyncGenerator<any>} Client events.
 */
async function* late(sending, api, model) {
	const anthropic = api.front === "anthropic";
	if (anthropic) {
		// Anthropic's API opens every stream with `message_start` before any token exists, and clients (Claude Code) treat
		// the first real event as the sign that the request was accepted. Send it now, with the model the client asked
		// for, together with an empty thinking block that the keep-alives (see `sse.ping`) can ride on while the upstream
		// is still working. When the upstream answers, a first thinking block of its own takes over the early one; otherwise the early block is closed
		// and the upstream's blocks are shifted by one index.
		yield {
			event: "message_start",
			data: {
				type: "message_start",
				message: {
					id: messageId(),
					type: "message",
					role: "assistant",
					model,
					content: [],
					stop_reason: null,
					stop_sequence: null,
					usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
				}
			}
		};
		yield {
			event: "content_block_start",
			data: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }
		};
	}
	const result = await sending;
	// Closes the early thinking block (its signature is ours, like the converter's).
	const closeEarly = function* () {
		yield {
			event: "content_block_delta",
			data: { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: sign() } }
		};
		yield { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } };
	};
	if (result.stream) {
		// `offset` stays null until the first real block decides it: a thinking block takes over the early one (offset 0),
		// anything else closes it and is shifted by one index.
		let offset = null;
		for await (const event of result.stream) {
			if (!anthropic) {
				yield event;
				continue;
			}
			if (event.event === "message_start") continue;
			if (offset === null && event.event === "content_block_start" && event.data.content_block.type === "thinking") {
				offset = 0;
				continue;
			}
			if (offset === null) {
				yield* closeEarly();
				offset = 1;
			}
			yield offset > 0 && typeof event.data?.index === "number"
				? { ...event, data: { ...event.data, index: event.data.index + offset } }
				: event;
		}
		return;
	}
	if (anthropic) yield* closeEarly();
	yield* failure(api, result.body);
}

/**
 * The in-band error events for a client protocol: an `error` event (Anthropic) or an error chunk plus `[DONE]` (OpenAI).
 * @param {any} api - Captured translator parts.
 * @param {any} body - Client-shaped error body.
 * @returns {Generator<any>} Events.
 */
function* failure(api, body) {
	if (api.front === "anthropic") {
		yield { event: "error", data: body };
		return;
	}
	yield { data: body };
	yield { data: "[DONE]" };
}

/**
 * Hijack the reply and pump client events into it, ending with an in-band error event when the stream breaks.
 * @param {any} reply - Fastify reply.
 * @param {any} api - Captured translator parts.
 * @param {AbortController} controller - Aborts the upstream request.
 * @param {AsyncIterable<any>} events - Client events.
 * @param {number} [status] - HTTP status (default 200).
 * @param {Record<string,string>} [headers] - Response headers (default SSE headers).
 * @returns {Promise<any>} The reply.
 */
async function stream(reply, api, controller, events, status = 200, headers = SSE_HEADERS) {
	reply.hijack();
	const raw = reply.raw;
	raw.writeHead(status, headers);
	try {
		await api.write(raw, events, { front: api.front, interval: api.interval });
	} catch (error) {
		if (!controller.signal.aborted) {
			const known = error instanceof TranslatorError;
			// Details of unexpected failures stay in the server log, as for errors that happen before the stream is committed.
			if (!known) reply.log.error(error);
			const { body } = api.build(
				known ? error.status : 502,
				known ? error.message : "Internal server error",
				known ? { type: error.type, code: error.code } : {}
			);
			for (const event of failure(api, body)) raw.write(api.encode(event));
		}
	}
	raw.end();
	return reply;
}

/**
 * Constant-time string comparison.
 * @param {string} given - Value from the client.
 * @param {string} expected - Configured key.
 * @returns {boolean} True when equal.
 */
function same(given, expected) {
	const left = Buffer.from(given);
	const right = Buffer.from(expected);
	return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Pull the client's key from `x-api-key` or `Authorization: Bearer`.
 * @param {any} headers - Lowercase request headers.
 * @returns {string} Key, or an empty string.
 */
function keyOf(headers) {
	const bearer = /^Bearer\s+(.+)$/i.exec(headers.authorization ?? "");
	return headers["x-api-key"] || bearer?.[1] || "";
}

/**
 * Client headers that are safe to forward to a native Anthropic upstream: `anthropic-beta`, `anthropic-version` and
 * `x-claude-code-*`. Authentication headers are never forwarded.
 * @param {any} headers - Lowercase request headers.
 * @returns {Record<string, string>} Allow-listed headers.
 */
function forwardable(headers) {
	const out = {};
	for (const [name, value] of Object.entries(headers)) {
		if (name === "anthropic-beta" || name === "anthropic-version" || name.startsWith("x-claude-code-")) {
			out[name] = String(value);
		}
	}
	return out;
}

/**
 * Normalize what an `authorize` hook returned.
 * @param {any} value - Hook result: `true`, `{ ok: true, context? }`, `false`, `{ ok: false, status?, message? }`.
 * @returns {{ok: true, context: any} | {ok: false, status: number, message: string}} Verdict; anything unrecognised is a refusal.
 */
function verdictOf(value) {
	if (value === true) return { ok: true, context: undefined };
	if (value && typeof value === "object" && value.ok === true) return { ok: true, context: value.context };
	const refusal = value && typeof value === "object" && value.ok === false ? value : {};
	return {
		ok: false,
		status: Number.isInteger(refusal.status) && refusal.status >= 400 && refusal.status <= 599 ? refusal.status : 401,
		message: typeof refusal.message === "string" && refusal.message !== "" ? refusal.message : "unauthorized"
	};
}

/**
 * Register the routes for one front on a Fastify instance.
 * @param {any} fastify - Fastify instance (usually an encapsulated plugin scope).
 * @param {any} options - `{ apiKey, bodyLimit, authorize, onUsage }`.
 * @param {any} captured - Captured translator parts `{ front, interval, filter, send, route, count, list, build, encode, write }`; `front` applies to this instance only.
 * @returns {void}
 */
export function register(fastify, options, captured) {
	const { front, filter } = captured;
	// Every call carries this instance's front, so two servers on one translator can speak different protocols.
	const api = {
		...captured,
		build: (status, message, extra = {}) => captured.build(status, message, { ...extra, front }),
		send: (body, extra) => captured.send(body, { ...extra, front, filter }),
		route: (body) => captured.route(body, { front }),
		count: (body, extra) => captured.count(body, { ...extra, front }),
		list: (extra) => captured.list({ ...extra, front })
	};
	const keys = [options.apiKey ?? []].flat().filter(Boolean);
	const bodyLimit = options.bodyLimit ?? BODY_LIMIT;

	// What an allowing `authorize` hook returned as `context`, per request.
	const contexts = new WeakMap();

	const reject = (reply, reply_) => reply.code(reply_.status).headers(reply_.headers).send(reply_.body);

	fastify.setErrorHandler((error, request, reply) => {
		if (error instanceof TranslatorError) {
			return reject(reply, api.build(error.status, error.message, { type: error.type, code: error.code, param: error.param }));
		}
		const status = error.statusCode ?? 500;
		if (status < 500) return reject(reply, api.build(status, error.message));
		request.log.error(error);
		return reject(reply, api.build(status, "Internal server error"));
	});

	fastify.addHook("onRequest", async (request, reply) => {
		if (keys.length === 0 || request.routeOptions.config?.public) return;
		const given = keyOf(request.headers);
		if (given && keys.some((key) => same(given, key))) return;
		return reject(reply, api.build(401, "invalid x-api-key"));
	});

	if (typeof options.authorize === "function") {
		// Runs after body parsing so the hook can see the requested model.
		fastify.addHook("preHandler", async (request, reply) => {
			if (request.routeOptions.config?.public) return;
			let route = null;
			if (request.body && typeof request.body === "object" && request.body.model !== undefined) {
				try {
					route = api.route(request.body);
				} catch {
					// A bad body is refused by the normal handler with its own 400.
				}
			}
			let verdict;
			try {
				verdict = verdictOf(
					await options.authorize({
						method: request.method,
						url: request.url,
						headers: request.headers,
						body: request.body,
						front: api.front,
						route
					})
				);
			} catch (error) {
				request.log.error(error);
				verdict = { ok: false, status: 401, message: "unauthorized" };
			}
			if (!verdict.ok) return reject(reply, api.build(verdict.status, verdict.message));
			contexts.set(request, verdict.context);
		});
	}

	fastify.route({
		method: ["GET", "HEAD"],
		url: "/",
		config: { public: true },
		handler: async (_request, reply) => reply.send({ ok: true })
	});
	fastify.route({
		method: ["GET", "HEAD"],
		url: "/api/hello",
		config: { public: true },
		handler: async (_request, reply) => reply.send({ ok: true })
	});
	fastify.get("/v1/models", async (_request, reply) => {
		const controller = new AbortController();
		reply.raw.on("close", () => controller.abort());
		return api.list({ signal: controller.signal });
	});

	const url = api.front === "anthropic" ? "/v1/messages" : "/v1/chat/completions";
	fastify.post(url, { bodyLimit }, async (request, reply) => {
		// The client may have left before this handler ran (for example during a slow hook); then no upstream call is made.
		if (reply.raw.destroyed) return reply;
		const controller = new AbortController();
		reply.raw.on("close", () => {
			if (!reply.raw.writableFinished) controller.abort();
		});
		const onUsage = typeof options.onUsage === "function" ? (report) => options.onUsage(report, contexts.get(request)) : undefined;
		const sending = api.send(request.body, { signal: controller.signal, clientHeaders: forwardable(request.headers), onUsage });
		sending.catch(() => {});
		const gone = new Promise((resolve) => controller.signal.addEventListener("abort", () => resolve(GONE), { once: true }));
		const result = await settle(Promise.race([sending, gone]), request.body?.stream === true ? api.interval : 0);
		if (result === GONE) {
			// A stream that arrives after the client left is never read; return it so its usage report is delivered.
			sending.then(
				(late) => late.stream?.return?.(),
				() => {}
			);
			return reply;
		}
		if (result === STALLED) return stream(reply, api, controller, late(sending, api, request.body?.model));
		if (!result.stream) return reject(reply, result);
		return stream(reply, api, controller, result.stream, result.status, result.headers);
	});

	if (api.front === "anthropic") {
		fastify.post("/v1/messages/count_tokens", { bodyLimit }, async (request, reply) => {
			const controller = new AbortController();
			reply.raw.on("close", () => controller.abort());
			return api.count(request.body, { signal: controller.signal });
		});
	}
}

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/routes.mjs
 *	@Date: 2026-10-25T12:56:43-07:00 (1792958203)
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
 * @fileoverview Fastify routes for the Anthropic and OpenAI fronts, shared by `server.start` and `server.plugin`.
 * @module @cldmv/llm-translator/lib/routes
 */
import { timingSafeEqual } from "node:crypto";
import { TranslatorError } from "./errors.mjs";

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
 * @returns {AsyncGenerator<any>} Client events.
 */
async function* late(sending, api) {
	const result = await sending;
	if (result.stream) {
		yield* result.stream;
		return;
	}
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
			const { body } = api.build(known ? error.status : 502, error.message, known ? { type: error.type, code: error.code } : {});
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
 * Register the routes for one front on a Fastify instance.
 * @param {any} fastify - Fastify instance (usually an encapsulated plugin scope).
 * @param {any} options - `{ apiKey, bodyLimit }`.
 * @param {any} captured - Captured translator parts `{ front, interval, filter, send, count, list, build, encode, write }`; `front` applies to this instance only.
 * @returns {void}
 */
export function register(fastify, options, captured) {
	const { front, filter } = captured;
	// Every call carries this instance's front, so two servers on one translator can speak different protocols.
	const api = {
		...captured,
		build: (status, message, extra = {}) => captured.build(status, message, { ...extra, front }),
		send: (body, extra) => captured.send(body, { ...extra, front, filter }),
		count: (body, extra) => captured.count(body, { ...extra, front }),
		list: (extra) => captured.list({ ...extra, front })
	};
	const keys = [options.apiKey ?? []].flat().filter(Boolean);
	const bodyLimit = options.bodyLimit ?? BODY_LIMIT;

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
		const sending = api.send(request.body, { signal: controller.signal, clientHeaders: forwardable(request.headers) });
		sending.catch(() => {});
		const gone = new Promise((resolve) => controller.signal.addEventListener("abort", () => resolve(GONE), { once: true }));
		const result = await settle(Promise.race([sending, gone]), request.body?.stream === true ? api.interval : 0);
		if (result === GONE) return reply;
		if (result === STALLED) return stream(reply, api, controller, late(sending, api));
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

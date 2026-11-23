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
import { CONTENT_TYPE, recorder } from "./metrics.mjs";
import { cors as corsPolicy, rateLimit as limiter } from "./guard.mjs";
import { beta } from "./files.mjs";
import { parse as multipart } from "./multipart.mjs";

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
 * @param {(source: AsyncIterable<any>) => AsyncIterable<any>} [convert] - Turns the upstream's stream into the client's events (the Responses front).
 * @returns {AsyncGenerator<any>} Client events.
 */
export async function* late(sending, api, model, convert) {
	// True once the upstream's stream is being read (the loop below then closes it).
	let adopted = false;
	try {
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
			adopted = true;
			// `offset` stays null until the first real block decides it: a thinking block takes over the early one (offset 0),
			// anything else closes it and is shifted by one index.
			let offset = null;
			for await (const event of convert ? convert(result.stream) : result.stream) {
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
	} finally {
		// Closed before the upstream answered (the client left while the early events were being written): a stream that arrives
		// later is never read, so close it for its usage report to be delivered.
		if (!adopted)
			sending.then(
				(result) => result.stream?.return?.(),
				() => {}
			);
	}
}

/**
 * The in-band error events for a client protocol: an `error` event (Anthropic) or an error chunk plus `[DONE]` (OpenAI).
 * @param {any} api - Captured translator parts.
 * @param {any} body - Client-shaped error body.
 * @returns {Generator<any>} Events.
 */
function* failure(api, body) {
	if (api.wire === "responses") {
		// The Responses API has no `[DONE]` sentinel: a stream that fails ends with one `error` event.
		yield { event: "error", data: { type: "error", code: body.error.code, message: body.error.message, param: body.error.param } };
		return;
	}
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
 * @param {number} interval - Ping interval in ms for the upstream this request goes to.
 * @param {number} [status] - HTTP status (default 200).
 * @param {Record<string,string>} [headers] - Response headers (default SSE headers).
 * @returns {Promise<any>} The reply.
 */
async function stream(reply, api, controller, events, interval, status = 200, headers = SSE_HEADERS) {
	reply.hijack();
	const raw = reply.raw;
	raw.writeHead(status, headers);
	try {
		await api.write(raw, events, { front: api.front, interval });
	} catch (error) {
		if (!controller.signal.aborted) {
			const known = error instanceof TranslatorError;
			// Details of unexpected failures stay in the server log, as for errors that happen before the stream is committed.
			if (!known) {
				reply.log.error(error);
				api.emit({ type: "error", kind: "route", level: "error", message: String(error?.message ?? error), log: false });
			}
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
	/** @type {Record<string, string>} */
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
 * @param {any} value - Hook result: `true`, `{ ok: true, context?, cacheSalt? }`, `false`, `{ ok: false, status?, message? }`.
 * @returns {{ok: true, context: any, cacheSalt?: any} | {ok: false, status: number, message: string}} Verdict; anything unrecognised is a refusal.
 */
function verdictOf(value) {
	if (value === true) return { ok: true, context: undefined };
	if (value && typeof value === "object" && value.ok === true) return { ok: true, context: value.context, cacheSalt: value.cacheSalt };
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
 * @param {any} options - `{ apiKey, bodyLimit, authorize, onUsage, metrics, cors, rateLimit }`.
 * @param {any} captured - Captured translator parts `{ front, interval(body), filter, send, route, count, list, get, build, encode, write }`; `front` applies to this instance only.
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
		embed: (body, extra) => captured.embed(body, extra),
		list: (extra) => captured.list({ ...extra, front }),
		get: (id, extra) => captured.get(id, { ...extra, front }),
		files: Object.fromEntries(
			["create", "list", "get", "content", "remove"].map((name) => [
				name,
				(input, extra) => captured.files[name](input, { ...extra, front })
			])
		)
	};
	const keys = [options.apiKey ?? []].flat().filter(Boolean);
	const bodyLimit = options.bodyLimit ?? BODY_LIMIT;

	// What an allowing `authorize` hook returned as `context`, per request.
	const contexts = new WeakMap();
	// The `cacheSalt` an allowing hook returned (vLLM prefix-cache isolation per key), per request.
	const salts = new WeakMap();

	// `GET /metrics` and the request recorder exist only when the server was started with `metrics`; otherwise `/metrics` is an unknown route.
	const metrics = options.metrics === true ? recorder({ front, endpoints: captured.endpoints }) : null;

	const reject = (reply, reply_) => reply.code(reply_.status).headers(reply_.headers).send(reply_.body);

	fastify.setErrorHandler((error, request, reply) => {
		if (error instanceof TranslatorError) {
			return reject(reply, api.build(error.status, error.message, { type: error.type, code: error.code, param: error.param }));
		}
		const status = error.statusCode ?? 500;
		if (status < 500) return reject(reply, api.build(status, error.message));
		request.log.error(error);
		api.emit({ type: "error", kind: "route", level: "error", message: String(error.message), status, log: false });
		return reject(reply, api.build(status, "Internal server error"));
	});

	// Optional hardening, in this order: CORS headers first, so every reply (a 401 or 429 included) carries what a browser needs to read it;
	// then the metrics hook, so a request the rate limit refuses is counted (as a 429); then the rate limit, ahead of the key check so
	// failed key attempts count against the caller's address; the key check follows below.
	const policy = corsPolicy(options.cors);
	const limit = limiter(options.rateLimit);
	if (policy) {
		fastify.addHook("onRequest", async (request, reply) => {
			// Set on the raw response: it also reaches the hijacked SSE replies, which write their own head.
			for (const [name, value] of Object.entries(policy.headers(request.headers.origin))) reply.raw.setHeader(name, value);
		});
	}
	if (metrics) fastify.addHook("onRequest", metrics.hook);
	if (limit) {
		fastify.addHook("onRequest", async (request, reply) => {
			if (request.routeOptions.config?.public || request.routeOptions.config?.metrics) return;
			// Only a key the server knows names a bucket; any other value (or no key, or auth turned off) is counted by remote address, so
			// a client cannot get fresh buckets by making up keys.
			const given = keyOf(request.headers);
			const wait = limit.take(given && keys.some((key) => same(given, key)) ? `key:${given}` : `ip:${request.ip}`);
			if (wait === 0) return;
			const refused = api.build(429, "rate limit exceeded", { type: "rate_limit_error" });
			return reply
				.code(429)
				.headers({ ...refused.headers, "retry-after": String(wait) })
				.send(refused.body);
		});
	}
	if (policy) {
		// Preflight is answered here, ahead of the key check and the rate limit: browsers send it without credentials. It is not a
		// request to the API, so the metrics counters skip it.
		fastify.route({
			method: "OPTIONS",
			url: "/*",
			config: { public: true, metrics: true },
			handler: (request, reply) => {
				const headers = policy.preflight(request.headers.origin, request.headers["access-control-request-headers"]);
				for (const [name, value] of Object.entries(headers)) reply.raw.setHeader(name, value);
				return reply.code(204).send();
			}
		});
	}

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
			if (request.body && typeof request.body === "object" && !Array.isArray(request.body)) {
				try {
					route = api.route(request.body);
				} catch {
					// An invalid body is refused by the normal handler with its own 400.
				}
			}
			/** @type {{ ok: boolean, status?: number, message?: string, context?: any, cacheSalt?: any }} */
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
				api.emit({ type: "error", kind: "route", level: "error", message: String(error?.message ?? error), log: false });
				verdict = { ok: false, status: 401, message: "unauthorized" };
			}
			if (!verdict.ok) return reject(reply, api.build(verdict.status, verdict.message));
			contexts.set(request, verdict.context);
			if (typeof verdict.cacheSalt === "string" && verdict.cacheSalt !== "") salts.set(request, verdict.cacheSalt);
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
	// Not `public`: the key check and the `authorize` hook apply like for every other route.
	// `config.metrics` keeps the scrape out of the request counters whatever prefix the plugin is mounted under.
	if (metrics) {
		fastify.get("/metrics", { config: { metrics: true } }, async (_request, reply) =>
			reply.header("content-type", CONTENT_TYPE).send(metrics.render())
		);
	}
	fastify.get("/v1/models", async (_request, reply) => {
		const controller = new AbortController();
		reply.raw.on("close", () => controller.abort());
		return api.list({ signal: controller.signal });
	});
	// A wildcard, because model ids can contain slashes (`org/model`); the router has already decoded it.
	fastify.get("/v1/models/*", async (request, reply) => {
		const controller = new AbortController();
		reply.raw.on("close", () => controller.abort());
		return api.get(request.params["*"], { signal: controller.signal });
	});

	// The Files API. An upload is a `multipart/form-data` body, read whole (the limit is the file size limit plus room for the form around it) and parsed
	// by `lib/multipart`, so the handlers see `{ fields, files }`.
	fastify.addContentTypeParser(
		"multipart/form-data",
		{ parseAs: "buffer", bodyLimit: captured.files.limit() + 1024 * 1024 },
		(request, body, done) => {
			try {
				done(null, multipart(body, request.headers["content-type"]));
			} catch (error) {
				done(error);
			}
		}
	);
	fastify.post("/v1/files", async (request, reply) => {
		const part = request.body?.files?.find((entry) => entry.name === "file");
		if (!part) {
			throw new TranslatorError("file: Field required (send multipart/form-data with a file part)", {
				code: "invalid_request",
				status: 400,
				type: "invalid_request_error",
				param: "file"
			});
		}
		const upload = { filename: part.filename, data: part.data, type: part.type, fields: request.body.fields };
		return reply.send(await api.files.create(upload, { beta: beta(request.headers["anthropic-beta"]) }));
	});
	fastify.get("/v1/files", async (request, reply) => {
		// Anthropic's `ids[]` arrives as `ids[]` (or `ids`), one value or many.
		const ids = request.query["ids[]"] ?? request.query.ids;
		const query = ids === undefined ? request.query : { ...request.query, ids: [ids].flat() };
		return reply.send(await api.files.list(query, { beta: beta(request.headers["anthropic-beta"]) }));
	});
	fastify.get("/v1/files/:id", async (request, reply) =>
		reply.send(await api.files.get(request.params.id, { beta: beta(request.headers["anthropic-beta"]) }))
	);
	fastify.get("/v1/files/:id/content", async (request, reply) => {
		const file = await api.files.content(request.params.id);
		return reply.header("content-type", file.type).send(file.data);
	});
	fastify.delete("/v1/files/:id", async (request, reply) => reply.send(await api.files.remove(request.params.id)));

	// Streams of the Responses front fail with its own in-band error event (see `failure`).
	const asResponses = { ...api, wire: "responses" };
	/**
	 * Answer a chat or messages request: send it upstream and write the reply, committing to a stream early when the upstream is slow.
	 * @param {any} request - Fastify request.
	 * @param {any} reply - Fastify reply.
	 * @param {any} body - Body in the front's protocol (for the Responses front: the converted Chat Completions body).
	 * @param {{ state: any, settings: any } | null} via - Set on the Responses front: the request converter's state and the upstream's settings, for converting the reply.
	 * @returns {Promise<any>} The reply.
	 */
	const converse = async (request, reply, body, via) => {
		// The client may have left before this handler ran (for example during a slow hook); then no upstream call is made.
		if (reply.raw.destroyed) return reply;
		const controller = new AbortController();
		reply.raw.on("close", () => {
			if (!reply.raw.writableFinished) controller.abort();
		});
		const onUsage = typeof options.onUsage === "function" ? (report) => options.onUsage(report, contexts.get(request)) : undefined;
		// The same interval times the early-commit wait and the keep-alives, and it comes from the upstream the request is routed to.
		// Read it before sending: send advances a round robin, and reading after would see the next member.
		const interval = api.interval(body);
		const sending = api.send(body, {
			signal: controller.signal,
			wire: via ? "responses" : undefined,
			clientHeaders: forwardable(request.headers),
			cacheSalt: salts.get(request),
			onUsage,
			log: request.log
		});
		sending.catch(() => {});
		metrics?.attach(request, sending);
		const gone = new Promise((resolve) => controller.signal.addEventListener("abort", () => resolve(GONE), { once: true }));
		const result = await settle(Promise.race([sending, gone]), body?.stream === true ? interval : 0);
		if (result === GONE) {
			// A stream that arrives after the client left is never read; return it so its usage report is delivered.
			sending.then(
				(late) => late.stream?.return?.(),
				() => {}
			);
			return reply;
		}
		const convert = via ? (source) => api.responses.stream(source, via.state, via.settings) : undefined;
		if (result === STALLED)
			return stream(reply, via ? asResponses : api, controller, late(sending, via ? asResponses : api, body?.model, convert), interval);
		if (!result.stream) {
			if (!via || result.status >= 400) return reject(reply, result);
			return reject(reply, { ...result, body: await api.responses.response(result.body, via.state, via.settings) });
		}
		return stream(
			reply,
			via ? asResponses : api,
			controller,
			convert ? convert(result.stream) : result.stream,
			interval,
			result.status,
			result.headers
		);
	};

	const url = api.front === "anthropic" ? "/v1/messages" : "/v1/chat/completions";
	fastify.post(url, { bodyLimit }, (request, reply) => converse(request, reply, request.body, null));

	if (api.front === "openai") {
		// The Responses API is served through the Chat Completions path: the request is converted to a chat body, so routing, pools, failover,
		// conversion to Anthropic or Ollama, usage and capture all apply, and the reply is converted back.
		/**
		 * Convert a Responses body to its Chat Completions form, reporting what was dropped.
		 * @param {any} request - Fastify request.
		 * @returns {Promise<{ chat: any, via: { state: any, settings: any } }>} Chat body and the reply conversion context.
		 */
		const converted = async (request) => {
			const settings = api.settings(request.body);
			const { body, state } = await api.responses.request(request.body, settings);
			if (state.dropped.length > 0) {
				api.emit({
					type: "dropped",
					level: "debug",
					message: `Responses request: dropped ${state.dropped.join(", ")}`,
					fields: [...state.dropped],
					log: request.log
				});
			}
			return { chat: body, via: { state, settings } };
		};
		fastify.post("/v1/responses", { bodyLimit }, async (request, reply) => {
			const { chat, via } = await converted(request);
			return converse(request, reply, chat, via);
		});
		fastify.post("/v1/responses/input_tokens", { bodyLimit }, async (request, reply) => {
			const controller = new AbortController();
			reply.raw.on("close", () => controller.abort());
			const { chat } = await converted(request);
			const { input_tokens } = await api.count(chat, { signal: controller.signal });
			return reply.send({ object: "response.input_tokens", input_tokens });
		});
		// A plain forward: no streaming, no conversion, so none of the chat route's early-commit machinery applies.
		fastify.post("/v1/embeddings", { bodyLimit }, async (request, reply) => {
			const controller = new AbortController();
			reply.raw.on("close", () => {
				if (!reply.raw.writableFinished) controller.abort();
			});
			// An abort answers 499 into a reply nobody reads.
			const onUsage = typeof options.onUsage === "function" ? (report) => options.onUsage(report, contexts.get(request)) : undefined;
			const sending = api.embed(request.body, { signal: controller.signal, onUsage, log: request.log });
			metrics?.attach(request, sending);
			return reject(reply, await sending);
		});
	}

	if (api.front === "anthropic") {
		fastify.post("/v1/messages/count_tokens", { bodyLimit }, async (request, reply) => {
			const controller = new AbortController();
			reply.raw.on("close", () => controller.abort());
			return api.count(request.body, { signal: controller.signal });
		});
	}
}

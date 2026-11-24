/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/server/plugin.mjs
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
 * @fileoverview Server api: Fastify plugin exposing the translator's HTTP front.
 * @module @cldmv/llm-translator/server
 */
import { context, self } from "../../lib/runtime.mjs";
import { TranslatorError } from "../../lib/errors.mjs";
import { register } from "../../lib/routes.mjs";
import { capture } from "../../lib/capture.mjs";
import { resolve as routeTo } from "../../lib/route.mjs";
import { resolve } from "../../lib/settings.mjs";
import { emit } from "../../lib/events.mjs";

/**
 * Fastify plugin. Anthropic front: `POST /v1/messages`, `POST /v1/messages/count_tokens`, `GET /v1/models`, `GET /v1/models/{id}`,
 * the Files API (`POST|GET /v1/files`, `GET|DELETE /v1/files/{id}`, `GET /v1/files/{id}/content`), Message Batches (`POST|GET /v1/messages/batches`, `GET|DELETE /v1/messages/batches/{id}`, `POST /v1/messages/batches/{id}/cancel`, `GET /v1/messages/batches/{id}/results`), `GET|HEAD /` and `/api/hello`. OpenAI front: `POST /v1/chat/completions`, `POST /v1/responses`, `POST /v1/responses/input_tokens`, `POST /v1/embeddings`, the Files API, the Batch API (`POST|GET /v1/batches`, `GET /v1/batches/{id}`, `POST /v1/batches/{id}/cancel`), `GET /v1/models`, `GET /v1/models/{id}`, `GET|HEAD /`. Responses stream as
 * `text/event-stream` with keep-alive pings; a client disconnect aborts the upstream request. Register it with
 * `app.register(api.server.plugin, { apiKey })`. `authorize(request)` (sync or async) runs after `apiKey` and the body parse and decides
 * with `true` / `{ ok: true, context }` or `false` / `{ ok: false, status, message }`; `onUsage(report, context)` receives each request's usage report. When the Fastify `logger` is enabled, events also go to it as structured lines (`{ event }` plus the message), through the request's logger for events of a request.
 * @param {any} fastify - Fastify instance.
 * @param {any} [options] - `{ front, apiKey, bodyLimit, authorize, onUsage, metrics, cors, rateLimit }`. `cors` (a list of origins, `"*"` for any) and `rateLimit` (`{ requests, windowMs }`) are described in docs/server.md and are off unless set. `metrics: true` adds `GET /metrics` (Prometheus text format, behind the same authentication as every other route; off by default, then an unknown route). `authorize(request)` and `onUsage(report, context)` are described above. `front` sets the protocol this plugin instance serves (default: the translator's front, other plugin instances and `api.send` are unaffected); `apiKey` (string or array) is required from clients. Forwarded OpenAI bodies are restricted to known fields unless the `passthroughFilter` setting is `false`.
 * @returns {Promise<void>} Resolves once the routes are registered.
 */
export async function plugin(fastify, options = {}) {
	const { config } = context;
	if (options.front !== undefined) {
		if (options.front !== "anthropic" && options.front !== "openai") {
			throw new TranslatorError(`front must be "anthropic" or "openai" (got ${JSON.stringify(options.front)})`, {
				code: "invalid_config",
				status: 500
			});
		}
	}
	for (const name of ["authorize", "onUsage"]) {
		if (options[name] !== undefined && typeof options[name] !== "function") {
			throw new TranslatorError(`${name} must be a function`, { code: "invalid_config", status: 500 });
		}
	}
	if (options.metrics !== undefined && typeof options.metrics !== "boolean") {
		throw new TranslatorError("metrics must be true or false", { code: "invalid_config", status: 500 });
	}
	const { send, route, token, model, error, sse, embeddings, files, batches } = self;
	const front = options.front ?? config.front;
	// Events also go to this app's logger (as structured lines) until it closes; a request's own logger takes over for its events.
	const { state } = context;
	const { events } = state;
	events.logger = fastify.log;
	fastify.addHook("onClose", async () => {
		if (events.logger === fastify.log) events.logger = null;
	});
	const captured = capture(self, context, front);
	register(fastify, options, {
		front,
		filter: config.settings.passthroughFilter !== false,
		// The ping interval of the upstream a request is routed to, with the precedence every setting has (upstream over global); the global
		// value when the body cannot be routed (the request then fails on its own).
		interval: (body) => {
			try {
				return captured.settings(routeTo(captured, body).endpoint).pingInterval;
			} catch {
				return resolve(config.settings).pingInterval;
			}
		},
		// The settings of the upstream a request is routed to, for the Responses converters (the global ones when the body cannot be routed).
		settings: (body) => {
			try {
				const routed = routeTo(captured, body, { wire: "responses" });
				return captured.settings(routed.endpoint, routed.protocol);
			} catch {
				return resolve(config.settings);
			}
		},
		responses: {
			request: self.convert.openai.responses.to.openai.chat.request,
			response: self.convert.openai.chat.to.openai.responses.response,
			stream: self.convert.openai.chat.to.openai.responses.stream
		},
		send,
		embed: embeddings.send,
		route,
		count: token.count,
		list: model.list,
		get: model.get,
		// The Files API leaves, and the file size limit the upload body limit follows (1 MiB when the Files API is off).
		files: {
			create: files.create,
			list: files.list,
			get: files.get,
			content: files.content,
			remove: files.remove,
			limit: () => resolve(config.settings).files?.maxFileSize ?? 1024 * 1024
		},
		// The Batch APIs leaves.
		batches: {
			create: batches.create,
			list: batches.list,
			get: batches.get,
			cancel: batches.cancel,
			remove: batches.remove,
			results: batches.results
		},
		// `context` is only valid inside a call into the api, and routes run later, so the parts are captured now.
		emit: (spec) => emit({ config, state }, spec),
		endpoints: () => state.endpoints,
		build: error.build,
		encode: sse.encode,
		write: sse.write
	});
}

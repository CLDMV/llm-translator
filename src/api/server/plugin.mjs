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
import { resolve } from "../../lib/settings.mjs";

/**
 * Fastify plugin. Anthropic front: `POST /v1/messages`, `POST /v1/messages/count_tokens`, `GET /v1/models`, `GET|HEAD /`
 * and `/api/hello`. OpenAI front: `POST /v1/chat/completions`, `GET /v1/models`, `GET|HEAD /`. Responses stream as
 * `text/event-stream` with keep-alive pings; a client disconnect aborts the upstream request. Register it with
 * `app.register(api.server.plugin, { apiKey })`. `authorize(request)` (sync or async) runs after `apiKey` and the body parse and decides
 * with `true` / `{ ok: true, context }` or `false` / `{ ok: false, status, message }`; `onUsage(report, context)` receives each request's usage report.
 * @param {any} fastify - Fastify instance.
 * @param {any} [options] - `{ front, apiKey, bodyLimit }`. `front` sets the protocol this plugin instance serves (default: the translator's front, other plugin instances and `api.send` are unaffected); `apiKey` (string or array) is required from clients. Forwarded OpenAI bodies are restricted to known fields unless the `passthroughFilter` setting is `false`.
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
	const { send, route, token, model, error, sse } = self;
	register(fastify, options, {
		front: options.front ?? config.front,
		filter: config.settings.passthroughFilter !== false,
		interval: resolve(config.settings).pingInterval,
		send,
		route,
		count: token.count,
		list: model.list,
		build: error.build,
		encode: sse.encode,
		write: sse.write
	});
}

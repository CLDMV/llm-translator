/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/server/start.mjs
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
 * @fileoverview Server api: start a standalone Fastify server.
 * @module @cldmv/llm-translator/server
 */
import { context, self } from "../../lib/runtime.mjs";
import { TranslatorError } from "../../lib/errors.mjs";
import { isLoopback } from "../../lib/http.mjs";

/**
 * Start an HTTP server in front of the translator. Fastify is an optional peer dependency and is imported here.
 * @param {any} [options] - `{ host = "127.0.0.1", port = 8787, front, apiKey, bodyLimit, logger, allowUnauthenticated, authorize, onUsage }`. `authorize(request)` and `onUsage(report, context)` are described at `server.plugin`. Listening on a non-loopback address without an `apiKey` or an `authorize` hook is refused unless `allowUnauthenticated` is true.
 * @returns {Promise<{url: string, host: string, port: number, app: any, close: () => Promise<void>}>} Running server handle.
 */
export async function start(options = {}) {
	const { state } = context;
	const { plugin } = self.server;
	const { build } = self.error;
	let fastify;
	try {
		({ default: fastify } = await import("fastify"));
	} catch (cause) {
		throw new TranslatorError('server.start needs the optional peer dependency "fastify" (npm install fastify)', {
			code: "fastify_missing",
			status: 500,
			details: { cause }
		});
	}
	const host = options.host ?? "127.0.0.1";
	if (
		!isLoopback(host) &&
		[options.apiKey ?? []].flat().filter(Boolean).length === 0 &&
		typeof options.authorize !== "function" &&
		options.allowUnauthenticated !== true
	) {
		throw new TranslatorError(
			`Refusing to listen on ${host} without an apiKey or an authorize hook: anyone who can reach the port could use the upstream. Set \`apiKey\` (CLI: --api-key) or \`authorize\`, bind to 127.0.0.1, or opt in with \`allowUnauthenticated: true\` (CLI: --allow-unauthenticated).`,
			{ code: "unauthenticated_bind", status: 500 }
		);
	}
	// forceCloseConnections: stopping the server must not wait for clients that keep a connection open (an SSE stream, or a
	// keep-alive socket left behind by a client that aborted), otherwise shutdown can hang indefinitely.
	const app = fastify({ logger: options.logger ?? false, forceCloseConnections: true });
	app.setNotFoundHandler((request, reply) => {
		const { status, headers, body } = build(404, `Not found: ${request.method} ${request.url}`);
		return reply.code(status).headers(headers).send(body);
	});
	await app.register(plugin, {
		front: options.front,
		apiKey: options.apiKey,
		bodyLimit: options.bodyLimit,
		authorize: options.authorize,
		onUsage: options.onUsage
	});
	await app.listen({ host, port: options.port ?? 8787 });
	const port = app.server.address().port;
	const handle = {
		url: `http://${host.includes(":") ? `[${host}]` : host}:${port}`,
		host,
		port,
		app,
		close: async () => {
			state.servers.delete(handle);
			await app.close();
		}
	};
	state.servers.add(handle);
	return handle;
}

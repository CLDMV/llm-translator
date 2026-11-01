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
 * Start an HTTP server in front of the translator. Fastify is an optional peer dependency and is imported here.
 * @param {any} [options] - `{ host = "127.0.0.1", port = 8787, front, apiKey, bodyLimit, logger, allowUnauthenticated, authorize, onUsage }`. `authorize(request)` and `onUsage(report, context)` are described at `server.plugin`. Listening on a non-loopback address without an `apiKey` or an `authorize` hook is refused unless `allowUnauthenticated` is true.
 * @returns {Promise<{url: string, host: string, port: number, app: any, close: () => Promise<void>}>} Running server handle.
 */
export declare function start(options?: any): Promise<{
    url: string;
    host: string;
    port: number;
    app: any;
    close: () => Promise<void>;
}>;

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/server/start.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:01-07:00 (1792958341)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * Start an HTTP server in front of the translator. Fastify is an optional peer dependency and is imported here.
 * @param {any} [options] - `{ host = "127.0.0.1", port = 8787, front, apiKey, bodyLimit, logger, allowUnauthenticated }`. Listening on a non-loopback address without an `apiKey` is refused unless `allowUnauthenticated` is true.
 * @returns {Promise<{url: string, host: string, port: number, app: any, close: () => Promise<void>}>} Running server handle.
 */
export declare function start(options?: any): Promise<{
    url: string;
    host: string;
    port: number;
    app: any;
    close: () => Promise<void>;
}>;

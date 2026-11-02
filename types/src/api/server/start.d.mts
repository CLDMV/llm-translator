/**
 * Start an HTTP server in front of the translator. Fastify is an optional peer dependency and is imported here.
 * @param {any} [options] - `{ host = "127.0.0.1", port = 8787, front, apiKey, bodyLimit, logger, allowUnauthenticated, authorize, onUsage }`. `authorize(request)` and `onUsage(report, context)` are described at `server.plugin`. Listening on a non-loopback address without an `apiKey` or an `authorize` hook is refused unless `allowUnauthenticated` is true.
 * @returns {Promise<{url: string, host: string, port: number, app: any, close: () => Promise<void>}>} Running server handle.
 */
export function start(options?: any): Promise<{
    url: string;
    host: string;
    port: number;
    app: any;
    close: () => Promise<void>;
}>;

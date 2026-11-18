/**
 * Start an HTTP server in front of the translator. Fastify is an optional peer dependency and is imported here.
 * @param {any} [options] - `{ host = "127.0.0.1", port = 8787, front, apiKey, bodyLimit, logger, allowUnauthenticated, authorize, onUsage, metrics, tls, cors, rateLimit }`. `authorize(request)` and `onUsage(report, context)` are described at `server.plugin`. `tls` is `{ key, cert, ca, passphrase }` (file paths; `key` and `cert` together) and serves HTTPS; `cors` is a list of allowed origins (`"*"` for any); `rateLimit` is `{ requests, windowMs = 60000 }` per API key (remote address without one). Each is off unless set; see docs/server.md. Listening on a non-loopback address without an `apiKey` or an `authorize` hook is refused unless `allowUnauthenticated` is true.
 * @returns {Promise<{url: string, host: string, port: number, app: any, close: () => Promise<void>}>} Running server handle.
 */
export function start(options?: any): Promise<{
    url: string;
    host: string;
    port: number;
    app: any;
    close: () => Promise<void>;
}>;

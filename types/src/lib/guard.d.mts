/**
 * Read the TLS files named by `options.tls` into the `https` options of Fastify / `node:https`.
 * @param {any} tls - `{ key, cert, ca, passphrase }`: file paths (`ca` may be a list), `passphrase` a string; or undefined for plain HTTP.
 * @returns {Promise<object | null>} `https` options, or null when TLS is not configured.
 */
export function tlsOptions(tls: any): Promise<object | null>;
/**
 * Build the CORS policy.
 * @param {any} option - A list of origins, or `{ origins }`. `"*"` allows every origin. Undefined, null or an empty list turns CORS off.
 * @returns {{ headers: (origin: string | undefined) => Record<string,string>, preflight: (origin: string | undefined, requested: string | undefined) => Record<string,string> } | null} Policy, or null when off.
 */
export function cors(option: any): {
    headers: (origin: string | undefined) => Record<string, string>;
    preflight: (origin: string | undefined, requested: string | undefined) => Record<string, string>;
} | null;
/**
 * Build a fixed-window rate limiter.
 * @param {any} option - `{ requests, windowMs = 60000 }` (requests per window per client); undefined, null or false turns it off.
 * @param {() => number} [now] - Clock in ms (tests).
 * @returns {{ take: (key: string) => number, size: () => number } | null} Limiter, or null when off. `take(key)` returns 0 when the request may go on, else the seconds to wait.
 */
export function rateLimit(option: any, now?: () => number): {
    take: (key: string) => number;
    size: () => number;
} | null;

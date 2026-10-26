/**
 * @fileoverview Default upstream transport: a small `fetch`-compatible function on top of `node:http` / `node:https`.
 *
 * It exists because the global `fetch` (undici) enforces a 300 second headers timeout and a 300 second body timeout,
 * which kill requests to slow local servers: vLLM sends its response headers together with the first token, and a
 * long prompt on a CPU or a busy GPU can take far longer than five minutes to produce one. This transport applies no
 * timeouts at all (the caller aborts through `signal`), never follows redirects (so credentials in headers are never
 * replayed to another host; with `redirect: "error"` a redirect rejects instead of being returned) and does not
 * decompress (it asks for `identity`). Every request uses a fresh connection (no keep-alive pool), so a server that closed an
 * idle connection can never make the next request fail with a stale-socket reset.
 */
/**
 * `fetch`-style request.
 * @param {string|URL} url - Absolute http(s) URL.
 * @param {{ method?: string, headers?: Record<string, string>, body?: string|Uint8Array, signal?: AbortSignal, redirect?: string }} [init] - Request options.
 * @param {{ http: any, https: any }} [modules] - Protocol modules (overridable for tests).
 * @returns {Promise<Response>} Response whose `body` is a web `ReadableStream`.
 */
export declare function transport(url: string | URL, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array;
    signal?: AbortSignal;
    redirect?: string;
}, modules?: {
    http: any;
    https: any;
}): Promise<Response>;

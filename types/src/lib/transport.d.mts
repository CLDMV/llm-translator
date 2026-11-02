/**
 * `fetch`-style request.
 * @param {string|URL} url - Absolute http(s) URL.
 * @param {{ method?: string, headers?: Record<string, string>, body?: string|Uint8Array, signal?: AbortSignal, redirect?: string, connectTimeout?: number }} [init] - Request options.
 * @param {{ http: any, https: any }} [modules] - Protocol modules (overridable for tests).
 * @returns {Promise<Response>} Response whose `body` is a web `ReadableStream`.
 */
export function transport(url: string | URL, init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array;
    signal?: AbortSignal;
    redirect?: string;
    connectTimeout?: number;
}, modules?: {
    http: any;
    https: any;
}): Promise<Response>;

/**
 * The class of range an IP address is in.
 * @param {string} address - IPv4 or IPv6 address (a zone id is ignored).
 * @returns {string | null} `loopback`, `private`, `link-local`, `cgnat`, `unique-local`, `multicast`, `unspecified`, `reserved` or `mapped`; null for a public address; `invalid` when it is not an address.
 */
export function classify(address: string): string | null;
/**
 * Whether a host name matches an allow-list pattern: an exact host name, `*.example.com` (any subdomain, not `example.com` itself) or `*` (any host).
 * @param {string} host - Lower-case host name without a trailing dot.
 * @param {string[]} patterns - Allow-list.
 * @returns {boolean} True when one pattern matches.
 */
export function allowed(host: string, patterns: string[]): boolean;
/**
 * Resolve a host name to every address it has, the way the connection will.
 * @param {string} host - Host name.
 * @returns {Promise<{address: string, family: number}[]>} Addresses.
 */
export function lookup(host: string): Promise<{
    address: string;
    family: number;
}[]>;
/**
 * Fetch a document.
 * @param {string} input - The URL.
 * @param {{allow: string[], maxBytes: number, timeout: number, maxRedirects: number, allowPrivate?: boolean, signal?: AbortSignal}} options - Limits and rules (see the `documentUrls` setting).
 * @param {{lookup?: (host: string) => Promise<{address: string, family: number}[]>, modules?: {http: any, https: any}}} [deps] - Host name lookup and protocol modules (replaceable for tests).
 * @returns {Promise<{bytes: Buffer, mediaType: string, url: string}>} The body, its media type (`application/pdf` or `text/plain`) and the final URL.
 * @throws {FetchError} For anything that stops the fetch; never any other error.
 */
export function fetchUrl(input: string, options: {
    allow: string[];
    maxBytes: number;
    timeout: number;
    maxRedirects: number;
    allowPrivate?: boolean;
    signal?: AbortSignal;
}, deps?: {
    lookup?: (host: string) => Promise<{
        address: string;
        family: number;
    }[]>;
    modules?: {
        http: any;
        https: any;
    };
}): Promise<{
    bytes: Buffer;
    mediaType: string;
    url: string;
}>;
/**
 * Why a fetch failed. `message` is safe to show the client; `detail` is for the server's own log and may name addresses and system errors.
 */
export class FetchError extends Error {
    /**
     * @param {string} kind - `scheme`, `allow`, `dns`, `address`, `network`, `redirects`, `downgrade`, `status`, `size`, `type`, `encoding` or `timeout`.
     * @param {string} message - What to tell the client.
     * @param {string} [detail] - What to log.
     */
    constructor(kind: string, message: string, detail?: string);
    kind: string;
    detail: string;
}

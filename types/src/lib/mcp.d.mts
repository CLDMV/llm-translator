/**
 * Validate the `mcp` part of `serverTools`.
 * @param {any} value - `undefined`, or `{ hosts, timeout?, maxResponse?, fetch?, lookup? }`.
 * @returns {{hosts: string[], timeout: number, maxResponse: number, fetch: Function, lookup: Function} | undefined} The normalized setting, or undefined when MCP is off.
 * @throws {TranslatorError} `INVALID_CONFIG` for hosts that are not a non-empty list of names, or a limit that is not a positive whole number.
 */
export function normalize(value: any): {
    hosts: string[];
    timeout: number;
    maxResponse: number;
    fetch: Function;
    lookup: Function;
} | undefined;
/**
 * Whether an address is not a public one: loopback, private, link-local, unique-local, carrier-grade NAT, multicast, reserved or unspecified.
 * @param {string} address - An IPv4 or IPv6 address (an IPv4-mapped IPv6 address counts as the IPv4 one).
 * @returns {boolean} True for an address that must not be reached unless its host is named in the allowlist.
 */
export function isInternal(address: string): boolean;
/**
 * Check that a server URL may be called and say which host rule let it through.
 * @param {string} url - The `server_url`.
 * @param {{hosts: string[]}} setting - The normalized `serverTools.mcp`.
 * @returns {{url: URL, host: string, exact: boolean}} The parsed URL, its host and whether the host is named exactly (not through a wildcard).
 * @throws {TranslatorError} `unsupported_tool` (status 400) for a URL that is not `http(s)`, has credentials, or whose host is not allowed.
 */
export function allowed(url: string, setting: {
    hosts: string[];
}): {
    url: URL;
    host: string;
    exact: boolean;
};
/**
 * Connect to an MCP server. Nothing is sent until `initialize` is called.
 * @param {object} spec - The server as the request names it.
 * @param {string} spec.url - `server_url`.
 * @param {Record<string, string>} [spec.headers] - Extra headers (`headers`).
 * @param {string} [spec.authorization] - An OAuth access token (`authorization`), sent as a bearer token.
 * @param {{hosts: string[], timeout: number, maxResponse: number, fetch: Function, lookup: Function}} setting - The normalized `serverTools.mcp`.
 * @param {AbortSignal} [signal] - Aborts the calls.
 * @returns {{ initialize: () => Promise<void>, list: () => Promise<any[]>, call: (name: string, args: any) => Promise<{text: string, error: boolean}>, close: () => Promise<void> }} The client.
 * @throws {TranslatorError} `unsupported_tool` when the URL may not be called.
 */
export function connect({ url, headers, authorization }: {
    url: string;
    headers?: Record<string, string>;
    authorization?: string;
}, setting: {
    hosts: string[];
    timeout: number;
    maxResponse: number;
    fetch: Function;
    lookup: Function;
}, signal?: AbortSignal): {
    initialize: () => Promise<void>;
    list: () => Promise<any[]>;
    call: (name: string, args: any) => Promise<{
        text: string;
        error: boolean;
    }>;
    close: () => Promise<void>;
};
/** The protocol revision this client asks for. A server may answer with another one it supports; its choice is sent back in `MCP-Protocol-Version`. */
export const PROTOCOL_VERSION: "2025-06-18";

/**
 * Validate the `documentUrls` setting and fill in its defaults.
 * @param {any} value - `null` or `false` (fetching is off), or `{ allow, maxBytes?, timeout?, maxRedirects?, maxDocuments?, allowPrivate? }`.
 * @returns {{allow: string[], maxBytes: number, timeout: number, maxRedirects: number, maxDocuments: number, allowPrivate: boolean} | null} The complete setting, or null when fetching is off.
 * @throws {TranslatorError} With code `invalid_setting` for anything else, including an empty or missing `allow`.
 */
export function normalize(value: any): {
    allow: string[];
    maxBytes: number;
    timeout: number;
    maxRedirects: number;
    maxDocuments: number;
    allowPrivate: boolean;
} | null;
/**
 * A URL without its query and fragment, which can carry a signature or a token, for notes and events.
 * @param {string} url - URL.
 * @returns {string} Origin and path, or a placeholder for text that is not a URL.
 */
export function display(url: string): string;
/**
 * Whether a request needs this step: fetching is on, and nothing overrides or switches off document conversion.
 * @param {any} settings - Resolved settings.
 * @returns {boolean} True when `url` documents should be fetched.
 */
export function wanted(settings: any): boolean;
/**
 * Replace the `url` source of each `document` block (also inside `tool_result` content) with the fetched bytes as a `base64` source, which the
 * ordinary document conversion then reads. A document that could not be fetched gets a `fetch_failed` source carrying a reason that is safe for the
 * client, and the conversion turns it into a note; the request itself goes on. The same URL is fetched once per call, and no more than `maxDocuments`
 * different URLs are fetched (the rest fail with that reason). Nothing is cached between calls. The body is not changed: a copy is returned when
 * anything was replaced.
 * @param {any} body - Anthropic Messages request body.
 * @param {{options: any, report: (event: {kind: string, message: string, [detail: string]: any}) => void, signal?: AbortSignal, fetch?: Function, deps?: any}} spec - The normalized `documentUrls` setting, a function that receives one event per fetch, the caller's abort signal, and replaceable parts for tests (`fetch`, and the `deps` given to it).
 * @returns {Promise<any>} The body.
 */
export function resolve(body: any, { options, report, signal, fetch, deps }: {
    options: any;
    report: (event: {
        kind: string;
        message: string;
        [detail: string]: any;
    }) => void;
    signal?: AbortSignal;
    fetch?: Function;
    deps?: any;
}): Promise<any>;
/** Defaults of the fields of `documentUrls` other than `allow`. */
export const DEFAULTS: Readonly<{
    maxBytes: number;
    timeout: 30000;
    maxRedirects: 3;
    maxDocuments: 10;
    allowPrivate: false;
}>;

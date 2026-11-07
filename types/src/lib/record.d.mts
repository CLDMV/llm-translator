/**
 * Copy a header map with the value of every credential header replaced. A header is a credential when its name contains `key`,
 * `token`, `secret`, `auth`, `cookie` or `password` (this covers `authorization`, `proxy-authorization`, `x-api-key`, `api-key`).
 * @param {Record<string, any> | undefined} headers - Header map.
 * @returns {Record<string, any>} Copy with lowercase names.
 */
export function redact(headers: Record<string, any> | undefined): Record<string, any>;
/**
 * Validate the `capture` option.
 * @param {any} value - Raw option.
 * @returns {boolean} True when the value is `false`/`undefined`, a non-empty directory path or a function.
 */
export function valid(value: any): boolean;
/**
 * Begin the record of one exchange. With `capture` unset this returns a stand-in that does nothing.
 * @param {{config: any, state: any}} ctx - Translator `{ config, state }`.
 * @param {{body: any, sent: any, front: string, requested: string | null, headers?: Record<string, string>, log?: any}} exchange - Client body, the upstream request (result of `request`), front and the logger of the request.
 * @returns {{raw: (source: any) => any, events: (source: any) => any, reply: (status: number, headers: Record<string, string>, body: any) => void}} Recorder: `raw` taps the upstream stream bytes, `events` taps the client events and writes the record when the stream ends, `reply` writes the record of a non-stream reply.
 */
export function start({ config, state }: {
    config: any;
    state: any;
}, exchange: {
    body: any;
    sent: any;
    front: string;
    requested: string | null;
    headers?: Record<string, string>;
    log?: any;
}): {
    raw: (source: any) => any;
    events: (source: any) => any;
    reply: (status: number, headers: Record<string, string>, body: any) => void;
};
/** Most characters of a stream kept per exchange, for the raw upstream text and for the client events each. */
export const STREAM_LIMIT: 1000000;

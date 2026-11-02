/**
 * Parse SSE text/bytes (or already-parsed events) into `{ event?, data }` messages. `data` is decoded JSON, or the string
 * `"[DONE]"`.
 * @param {ReadableStream | AsyncIterable<unknown> | Iterable<unknown> | string | Uint8Array} source - SSE input.
 * @returns {AsyncGenerator<{event?: string, data: *}>} Messages.
 */
export function parse(source: ReadableStream | AsyncIterable<unknown> | Iterable<unknown> | string | Uint8Array): AsyncGenerator<{
    event?: string;
    data: any;
}>;

/**
 * Create an incremental NDJSON parser. A line may be split across chunks at any byte; the part after the last newline is held until the next
 * chunk (or `flush`) completes it. Handles `\n` and `\r\n`, and skips blank lines.
 * @returns {{ push: (chunk: string) => any[], flush: () => any[] }} Parser.
 */
export function createParser(): {
    push: (chunk: string) => any[];
    flush: () => any[];
};
/**
 * Parse NDJSON text (any `lib/source.mjs` input) into objects. Parsed objects in the source pass through, so a stream that was already
 * decoded can be fed in again.
 * @param {ReadableStream|AsyncIterable<string|Uint8Array|object>|Iterable<string|Uint8Array|object>|string|Uint8Array} source - NDJSON bytes or text.
 * @returns {AsyncGenerator<any, void, undefined>} One object per line.
 */
export function parse(source: ReadableStream | AsyncIterable<string | Uint8Array | object> | Iterable<string | Uint8Array | object> | string | Uint8Array): AsyncGenerator<any, void, undefined>;

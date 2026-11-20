/**
 * Create an incremental frame parser. A frame may be split across chunks at any byte. The prelude CRC is checked as soon as the first twelve
 * bytes are in, so a stream that is not an event stream fails at once, and the message CRC when the frame is complete.
 * @returns {{ push: (chunk: Uint8Array) => {headers: Record<string, any>, payload: Buffer}[], flush: () => void }} Parser; `push` throws `invalid_stream_data` (502) for a bad length or CRC (when frames before the bad one were read, it returns them and throws on the next `push` or `flush`), `flush` throws when the stream ended inside a frame.
 */
export function createParser(): {
    push: (chunk: Uint8Array) => {
        headers: Record<string, any>;
        payload: Buffer;
    }[];
    flush: () => void;
};
/**
 * Parse an event stream (any `lib/source.mjs` input of bytes) into frames.
 * @param {ReadableStream|AsyncIterable<Uint8Array>|Iterable<Uint8Array>|Uint8Array} source - Event stream bytes.
 * @returns {AsyncGenerator<{headers: Record<string, any>, payload: Buffer}, void, undefined>} Frames.
 */
export function frames(source: ReadableStream | AsyncIterable<Uint8Array> | Iterable<Uint8Array> | Uint8Array): AsyncGenerator<{
    headers: Record<string, any>;
    payload: Buffer;
}, void, undefined>;
/**
 * Convert an event stream to `{ event, data }` messages: the shape SSE parsing gives, so the stream converters read it like a Server-Sent Events stream.
 * - `"invoke"` (`InvokeModelWithResponseStream`): each `chunk` event carries `{ "bytes": "<base64>" }`, which decodes to one Anthropic stream event; the message is that event, named by its `type`. Bedrock's `amazon-bedrock-invocationMetrics` field is removed.
 * - `"converse"` (`ConverseStream`): each event is named by its `:event-type` header (`messageStart`, `contentBlockDelta`, ...) and its payload is the data.
 * An `exception` or `error` frame becomes one Anthropic `error` message (see `failure`), and so does a stream that cannot be read (a bad checksum, a payload that is not JSON, a frame cut short, a failing connection), after which the messages end.
 * @param {ReadableStream|AsyncIterable<Uint8Array>|Iterable<Uint8Array>|Uint8Array} source - Event stream bytes.
 * @param {"invoke" | "converse"} kind - Which API the stream comes from.
 * @returns {AsyncGenerator<{event: string, data: any}, void, undefined>} Messages.
 */
export function events(source: ReadableStream | AsyncIterable<Uint8Array> | Iterable<Uint8Array> | Uint8Array, kind: "invoke" | "converse"): AsyncGenerator<{
    event: string;
    data: any;
}, void, undefined>;

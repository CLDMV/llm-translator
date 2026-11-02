/**
 * Pump client events into a writable as SSE frames, interleaving keep-alive pings while the source is silent and honoring
 * backpressure. Does not end the writable. Stops early (closing the event source) when the writable closes.
 * @param {import("node:stream").Writable} target - Destination, for example `reply.raw`.
 * @param {AsyncIterable<{event?: string, data: *}>} events - Client events.
 * @param {any} [options] - `{ interval, front }` forwarded to `sse.ping`.
 * @returns {Promise<boolean>} True when every event was written, false when the writable closed first.
 */
export function write(target: import("node:stream").Writable, events: AsyncIterable<{
    event?: string;
    data: any;
}>, options?: any): Promise<boolean>;

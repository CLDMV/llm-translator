/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/sse/write.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:01-07:00 (1792958341)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * Pump client events into a writable as SSE frames, interleaving keep-alive pings while the source is silent and honoring
 * backpressure. Does not end the writable. Stops early (closing the event source) when the writable closes.
 * @param {import("node:stream").Writable} target - Destination, for example `reply.raw`.
 * @param {AsyncIterable<{event?: string, data: *}>} events - Client events.
 * @param {any} [options] - `{ interval, front }` forwarded to `sse.ping`.
 * @returns {Promise<boolean>} True when every event was written, false when the writable closed first.
 */
export declare function write(target: import("node:stream").Writable, events: AsyncIterable<{
    event?: string;
    data: any;
}>, options?: any): Promise<boolean>;

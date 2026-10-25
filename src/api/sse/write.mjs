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
 * @fileoverview SSE helper: write a client event stream (with pings) to a Node writable.
 * @module @cldmv/llm-translator/sse
 */
import { self } from "../../lib/runtime.mjs";

/**
 * Wait until a writable drains or closes.
 * @param {import("node:stream").Writable} target - Writable.
 * @returns {Promise<void>} Resolves on `drain` or `close`.
 */
function drained(target) {
	return new Promise((resolve) => {
		const done = () => {
			target.off("drain", done);
			target.off("close", done);
			resolve();
		};
		target.once("drain", done);
		target.once("close", done);
	});
}

/**
 * Pump client events into a writable as SSE frames, interleaving keep-alive pings while the source is silent and honoring
 * backpressure. Does not end the writable. Stops early (closing the event source) when the writable closes.
 * @param {import("node:stream").Writable} target - Destination, for example `reply.raw`.
 * @param {AsyncIterable<{event?: string, data: *}>} events - Client events.
 * @param {any} [options] - `{ interval, front }` forwarded to `sse.ping`.
 * @returns {Promise<boolean>} True when every event was written, false when the writable closed first.
 */
export async function write(target, events, options = {}) {
	const { encode, ping } = self.sse;
	for await (const message of ping(events, options)) {
		if (target.destroyed || target.writableEnded) return false;
		if (!target.write(encode(message))) await drained(target);
	}
	return !(target.destroyed || target.writableEnded);
}

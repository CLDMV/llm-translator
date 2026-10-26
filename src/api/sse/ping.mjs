/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/sse/ping.mjs
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
 * @fileoverview SSE helper: inject keep-alive pings while a stream is silent.
 * @module @cldmv/llm-translator/sse
 */
import { context } from "../../lib/runtime.mjs";
import { withPings } from "../../lib/ping.mjs";
import { resolve } from "../../lib/settings.mjs";

/**
 * Wrap an event stream so a keep-alive is yielded whenever the source is silent for `interval` ms.
 *
 * Anthropic fronts: Claude Code's idle watchdog ignores `event: ping` (it only counts real stream events) and aborts a
 * stream after 300 seconds without one, so while a content block is open the keep-alive is an empty delta of that
 * block's type (`text_delta`, `thinking_delta` or `input_json_delta` with no content), which every client treats as
 * activity and which changes nothing. With no block open, a plain `event: ping` is used. OpenAI fronts get an SSE
 * comment frame, which every OpenAI client ignores.
 * @param {AsyncIterable<{event?: string, data: *}>} events - Client events.
 * @param {any} [options] - `{ interval, front }`. `interval` defaults to the `pingInterval` setting; `0` disables pings.
 * @returns {AsyncGenerator<any>} Events interleaved with keep-alives.
 */
export function ping(events, options = {}) {
	const front = options.front ?? context.config.front;
	const interval = options.interval ?? resolve(context.config.settings).pingInterval;
	if (front !== "anthropic") return withPings(events, interval, { comment: "ping" });
	const open = new Map();
	async function* watched() {
		for await (const event of events) {
			if (event.event === "content_block_start") open.set(event.data.index, event.data.content_block?.type);
			else if (event.event === "content_block_stop") open.delete(event.data.index);
			yield event;
		}
	}
	return withPings(watched(), interval, () => keepAlive(open));
}

/**
 * Keep-alive event for the most recently opened content block, or a plain ping when none is open.
 * @param {Map<number, string>} open - Open content blocks by index.
 * @returns {{ event: string, data: any }} Event to send.
 */
function keepAlive(open) {
	const last = [...open.entries()].at(-1);
	const delta = last && DELTAS[last[1]];
	if (!delta) return { event: "ping", data: { type: "ping" } };
	return { event: "content_block_delta", data: { type: "content_block_delta", index: last[0], delta } };
}

const DELTAS = {
	text: { type: "text_delta", text: "" },
	thinking: { type: "thinking_delta", thinking: "" },
	tool_use: { type: "input_json_delta", partial_json: "" }
};

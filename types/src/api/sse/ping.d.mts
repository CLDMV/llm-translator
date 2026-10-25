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
 * Wrap an event stream so a ping is yielded whenever the source is silent for `interval` ms. Anthropic fronts get
 * `event: ping` events (Claude Code relies on them to keep its idle watchdog alive during long thinking); OpenAI fronts
 * get an SSE comment frame, which every OpenAI client ignores.
 * @param {AsyncIterable<{event?: string, data: *}>} events - Client events.
 * @param {any} [options] - `{ interval, front }`. `interval` defaults to the `pingInterval` setting; `0` disables pings.
 * @returns {AsyncGenerator<any>} Events interleaved with pings.
 */
export declare function ping(events: AsyncIterable<{
    event?: string;
    data: any;
}>, options?: any): AsyncGenerator<any>;

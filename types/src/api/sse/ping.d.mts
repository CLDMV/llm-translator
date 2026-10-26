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
export declare function ping(events: AsyncIterable<{
    event?: string;
    data: any;
}>, options?: any): AsyncGenerator<any>;

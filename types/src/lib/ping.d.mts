/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/ping.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:02-07:00 (1792958342)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */
/**
 * Wrap an async iterable so that `marker` is yielded every `interval` ms while the source produces nothing.
 * Closing the wrapper closes the source.
 * @template T
 * @param {AsyncIterable<T>} source - Event source.
 * @param {number} interval - Silence in ms before a ping; `0` (or less) disables pings.
 * @param {*} marker - Value yielded as the ping.
 * @returns {AsyncGenerator<T | *>} Source events interleaved with pings.
 */
export declare function withPings<T>(source: AsyncIterable<T>, interval: number, marker: any): AsyncGenerator<T | any>;

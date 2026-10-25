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
 * @fileoverview Keep-alive injection for streams: yields a marker while the source stays silent.
 * @module @cldmv/llm-translator/lib/ping
 */

const TICK = Symbol("tick");

/**
 * Wrap an async iterable so that `marker` is yielded every `interval` ms while the source produces nothing.
 * Closing the wrapper closes the source.
 * @template T
 * @param {AsyncIterable<T>} source - Event source.
 * @param {number} interval - Silence in ms before a ping; `0` (or less) disables pings.
 * @param {*} marker - Value yielded as the ping.
 * @returns {AsyncGenerator<T | *>} Source events interleaved with pings.
 */
export async function* withPings(source, interval, marker) {
	const iterator = source[Symbol.asyncIterator]();
	let pending = null;
	let finished = false;
	try {
		for (;;) {
			pending ??= iterator.next();
			let result;
			if (interval > 0) {
				let timer;
				const tick = new Promise((resolve) => {
					timer = setTimeout(resolve, interval, TICK);
				});
				result = await Promise.race([pending, tick]);
				clearTimeout(timer);
				if (result === TICK) {
					yield marker;
					continue;
				}
			} else {
				result = await pending;
			}
			pending = null;
			if (result.done) {
				finished = true;
				return;
			}
			yield result.value;
		}
	} catch (error) {
		finished = true;
		throw error;
	} finally {
		if (!finished) {
			pending?.catch(() => {});
			Promise.resolve(iterator.return?.()).catch(() => {});
		}
	}
}

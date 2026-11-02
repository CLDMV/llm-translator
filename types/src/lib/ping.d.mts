/**
 * Wrap an async iterable so that `marker` is yielded every `interval` ms while the source produces nothing.
 * Closing the wrapper closes the source.
 * @template T
 * @param {AsyncIterable<T>} source - Event source.
 * @param {number} interval - Silence in ms before a ping; `0` (or less) disables pings.
 * @param {*} marker - Value yielded as the ping, or a function called each time one is due that returns it.
 * @returns {AsyncGenerator<T | *>} Source events interleaved with pings.
 */
export function withPings<T>(source: AsyncIterable<T>, interval: number, marker: any): AsyncGenerator<T | any>;

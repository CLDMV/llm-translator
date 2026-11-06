/**
 * Remove a listener added with `events.on`. A listener that is not subscribed is ignored.
 * @param {string} name - Event name or `"*"`.
 * @param {Function} fn - The listener passed to `events.on`.
 * @returns {void}
 */
export function off(name: string, fn: Function): void;

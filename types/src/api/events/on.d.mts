/**
 * Subscribe to an event (see docs/events.md for the catalogue). `"*"` receives every occurrence once. The listener only observes: an
 * exception or a rejection is contained and reported once through logging.
 * @param {string} name - Event name (`log`, `warning`, `error`, `fallback`, `failover`, `effort`, `dropped`, `detect`, `usage`) or `"*"`.
 * @param {(event: import("../../lib/events.mjs").TranslatorEvent) => any} fn - Listener.
 * @returns {() => void} Function that removes the listener.
 */
export function on(name: string, fn: (event: import("../../lib/events.mjs").TranslatorEvent) => any): () => void;

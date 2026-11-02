/**
 * Collect the mounted drivers, sorted by `info().order`.
 * @param {any} driverApi - `self.driver`.
 * @returns {any[]} Driver records with captured function references.
 */
export function collect(driverApi: any): any[];
/**
 * Capture config, state, drivers and converters from a leaf's `self` and `context`.
 * @param {any} self - Slothlet `self` proxy.
 * @param {any} context - Slothlet `context` proxy (`config`, `state`).
 * @param {"anthropic" | "openai"} [frontOverride] - Client protocol for this call (default: the configured front).
 * @returns {any} Captured values and lookup helpers (safe to use after awaits).
 */
export function capture(self: any, context: any, frontOverride?: "anthropic" | "openai"): any;

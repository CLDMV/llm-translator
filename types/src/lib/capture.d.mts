/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/capture.mjs
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
 * Collect the mounted drivers, sorted by `info().order`.
 * @param {any} driverApi - `self.driver`.
 * @returns {any[]} Driver records with captured function references.
 */
export declare function collect(driverApi: any): any[];
/**
 * Capture config, state, drivers and converters from a leaf's `self` and `context`.
 * @param {any} self - Slothlet `self` proxy.
 * @param {any} context - Slothlet `context` proxy (`config`, `state`).
 * @param {"anthropic" | "openai"} [frontOverride] - Client protocol for this call (default: the configured front).
 * @returns {any} Captured values and lookup helpers (safe to use after awaits).
 */
export declare function capture(self: any, context: any, frontOverride?: "anthropic" | "openai"): any;

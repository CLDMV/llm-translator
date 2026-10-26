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
 * @fileoverview Captures everything a leaf needs from slothlet's `self` and `context` while they are still valid.
 * Slothlet's `context` and `self` only work synchronously inside a leaf call; functions captured here re-enter the
 * context when called later, so leaves (and the streams and handlers they return) keep working after an `await`.
 * @module @cldmv/llm-translator/lib/capture
 */
import { resolve } from "./settings.mjs";

/**
 * Collect the mounted drivers, sorted by `info().order`.
 * @param {any} driverApi - `self.driver`.
 * @returns {any[]} Driver records with captured function references.
 */
export function collect(driverApi) {
	const out = [];
	for (const name of Object.keys(driverApi ?? {})) {
		const driver = driverApi[name];
		if (typeof driver?.info !== "function") continue;
		out.push({
			name,
			info: driver.info(),
			detect: driver.detect,
			settings: driver.settings,
			probe: driver.probe,
			request: driver.request,
			response: driver.response,
			chunk: driver.chunk,
			error: driver.error,
			count: driver.token?.count,
			list: driver.model?.list
		});
	}
	return out.sort((left, right) => left.info.order - right.info.order);
}

/**
 * Capture config, state, drivers and converters from a leaf's `self` and `context`.
 * @param {any} self - Slothlet `self` proxy.
 * @param {any} context - Slothlet `context` proxy (`config`, `state`).
 * @param {"anthropic" | "openai"} [frontOverride] - Client protocol for this call (default: the configured front).
 * @returns {any} Captured values and lookup helpers (safe to use after awaits).
 */
export function capture(self, context, frontOverride) {
	const { config, state } = context;
	const toOpenai = self.convert.anthropic.messages.to.openai.chat;
	const toAnthropic = self.convert.openai.chat.to.anthropic.messages;
	const front = frontOverride ?? config.front;
	const drivers = collect(self.driver);
	const nativeProtocol = front === "anthropic" ? "anthropic.messages" : "openai.chat";
	const convert =
		front === "anthropic"
			? { request: toOpenai.request, response: toAnthropic.response, stream: toAnthropic.stream }
			: { request: toAnthropic.request, response: toOpenai.response, stream: toOpenai.stream };
	return {
		config,
		state,
		front,
		drivers,
		/**
		 * Find a runtime endpoint by name.
		 * @param {string} name - Endpoint name.
		 * @returns {any | undefined} Endpoint.
		 */
		endpoint: (name) => state.endpoints.find((entry) => entry.name === name),
		/**
		 * Find the driver record an endpoint uses.
		 * @param {any} endpoint - Runtime endpoint.
		 * @returns {any | undefined} Driver record.
		 */
		driver: (endpoint) => drivers.find((entry) => entry.name === endpoint.driver),
		/**
		 * Resolve the effective settings for an endpoint: endpoint > global > probed > driver > defaults.
		 * @param {any} endpoint - Runtime endpoint.
		 * @returns {any} Resolved settings.
		 */
		settings: (endpoint) => resolve(endpoint.driverSettings, endpoint.probed, config.settings, endpoint.settings),
		/**
		 * Converters for an endpoint, or null when the front and the upstream speak the same protocol.
		 * @param {any} endpoint - Runtime endpoint.
		 * @returns {{request: Function, response: Function, stream: Function} | null} Converters or null.
		 */
		converters: (endpoint) => (endpoint.protocol === nativeProtocol ? null : convert)
	};
}

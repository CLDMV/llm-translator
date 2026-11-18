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
import * as vllm from "./vllm.mjs";
import { PROTOCOL } from "./ollama.mjs";
import * as upstream from "./responses-upstream.mjs";

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
			path: driver.path,
			request: driver.request,
			response: driver.response,
			chunk: driver.chunk,
			flush: driver.flush,
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
	const toOllama = { anthropic: self.convert.anthropic.messages.to.ollama.chat, openai: self.convert.openai.chat.to.ollama.chat };
	const fromOllama = { anthropic: self.convert.ollama.chat.to.anthropic.messages, openai: self.convert.ollama.chat.to.openai.chat };
	const front = frontOverride ?? config.front;
	const drivers = collect(self.driver);
	const nativeProtocol = front === "anthropic" ? "anthropic.messages" : "openai.chat";
	const convert =
		front === "anthropic"
			? { request: toOpenai.request, response: toAnthropic.response, stream: toAnthropic.stream }
			: { request: toAnthropic.request, response: toOpenai.response, stream: toOpenai.stream };
	// An endpoint on Ollama's native chat API: the request is converted to Ollama's body, the reply (a JSON object or NDJSON lines) from it.
	const ollama = { request: toOllama[front].request, response: fromOllama[front].response, stream: fromOllama[front].stream };
	// An endpoint on the Responses API: the request goes through the front's Responses request converter, the reply (a JSON object or SSE
	// events) is read as Chat Completions first (and, for the Anthropic front, converted from there).
	const fromResponses =
		front === "anthropic" ? self.convert.openai.responses.to.anthropic.messages : self.convert.openai.responses.to.openai.chat;
	const responses = {
		request: (front === "anthropic" ? self.convert.anthropic.messages : self.convert.openai.chat).to.openai.responses.request,
		response: fromResponses.response,
		stream: fromResponses.stream
	};
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
		 * The protocol an endpoint is using now (an `api: "auto"` endpoint may have dropped from the Responses API to Chat Completions).
		 * @param {any} endpoint - Runtime endpoint.
		 * @param {any} [sent] - The `state` of a request already sent, whose own protocol wins.
		 * @returns {string} Protocol name.
		 */
		protocol: (endpoint, sent) => upstream.protocolOf(endpoint, state.noResponses, sent?.responses),
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
		 * Converters for an endpoint (the Responses API one included), or null when the request goes to it without conversion: the front and the upstream speak the same
		 * protocol, or (given the request `body`) an Anthropic-front request goes to a vLLM upstream's native `/v1/messages` (the
		 * `nativeMessages` setting, unless the upstream answered 404 to it before or the body is one the endpoint cannot take).
		 * @param {any} endpoint - Runtime endpoint.
		 * @param {any} [body] - Client request body; without it vLLM's native endpoint is never chosen.
		 * @param {any} [sent] - The `state` of a request already sent: its reply is read the way it was asked for, even if the upstream has dropped from the Responses API to Chat Completions since.
		 * @returns {{request: Function, response: Function, stream: Function} | null} Converters or null.
		 */
		converters: (endpoint, body, sent) => {
			const protocol = upstream.protocolOf(endpoint, state.noResponses, sent?.responses);
			if (protocol === PROTOCOL) return ollama;
			if (protocol === nativeProtocol) return null;
			if (protocol === upstream.PROTOCOL) return responses;
			if (front === "anthropic" && body !== undefined && endpoint.driver === "vllm" && !state.noMessages.has(endpoint.name)) {
				const settings = resolve(endpoint.driverSettings, endpoint.probed, config.settings, endpoint.settings);
				if (vllm.wants(endpoint, settings) && vllm.unsuited(body, settings) === null) return null;
			}
			return convert;
		}
	};
}

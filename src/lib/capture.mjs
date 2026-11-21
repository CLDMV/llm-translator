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
import { MESSAGES, CHAT, RESPONSES, OLLAMA, CONVERSE, GEMINI, candidates, frontOf } from "./protocol.mjs";
import { claude } from "./bedrock.mjs";

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
			auth: driver.auth,
			request: driver.request,
			sign: driver.sign,
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
	const toConverse = {
		anthropic: self.convert.anthropic.messages.to.bedrock.converse,
		openai: self.convert.openai.chat.to.bedrock.converse
	};
	const fromConverse = {
		anthropic: self.convert.bedrock.converse.to.anthropic.messages,
		openai: self.convert.bedrock.converse.to.openai.chat
	};
	const toGemini = {
		anthropic: self.convert.anthropic.messages.to.google.gemini,
		openai: self.convert.openai.chat.to.google.gemini
	};
	const fromGemini = {
		anthropic: self.convert.google.gemini.to.anthropic.messages,
		openai: self.convert.google.gemini.to.openai.chat
	};
	const front = frontOverride ?? config.front;
	const drivers = collect(self.driver);
	const nativeProtocol = front === "anthropic" ? MESSAGES : CHAT;
	const convert =
		front === "anthropic"
			? { request: toOpenai.request, response: toAnthropic.response, stream: toAnthropic.stream }
			: { request: toAnthropic.request, response: toOpenai.response, stream: toOpenai.stream };
	// An endpoint on Ollama's native chat API: the request is converted to Ollama's body, the reply (a JSON object or NDJSON lines) from it.
	const ollama = { request: toOllama[front].request, response: fromOllama[front].response, stream: fromOllama[front].stream };
	// An endpoint on Amazon Bedrock's Converse API: the request is converted to Converse's body, the reply (a JSON object or event stream frames) from it.
	const converse = { request: toConverse[front].request, response: fromConverse[front].response, stream: fromConverse[front].stream };
	// An endpoint on Google's native Gemini API: the request is converted to a `generateContent` body, the reply (a JSON object or SSE chunks) from it.
	const gemini = { request: toGemini[front].request, response: fromGemini[front].response, stream: fromGemini[front].stream };
	// An endpoint on the Responses API: the request goes through the front's Responses request converter, the reply (a JSON object or SSE
	// events) is read as Chat Completions first (and, for the Anthropic front, converted from there).
	const fromResponses =
		front === "anthropic" ? self.convert.openai.responses.to.anthropic.messages : self.convert.openai.responses.to.openai.chat;
	const responses = {
		request: (front === "anthropic" ? self.convert.anthropic.messages : self.convert.openai.chat).to.openai.responses.request,
		response: fromResponses.response,
		stream: fromResponses.stream
	};
	/**
	 * Converters for a protocol, as seen from the call's front.
	 * @param {string} protocol - Protocol id.
	 * @returns {{request: Function, response: Function, stream: Function} | null} Converters or null.
	 */
	const convertersFor = (protocol) => {
		if (protocol === OLLAMA) return ollama;
		if (protocol === CONVERSE) return converse;
		if (protocol === GEMINI) return gemini;
		if (protocol === nativeProtocol) return null;
		if (protocol === RESPONSES) return responses;
		return convert;
	};
	const plan = (endpoint, ask = {}) => {
		const { info } = drivers.find((entry) => entry.name === endpoint.driver);
		const asked = ask.front ?? front;
		const client = frontOf(asked, ask.wire);
		const settings =
			ask.body !== undefined && endpoint.driver === "vllm"
				? resolve(endpoint.driverSettings, endpoint.probed, config.settings, endpoint.settings)
				: null;
		// A Messages route on a server whose own protocol is another (vLLM's) takes an Anthropic client's body as it is, so the other fronts cannot use it, nor can a body
		// it cannot take (see `vllm.unsuited`), nor, unasked, a version known to be older than the route.
		const usable = (protocol) => {
			if (protocol !== MESSAGES || info.protocol === MESSAGES) return true;
			if (asked !== "anthropic" || ask.tokens === true) return false;
			if (endpoint.driver !== "vllm") return true;
			if (settings !== null && vllm.unsuited(ask.body, settings) !== null) return false;
			return endpoint.api !== "auto" || vllm.eligible(endpoint);
		};
		// Amazon Bedrock under `auto`: the model id decides, Claude models go through InvokeModel (Anthropic Messages) and every other model through Converse.
		const list =
			info.name === "bedrock" && endpoint.api === "auto" && ask.model !== undefined
				? [claude(ask.model) ? MESSAGES : CONVERSE]
				: candidates({ api: endpoint.api, front: client, info, missing: state.missing.get(endpoint.name), usable });
		const protocol = list[0];
		const same = asked === front;
		return {
			protocol,
			more: endpoint.api === "auto" && list.length > 1,
			convert: same ? convertersFor(protocol) : undefined
		};
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
		 * The protocol a request goes over: the one a request already sent used (`sent.protocol`), else the first candidate (see `lib/protocol`).
		 * @param {any} endpoint - Runtime endpoint.
		 * @param {any} [sent] - The `state` of a request already sent, whose own protocol wins.
		 * @returns {string} Protocol id.
		 */
		protocol: (endpoint, sent) => sent?.protocol ?? plan(endpoint).protocol,
		/**
		 * Choose the protocol for a request to an endpoint and the converters it needs.
		 * @param {any} endpoint - Runtime endpoint.
		 * @param {{body?: any, wire?: string, tokens?: boolean, front?: "anthropic" | "openai", model?: string}} [ask] - The client `body` (without it a body-dependent exclusion is not applied), the `model` sent upstream (Amazon Bedrock chooses its protocol by it), `wire: "responses"` for a request that came in on the Responses API, `tokens: true` for a token count (a tokenizer reads Chat Completions messages, so a native Messages route is left out) and `front` to ask as another front than the call's.
		 * @returns {{protocol: string, more: boolean, convert: any}} The protocol, whether an `auto` upstream has another to fall back to, and the converters (null when the body goes through as it is).
		 */
		plan,
		/**
		 * Find the driver record an endpoint uses.
		 * @param {any} endpoint - Runtime endpoint.
		 * @returns {any | undefined} Driver record.
		 */
		driver: (endpoint) => drivers.find((entry) => entry.name === endpoint.driver),
		/**
		 * Resolve the effective settings for an endpoint: endpoint > global > probed > driver > defaults. Given the protocol a request goes over, the Responses
		 * API also turns `reasoningRoundTrip` on (below the driver and the config, so an explicit setting still wins): a stateless Responses call needs its
		 * encrypted reasoning items back between turns. So does Gemini's native API, whose thought signatures must come back with tool turns.
		 * @param {any} endpoint - Runtime endpoint.
		 * @param {string} [protocol] - The protocol of the request.
		 * @returns {any} Resolved settings.
		 */
		settings: (endpoint, protocol) =>
			resolve(
				protocol === RESPONSES || protocol === GEMINI ? { reasoningRoundTrip: true } : undefined,
				endpoint.driverSettings,
				endpoint.probed,
				config.settings,
				endpoint.settings
			),
		/**
		 * Converters for a request already sent, read the way it was asked for even if the upstream has moved to another protocol since; null when
		 * the reply goes through as it is (the front and the upstream speak the same protocol, which includes vLLM's native `/v1/messages`).
		 * @param {any} sent - The `state` returned by `request`.
		 * @returns {{request: Function, response: Function, stream: Function} | null} Converters or null.
		 */
		converters: (sent) => convertersFor(sent.protocol)
	};
}

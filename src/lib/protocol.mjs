/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/protocol.mjs
 *	@Date: 2026-11-18T09:00:00-08:00 (1795021200)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-18T09:00:00-08:00 (1795021200)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview The upstream protocols, the names the `api` setting accepts for them, and how a request picks one.
 * @module @cldmv/llm-translator/lib/protocol
 */

export const MESSAGES = "anthropic.messages";
export const CHAT = "openai.chat";
export const RESPONSES = "openai.responses";
export const OLLAMA = "ollama.chat";
export const CONVERSE = "bedrock.converse";

/** The canonical protocol ids, in the order the docs list them. */
export const IDS = [MESSAGES, CHAT, RESPONSES, OLLAMA, CONVERSE];

/** Every accepted spelling of the `api` setting and the canonical id it stands for. */
export const ALIASES = Object.freeze({
	auto: "auto",
	[MESSAGES]: MESSAGES,
	messages: MESSAGES,
	anthropic: MESSAGES,
	claude: MESSAGES,
	[CHAT]: CHAT,
	chat: CHAT,
	openai: CHAT,
	chatgpt: CHAT,
	[RESPONSES]: RESPONSES,
	responses: RESPONSES,
	codex: RESPONSES,
	[OLLAMA]: OLLAMA,
	native: OLLAMA,
	ollama: OLLAMA,
	[CONVERSE]: CONVERSE,
	converse: CONVERSE
});

/**
 * The canonical `api` value for what a config says.
 * @param {any} value - The configured `api`.
 * @returns {string | undefined} `"auto"` or a canonical protocol id; undefined for anything that is not an accepted name.
 */
export function canonical(value) {
	return typeof value === "string" && Object.hasOwn(ALIASES, value.toLowerCase()) ? ALIASES[value.toLowerCase()] : undefined;
}

/**
 * The protocols a driver's server speaks: `info().protocols`, plus its own `protocol`, plus (for a driver that still declares the older flags)
 * the Responses API (`responses: true`) and its `native` mode.
 * @param {any} info - Driver facts.
 * @returns {string[]} Canonical ids, without duplicates.
 */
export function supported(info) {
	const out = [...(Array.isArray(info.protocols) ? info.protocols : [])];
	if (info.protocol !== undefined) out.push(info.protocol);
	if (info.responses === true) out.push(RESPONSES);
	if (info.native?.protocol !== undefined) out.push(info.native.protocol);
	return [...new Set(out)];
}

/**
 * The protocol a client speaks to the translator.
 * @param {"anthropic" | "openai"} front - The front.
 * @param {string} [wire] - `"responses"` for a request that came in on the Responses API.
 * @returns {string} Protocol id.
 */
export function frontOf(front, wire) {
	if (front === "anthropic") return MESSAGES;
	return wire === "responses" ? RESPONSES : CHAT;
}

/**
 * The protocols to try for a request, best first.
 * With an explicit `api` that is the one protocol. Under `auto` it is the client's own protocol, then Chat Completions, then (so a driver that speaks
 * neither, such as Anthropic's, is still reachable by conversion) the driver's own protocol, minus the ones this upstream is known not to have.
 * @param {{api: string, front: string, info: any, missing?: Set<string>, usable?: (protocol: string) => boolean}} spec - `api` is the endpoint's canonical setting, `front` the client's protocol, `info` the driver facts, `missing` the protocols remembered missing for the upstream (ignored for an explicit `api`) and `usable` a further per-request check.
 * @returns {string[]} Protocols in order; never empty.
 */
export function candidates({ api, front, info, missing, usable }) {
	const listed = supported(info);
	const ok = (protocol) => listed.includes(protocol) && (usable ? usable(protocol) : true);
	if (api !== "auto") return [ok(api) ? api : info.protocol];
	const list = [front, CHAT].filter((protocol, at, all) => all.indexOf(protocol) === at && ok(protocol) && !missing?.has(protocol));
	return list.length > 0 ? list : [info.protocol];
}

/**
 * Remember that an upstream has no route for a protocol, so later requests skip it until the next detection.
 * @param {any} state - Translator state (`missing`).
 * @param {string} name - Upstream name.
 * @param {string} protocol - Protocol id.
 * @returns {void}
 */
export function remember(state, name, protocol) {
	if (!state.missing.has(name)) state.missing.set(name, new Set());
	state.missing.get(name).add(protocol);
}

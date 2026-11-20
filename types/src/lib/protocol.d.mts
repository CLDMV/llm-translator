/**
 * The canonical `api` value for what a config says.
 * @param {any} value - The configured `api`.
 * @returns {string | undefined} `"auto"` or a canonical protocol id; undefined for anything that is not an accepted name.
 */
export function canonical(value: any): string | undefined;
/**
 * The protocols a driver's server speaks: `info().protocols`, plus its own `protocol`, plus (for a driver that still declares the older flags)
 * the Responses API (`responses: true`) and its `native` mode.
 * @param {any} info - Driver facts.
 * @returns {string[]} Canonical ids, without duplicates.
 */
export function supported(info: any): string[];
/**
 * The protocol a client speaks to the translator.
 * @param {"anthropic" | "openai"} front - The front.
 * @param {string} [wire] - `"responses"` for a request that came in on the Responses API.
 * @returns {string} Protocol id.
 */
export function frontOf(front: "anthropic" | "openai", wire?: string): string;
/**
 * The protocols to try for a request, best first.
 * With an explicit `api` that is the one protocol. Under `auto` it is the client's own protocol, then Chat Completions, then (so a driver that speaks
 * neither, such as Anthropic's, is still reachable by conversion) the driver's own protocol, minus the ones this upstream is known not to have.
 * @param {{api: string, front: string, info: any, missing?: Set<string>, usable?: (protocol: string) => boolean}} spec - `api` is the endpoint's canonical setting, `front` the client's protocol, `info` the driver facts, `missing` the protocols remembered missing for the upstream (ignored for an explicit `api`) and `usable` a further per-request check.
 * @returns {string[]} Protocols in order; never empty.
 */
export function candidates({ api, front, info, missing, usable }: {
    api: string;
    front: string;
    info: any;
    missing?: Set<string>;
    usable?: (protocol: string) => boolean;
}): string[];
/**
 * Remember that an upstream has no route for a protocol, so later requests skip it until the next detection.
 * @param {any} state - Translator state (`missing`).
 * @param {string} name - Upstream name.
 * @param {string} protocol - Protocol id.
 * @returns {void}
 */
export function remember(state: any, name: string, protocol: string): void;
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
export const MESSAGES: "anthropic.messages";
export const CHAT: "openai.chat";
export const RESPONSES: "openai.responses";
export const OLLAMA: "ollama.chat";
export const CONVERSE: "bedrock.converse";
/** The canonical protocol ids, in the order the docs list them. */
export const IDS: string[];
/** Every accepted spelling of the `api` setting and the canonical id it stands for. */
export const ALIASES: Readonly<{
    auto: "auto";
    "anthropic.messages": "anthropic.messages";
    messages: "anthropic.messages";
    anthropic: "anthropic.messages";
    claude: "anthropic.messages";
    "openai.chat": "openai.chat";
    chat: "openai.chat";
    openai: "openai.chat";
    chatgpt: "openai.chat";
    "openai.responses": "openai.responses";
    responses: "openai.responses";
    codex: "openai.responses";
    "ollama.chat": "ollama.chat";
    native: "ollama.chat";
    ollama: "ollama.chat";
    "bedrock.converse": "bedrock.converse";
    converse: "bedrock.converse";
}>;

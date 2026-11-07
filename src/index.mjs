/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/index.mjs
 *	@Date: 2026-10-24T20:20:01-07:00 (1792898401)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-01T09:42:17-08:00 (1793554937)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Public entry point for @cldmv/llm-translator.
 *
 * `createTranslator(config)` composes the slothlet api in `./api`: Anthropic Messages and OpenAI Chat Completions
 * converters, backend detection (vLLM first), routing, and an optional Fastify server.
 *
 * @module @cldmv/llm-translator
 */

import { fileURLToPath } from "node:url";
import slothlet from "@cldmv/slothlet";
import { normalize } from "./lib/config.mjs";
import { load } from "./lib/pdf.mjs";
import { transport } from "./lib/transport.mjs";
import { create, open } from "./lib/events.mjs";
import { warn } from "./lib/warn.mjs";

/**
 * @typedef {object} TranslatorConfig
 * @property {"anthropic" | "openai"} [front] Client protocol the translator speaks (default `"anthropic"`).
 * @property {Array<string | import("./lib/config.mjs").UpstreamConfig>} upstreams Upstream servers: `{ name, url, apiKey, headers, backend, models, default, settings, version }` (or a bare URL).
 * @property {Record<string, string | {model: string, effort?: "minimal"|"low"|"medium"|"high"|"xhigh"|"max", thinking?: boolean}>} [aliases] Client model name to upstream model name, or to `{ model, effort, thinking }` to pin those settings over the request's.
 * @property {Record<string, string[] | {levels: string[], default?: string | null}>} [efforts] Reasoning effort levels each model supports, keyed by model name after aliases (see docs/settings.md).
 * @property {import("./lib/pool.mjs").PoolConfig} [pool] Endpoint pools: `{ strategy, backoff: { base, max }, models }` (see docs/settings.md).
 * @property {Record<string, any>} [settings] Global converter settings (see `lib/settings.mjs`).
 * @property {boolean} [detect] Probe `auto` upstreams at startup (default true).
 * @property {number} [detectTimeout] Probe timeout in ms (default 5000).
 * @property {(url: string, init?: any) => Promise<Response>} [transport] fetch-compatible function used for all upstream calls.
 * @property {boolean | string} [logs] Logging (default `false`: no console output, no file). `true` prints warnings and errors on the console, once per message; a path appends every event as a JSON line to that file (relative paths resolve against `process.cwd()`, a missing directory is created, a file that cannot be opened is reported once on the console and logging stays off).
 * @property {false | string | ((record: object) => any)} [capture] Request and response capture for debugging (default `false`: off). A directory path writes one JSON file per exchange (`<ms>-<id>.json`, the directory is created); a function is called with each record. A record is `{ time, id, front, requested, model, endpoint, stream, client: { body }, upstream: { url, headers, body }, response }`; credential headers (names containing key, token, secret, auth, cookie or password) are replaced by `[redacted]`. A failing sink is reported once as a warning and never affects the reply (see docs/events.md).
 * @property {boolean} [events] Emit events (default `true`); `false` turns emitting off. Logging does not depend on it.
 * @property {(event: import("./lib/events.mjs").TranslatorEvent) => any} [onEvent] Callback for every event, registered before startup so it also sees startup events (see docs/events.md).
 * @property {boolean} [silent] Deprecated alias for `logs: false` (the default); `logs` wins when both are given.
 * @property {{import?: (url: string) => Promise<any>}} [slothlet] Options forwarded to slothlet (for example `import` for coverage).
 */

/**
 * Create a translator: a slothlet api instance (see the README for the leaves) bound to the given upstreams.
 * Endpoints with `backend: "auto"` are probed once before this resolves (set `detect: false` to skip all network access).
 * @param {TranslatorConfig} config - Translator config.
 * @returns {Promise<any>} The translator api (`request`, `response`, `stream`, `send`, `detect`, `status`, `token`, `model`, `error`, `events`, `sse`, `server`, `driver`, `convert`, `slothlet`).
 */
export async function createTranslator(config) {
	const normalized = normalize(config);
	const state = {
		endpoints: normalized.endpoints,
		transport: normalized.transport ?? transport,
		servers: new Set(),
		warned: new Set(),
		events: create(normalized.onEvent),
		textOnly: new Set(),
		jsonInstruction: new Set(),
		cursors: new Map(),
		front: undefined
	};
	open(state.events, normalized.logs);
	const pdf = await load();
	if (pdf.errors.canvas) {
		warn(
			normalized,
			state,
			`@napi-rs/canvas could not be loaded (${pdf.errors.canvas}); PDFs will be read as text only, without page images`,
			{ type: "detect", kind: "canvas", reason: String(pdf.errors.canvas) }
		);
	}
	if (pdf.errors.unpdf) {
		warn(normalized, state, `unpdf could not be loaded (${pdf.errors.unpdf}); PDF documents cannot be read and fall back to a note`, {
			type: "detect",
			kind: "unpdf",
			reason: String(pdf.errors.unpdf)
		});
	}
	/** @type {any} */
	const api = await slothlet({
		...config.slothlet,
		base: fileURLToPath(new URL("./api", import.meta.url)),
		mode: "eager",
		context: { config: normalized, state },
		silent: true
	});
	await api.detect({ network: normalized.detect });
	return api;
}

export { TranslatorError } from "./lib/errors.mjs";
export default createTranslator;

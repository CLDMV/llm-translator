/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/index.mjs
 *	@Date: 2026-10-24T20:20:01-07:00 (1792898401)
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
import { TranslatorError } from "./lib/errors.mjs";
import { load } from "./lib/pdf.mjs";
import { warn } from "./lib/warn.mjs";

// Development environment check. devcheck.mjs lives at the repo root and exists only in
// a source checkout; it is never published, so the import is allowed to fail. tsup keeps
// the specifier external, so dist/index.mjs imports the same root file. It runs inside an
// async function rather than as a top-level await: index.cjs loads this module through
// Node's synchronous require(esm), which rejects any module graph containing top-level
// await (ERR_REQUIRE_ASYNC_MODULE).
(async () => {
	try {
		await import("../devcheck.mjs");
	} catch {
		// ignore - devcheck.mjs is not published
	}
})();

/**
 * @typedef {object} TranslatorConfig
 * @property {"anthropic" | "openai"} [front] Client protocol the translator speaks (default `"anthropic"`).
 * @property {Array<string | import("./lib/config.mjs").UpstreamConfig>} upstreams Upstream servers: `{ name, url, apiKey, headers, backend, models, default, settings, version }` (or a bare URL).
 * @property {Record<string, string>} [aliases] Client model name to upstream model name.
 * @property {Record<string, any>} [settings] Global converter settings (see `lib/settings.mjs`).
 * @property {boolean} [detect] Probe `auto` upstreams at startup (default true).
 * @property {number} [detectTimeout] Probe timeout in ms (default 5000).
 * @property {(url: string, init?: any) => Promise<Response>} [transport] fetch-compatible function used for all upstream calls.
 * @property {boolean} [silent] Suppress warnings.
 * @property {{import?: (url: string) => Promise<any>}} [slothlet] Options forwarded to slothlet (for example `import` for coverage).
 */

/**
 * Create a translator: a slothlet api instance (see the README for the leaves) bound to the given upstreams.
 * Endpoints with `backend: "auto"` are probed once before this resolves (set `detect: false` to skip all network access).
 * @param {TranslatorConfig} config - Translator config.
 * @returns {Promise<any>} The translator api (`request`, `response`, `stream`, `send`, `detect`, `status`, `token`, `model`, `error`, `sse`, `server`, `driver`, `convert`, `slothlet`).
 */
export async function createTranslator(config) {
	const normalized = normalize(config);
	const state = {
		endpoints: normalized.endpoints,
		transport: normalized.transport ?? ((url, init) => globalThis.fetch(url, init)),
		servers: new Set(),
		warned: new Set(),
		front: undefined
	};
	const pdf = await load();
	if (pdf.errors.canvas) {
		warn(
			normalized,
			state,
			`@napi-rs/canvas could not be loaded (${pdf.errors.canvas}); PDFs will be read as text only, without page images`
		);
	}
	if (pdf.errors.unpdf) {
		warn(normalized, state, `unpdf could not be loaded (${pdf.errors.unpdf}); PDF documents cannot be read and fall back to a note`);
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

export { TranslatorError };
export default createTranslator;

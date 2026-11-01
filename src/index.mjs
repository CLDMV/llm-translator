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
import { transport } from "./lib/transport.mjs";
import { warn } from "./lib/warn.mjs";

// Development environment check. devcheck.mjs exists only in a source checkout and exits the
// process when the checkout runs without --conditions=llm-translator-dev. It is loaded
// synchronously, through require(esm), so it finishes before this module's exports can be
// called from ESM or CJS, sync or async: nothing runs against the wrong tree first. There is
// no top-level await, which index.cjs's require(esm) would reject (ERR_REQUIRE_ASYNC_MODULE).
//
// node:module is looked up at runtime with process.getBuiltinModule (Node >=20.16 / 22.3)
// instead of a static import, so bundlers never see a Node built-in or the devcheck path: a
// browser build of a package using this block keeps working, and without process (a browser)
// the check is skipped. devcheck.mjs is never published, so MODULE_NOT_FOUND is expected
// outside a checkout; any other error is a real failure. The build keeps the specifier
// external, so dist/index.mjs loads the same root file.
/* v8 ignore start -- the false branch is a non-Node runtime and the catch runs in the published
   package (no devcheck.mjs) or when devcheck.mjs fails to load; the suite always runs on Node
   from a checkout where devcheck.mjs exists and loads */
const nodeModule = typeof process === "undefined" ? undefined : process.getBuiltinModule?.("node:module");
if (nodeModule) {
	try {
		nodeModule.createRequire(import.meta.url)("../devcheck.mjs");
	} catch (error) {
		if (error?.code !== "MODULE_NOT_FOUND") throw error;
	}
}
/* v8 ignore stop */

/**
 * @typedef {object} TranslatorConfig
 * @property {"anthropic" | "openai"} [front] Client protocol the translator speaks (default `"anthropic"`).
 * @property {Array<string | import("./lib/config.mjs").UpstreamConfig>} upstreams Upstream servers: `{ name, url, apiKey, headers, backend, models, default, settings, version }` (or a bare URL).
 * @property {Record<string, string>} [aliases] Client model name to upstream model name.
 * @property {import("./lib/pool.mjs").PoolConfig} [pool] Endpoint pools: `{ strategy, backoff: { base, max }, models }` (see docs/settings.md).
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
		transport: normalized.transport ?? transport,
		servers: new Set(),
		warned: new Set(),
		textOnly: new Set(),
		cursors: new Map(),
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

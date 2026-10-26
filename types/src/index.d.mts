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
import { TranslatorError } from "./lib/errors.mjs";
export type TranslatorConfig = {
    /**
     * Client protocol the translator speaks (default `"anthropic"`).
     */
    front?: "anthropic" | "openai";
    /**
     * Upstream servers: `{ name, url, apiKey, headers, backend, models, default, settings, version }` (or a bare URL).
     */
    upstreams: Array<string | import("./lib/config.mjs").UpstreamConfig>;
    /**
     * Client model name to upstream model name.
     */
    aliases?: Record<string, string>;
    /**
     * Global converter settings (see `lib/settings.mjs`).
     */
    settings?: Record<string, any>;
    /**
     * Probe `auto` upstreams at startup (default true).
     */
    detect?: boolean;
    /**
     * Probe timeout in ms (default 5000).
     */
    detectTimeout?: number;
    /**
     * fetch-compatible function used for all upstream calls.
     */
    transport?: (url: string, init?: any) => Promise<Response>;
    /**
     * Suppress warnings.
     */
    silent?: boolean;
    /**
     * Options forwarded to slothlet (for example `import` for coverage).
     */
    slothlet?: {
        import?: (url: string) => Promise<any>;
    };
};
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
export declare function createTranslator(config: TranslatorConfig): Promise<any>;
export { TranslatorError };
export default createTranslator;

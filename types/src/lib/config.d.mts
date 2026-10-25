/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/config.mjs
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
export type UpstreamConfig = {
    /**
     * Display name, defaults to `upstream-<index>`.
     */
    name?: string;
    /**
     * Base URL of the upstream server (`http://host:8000`).
     */
    url: string;
    /**
     * Key sent to the upstream.
     */
    apiKey?: string;
    /**
     * Extra headers sent to the upstream.
     */
    headers?: Record<string, string>;
    /**
     * Driver name, or `"auto"` (default) to detect.
     */
    backend?: string;
    /**
     * Models this upstream serves (routing).
     */
    models?: string[];
    /**
     * Marks the fallback upstream.
     */
    default?: boolean;
    /**
     * Settings overrides for this upstream.
     */
    settings?: object;
    /**
     * Server version (skips nothing, but feeds version-mapped driver settings).
     */
    version?: string;
};
/**
 * @typedef {object} UpstreamConfig
 * @property {string} [name] Display name, defaults to `upstream-<index>`.
 * @property {string} url Base URL of the upstream server (`http://host:8000`).
 * @property {string} [apiKey] Key sent to the upstream.
 * @property {Record<string,string>} [headers] Extra headers sent to the upstream.
 * @property {string} [backend] Driver name, or `"auto"` (default) to detect.
 * @property {string[]} [models] Models this upstream serves (routing).
 * @property {boolean} [default] Marks the fallback upstream.
 * @property {object} [settings] Settings overrides for this upstream.
 * @property {string} [version] Server version (skips nothing, but feeds version-mapped driver settings).
 */
/**
 * Normalize one upstream entry into the runtime endpoint record.
 * @param {string | UpstreamConfig} entry - Upstream URL or config object.
 * @param {number} index - Position in the list.
 * @returns {any} Runtime endpoint.
 */
export declare function endpoint(entry: string | UpstreamConfig, index: number): any;
/**
 * Validate and normalize the translator config.
 * @param {any} [config] - Raw config passed to `createTranslator`.
 * @returns {any} Normalized config (a fresh any; the input is not mutated).
 */
export declare function normalize(config?: any): any;

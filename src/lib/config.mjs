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

/**
 * @fileoverview Normalizes the user supplied translator config into the shape the api leaves expect.
 * @module @cldmv/llm-translator/lib/config
 */
import { TranslatorError } from "./errors.mjs";

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
export function endpoint(entry, index) {
	const raw = typeof entry === "string" ? { url: entry } : entry;
	if (!raw || typeof raw !== "object" || typeof raw.url !== "string" || raw.url === "") {
		throw new TranslatorError(`upstreams[${index}] needs a "url"`, { code: "INVALID_CONFIG", status: 500 });
	}
	return {
		name: raw.name ?? `upstream-${index}`,
		url: raw.url.replace(/\/+$/, "").replace(/\/v1$/, ""),
		apiKey: raw.apiKey,
		headers: { ...raw.headers },
		backend: raw.backend ?? "auto",
		models: Array.isArray(raw.models) ? [...raw.models] : undefined,
		default: raw.default === true,
		settings: { ...raw.settings },
		version: raw.version,
		driver: null,
		facts: null,
		driverSettings: {},
		probed: {}
	};
}

/**
 * Validate and normalize the translator config.
 * @param {any} [config] - Raw config passed to `createTranslator`.
 * @returns {any} Normalized config (a fresh any; the input is not mutated).
 */
export function normalize(config = {}) {
	const front = config.front ?? "anthropic";
	if (front !== "anthropic" && front !== "openai") {
		throw new TranslatorError(`front must be "anthropic" or "openai" (got ${JSON.stringify(front)})`, {
			code: "INVALID_CONFIG",
			status: 500
		});
	}
	let list = config.upstreams ?? config.upstream;
	if (list !== undefined && !Array.isArray(list)) list = [list];
	if (!list || list.length === 0) {
		throw new TranslatorError("at least one upstream is required (config.upstreams)", { code: "INVALID_CONFIG", status: 500 });
	}
	return {
		front,
		endpoints: list.map(endpoint),
		aliases: { ...config.aliases },
		settings: { ...config.settings },
		detect: config.detect !== false,
		detectTimeout: config.detectTimeout ?? 5000,
		transport: config.transport,
		silent: config.silent === true
	};
}

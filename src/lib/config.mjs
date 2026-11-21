/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/config.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T14:05:38-07:00 (1792962338)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Normalizes the user supplied translator config into the shape the api leaves expect.
 * @module @cldmv/llm-translator/lib/config
 */
import { TranslatorError } from "./errors.mjs";
import * as pool from "./pool.mjs";
import { valid as validCapture } from "./record.mjs";
import { normalizeAliases, normalizeEfforts } from "./effort.mjs";
import { ALIASES, canonical } from "./protocol.mjs";
import { host as vertexHost, regionFor } from "./vertex.mjs";
import { defaultUrl } from "./bedrock.mjs";

/**
 * @typedef {object} UpstreamConfig
 * @property {string} [name] Display name, defaults to `upstream-<index>`.
 * @property {string} [url] Base URL of the upstream server (`http://host:8000`). Required, except for `backend: "bedrock"`, whose default is `https://bedrock-runtime.<region>.amazonaws.com`.
 * @property {string} [apiKey] Key sent to the upstream.
 * @property {Record<string,string>} [headers] Extra headers sent to the upstream.
 * @property {string} [apiVersion] Azure OpenAI `api-version`. Set, it selects the classic per-deployment URLs; unset, the v1 API is used.
 * @property {string} [deployment] Azure OpenAI deployment name for the classic URLs. Defaults to the request's model.
 * @property {{project?: string, region?: string, credentials?: string | object, accessToken?: string, getToken?: (options: {signal?: AbortSignal}) => string | Promise<string>, metadataServer?: boolean | string}} [vertex] Google Vertex AI settings (see docs/drivers.md). `url` may be left out when `backend` is `"vertex"`: it defaults to the region's host.
 * @property {string} [region] Amazon Bedrock: the AWS region SigV4 signs for. Defaults to the region in the URL's host name, then `AWS_REGION`, then `AWS_DEFAULT_REGION`.
 * @property {string} [accessKeyId] Amazon Bedrock: access key id for SigV4. Defaults to `AWS_ACCESS_KEY_ID`.
 * @property {string} [secretAccessKey] Amazon Bedrock: secret access key for SigV4. Defaults to `AWS_SECRET_ACCESS_KEY`.
 * @property {string} [sessionToken] Amazon Bedrock: session token of temporary credentials. Defaults to `AWS_SESSION_TOKEN`.
 * @property {string} [api] Which protocol of the server to speak, `"auto"` by default. Canonical ids are `"anthropic.messages"`, `"openai.chat"`, `"openai.responses"`, `"ollama.chat"`, `"bedrock.converse"`, `"google.gemini"` and `"cohere.chat"`; `"messages"`, `"anthropic"` and `"claude"` mean the first, `"chat"`, `"openai"` and `"chatgpt"` the second, `"responses"` and `"codex"` the third, `"native"` and `"ollama"` the fourth, `"converse"` the fifth, `"gemini"` and `"google"` the sixth and `"cohere"` the last. `"auto"` goes over the client's own protocol when the driver's server speaks it (Chat Completions otherwise) and falls back to the next one when the server answers 404, 405 or 501; an explicit value is always that protocol and never falls back. A protocol the driver does not list fails detection with `unsupported_api`.
 * @property {string} [backend] Driver name, or `"auto"` (default) to detect.
 * @property {string[]} [models] Models this upstream serves (routing).
 * @property {boolean} [default] Marks the fallback upstream.
 * @property {object} [settings] Settings overrides for this upstream.
 * @property {string} [version] Server version (skips nothing, but feeds version-mapped driver settings).
 */

/**
 * Upstream base URL without trailing slashes and without a trailing `/v1` (driver paths already include it).
 * A loop instead of a regular expression keeps the cost linear for any input.
 * @param {string} url - Configured URL.
 * @returns {string} Normalized URL.
 */
function baseUrl(url) {
	let end = url.length;
	while (url[end - 1] === "/") end--;
	const trimmed = url.slice(0, end);
	return trimmed.endsWith("/v1") ? trimmed.slice(0, -3) : trimmed;
}

/**
 * Normalize one upstream entry into the runtime endpoint record.
 * @param {string | UpstreamConfig} entry - Upstream URL or config object.
 * @param {number} index - Position in the list.
 * @param {any} [globalSettings] - The config's global `settings`.
 * @returns {any} Runtime endpoint.
 */
export function endpoint(entry, index, globalSettings) {
	/** @type {any} */
	let raw = typeof entry === "string" ? { url: entry } : entry;
	if (raw && typeof raw === "object" && raw.url === undefined && raw.backend === "vertex") {
		const region = regionFor({ vertex: raw.vertex });
		if (region !== undefined) raw = { ...raw, url: `https://${vertexHost(region)}` };
	}
	// An Amazon Bedrock upstream may leave out the URL: it follows from the region.
	if (raw?.url === undefined && raw?.backend === "bedrock") raw = { ...raw, url: defaultUrl(raw) };
	if (!raw || typeof raw !== "object" || typeof raw.url !== "string" || raw.url === "") {
		throw new TranslatorError(`upstreams[${index}] needs a "url"`, { code: "INVALID_CONFIG", status: 500 });
	}
	for (const key of ["apiVersion", "deployment", "region", "accessKeyId", "secretAccessKey", "sessionToken"]) {
		if (raw[key] !== undefined && (typeof raw[key] !== "string" || raw[key] === "")) {
			throw new TranslatorError(`upstreams[${index}].${key} must be a non-empty string`, { code: "INVALID_CONFIG", status: 500 });
		}
	}
	if (raw.vertex !== undefined) {
		const given = raw.vertex;
		const text = ["project", "region", "accessToken"];
		if (
			given === null ||
			typeof given !== "object" ||
			Array.isArray(given) ||
			text.some((key) => given[key] !== undefined && (typeof given[key] !== "string" || given[key] === ""))
		) {
			throw new TranslatorError(
				`upstreams[${index}].vertex must be an object whose project, region and accessToken are non-empty strings`,
				{
					code: "INVALID_CONFIG",
					status: 500
				}
			);
		}
		if (given.getToken !== undefined && typeof given.getToken !== "function") {
			throw new TranslatorError(`upstreams[${index}].vertex.getToken must be a function`, { code: "INVALID_CONFIG", status: 500 });
		}
	}
	if (raw.api !== undefined && canonical(raw.api) === undefined) {
		throw new TranslatorError(
			`upstreams[${index}].api must be one of ${Object.keys(ALIASES)
				.map((name) => JSON.stringify(name))
				.join(", ")} (got ${JSON.stringify(raw.api)})`,
			{ code: "INVALID_CONFIG", status: 500 }
		);
	}
	// `nativeMessages` (vLLM) is the deprecated way to choose the protocol; `detect` reads it once the driver is known (only a vLLM upstream ever did).
	const legacy = raw.settings?.nativeMessages ?? globalSettings?.nativeMessages;
	return {
		name: raw.name ?? `upstream-${index}`,
		url: baseUrl(raw.url),
		apiKey: raw.apiKey,
		headers: { ...raw.headers },
		apiVersion: raw.apiVersion,
		deployment: raw.deployment,
		vertex: raw.vertex,
		region: raw.region,
		accessKeyId: raw.accessKeyId,
		secretAccessKey: raw.secretAccessKey,
		sessionToken: raw.sessionToken,
		api: raw.api === undefined ? "auto" : canonical(raw.api),
		apiSet: raw.api !== undefined,
		legacy,
		backend: raw.backend ?? "auto",
		models: Array.isArray(raw.models) ? [...raw.models] : undefined,
		default: raw.default === true,
		settings: { ...raw.settings },
		version: raw.version,
		driver: null,
		facts: null,
		driverSettings: {},
		probed: {},
		health: pool.health()
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
	// `logs` wins over the deprecated `silent`, which only ever meant "no output" and so is the default now.
	const logs = config.logs ?? false;
	if (typeof logs !== "boolean" && (typeof logs !== "string" || logs === "")) {
		throw new TranslatorError("logs must be true, false or a file path (got " + JSON.stringify(logs) + ")", {
			code: "INVALID_CONFIG",
			status: 500
		});
	}
	if (config.onEvent !== undefined && typeof config.onEvent !== "function") {
		throw new TranslatorError("onEvent must be a function", { code: "INVALID_CONFIG", status: 500 });
	}
	if (!validCapture(config.capture)) {
		throw new TranslatorError("capture must be false, a directory path or a function (got " + JSON.stringify(config.capture) + ")", {
			code: "INVALID_CONFIG",
			status: 500
		});
	}
	return {
		front,
		endpoints: list.map((entry, index) => endpoint(entry, index, config.settings)),
		...normalizeAliases(config.aliases),
		efforts: normalizeEfforts(config.efforts),
		pool: pool.normalize(config.pool),
		settings: { ...config.settings },
		detect: config.detect !== false,
		detectTimeout: config.detectTimeout ?? 5000,
		transport: config.transport,
		logs,
		capture: config.capture || false,
		events: config.events !== false,
		onEvent: config.onEvent
	};
}

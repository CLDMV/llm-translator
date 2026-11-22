/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/vertex.mjs
 *	@Date: 2026-11-19T09:00:00-08:00 (1795107600)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-19T09:00:00-08:00 (1795107600)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Google Vertex AI layout for Claude: project and region, the host, the `rawPredict` paths and the request body.
 * @module @cldmv/llm-translator/lib/vertex
 */
import { TranslatorError } from "./errors.mjs";
import { credentials } from "./google-auth.mjs";

/** The `anthropic_version` Vertex AI requires in the body. */
export const VERSION = "vertex-2023-10-16";

/** The host of the regional endpoints, after the region and a dash. */
const SUFFIX = "aiplatform.googleapis.com";

/** The multi-region endpoints, which have hosts of their own (`aiplatform.us.rep.googleapis.com`). */
const MULTI = ["us", "eu"];

/**
 * The API host of a region: `<region>-aiplatform.googleapis.com`, `aiplatform.googleapis.com` for `global`, and `aiplatform.<us|eu>.rep.googleapis.com`
 * for the multi-region endpoints.
 * @param {string} region - Region such as `us-east5`, `europe-west1`, `global`, `us` or `eu`.
 * @returns {string} Host name.
 */
export function host(region) {
	if (region === "global") return SUFFIX;
	return MULTI.includes(region) ? `aiplatform.${region}.rep.googleapis.com` : `${region}-${SUFFIX}`;
}

/** The hosts that are not of the form `<region>-aiplatform.googleapis.com`: the global one and the multi-region ones. */
export const HOSTS = [SUFFIX, ...MULTI.map(host)];

/**
 * The region a Vertex AI host serves.
 * @param {string} url - Upstream base URL.
 * @returns {string | undefined} The region, `"global"` for the global host, `"us"` or `"eu"` for a multi-region host, undefined for any other host.
 */
export function regionOf(url) {
	const name = URL.canParse(url) ? new URL(url).hostname : "";
	if (name === SUFFIX) return "global";
	const multi = MULTI.find((region) => name === host(region));
	if (multi !== undefined) return multi;
	return name.endsWith(`-${SUFFIX}`) ? name.slice(0, -SUFFIX.length - 1) : undefined;
}

/**
 * The region of an upstream: the `region` setting, else the region in a Vertex AI base URL, else `CLOUD_ML_REGION`.
 * @param {any} endpoint - Runtime endpoint (`url`, `vertex`).
 * @param {Record<string, string | undefined>} [env] - Environment.
 * @returns {string | undefined} Region, or undefined when none is set.
 */
export function regionFor(endpoint, env = process.env) {
	return endpoint.vertex?.region ?? regionOf(endpoint.url) ?? (env.CLOUD_ML_REGION || undefined);
}

/**
 * The Google Cloud project and region of an upstream. The project is the `project` setting, else `ANTHROPIC_VERTEX_PROJECT_ID`,
 * `GOOGLE_CLOUD_PROJECT` or `GCLOUD_PROJECT`, else the `project_id` (or `quota_project_id`) of the credentials file.
 * @param {any} endpoint - Runtime endpoint.
 * @param {Record<string, string | undefined>} [env] - Environment.
 * @returns {{project: string, region: string}} Where requests go.
 * @throws {TranslatorError} With code `INVALID_CONFIG` when either is unknown.
 */
export function locate(endpoint, env = process.env) {
	const settings = endpoint.vertex ?? {};
	let project = settings.project ?? (env.ANTHROPIC_VERTEX_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || undefined);
	if (project === undefined && settings.getToken === undefined && settings.accessToken === undefined) {
		const creds = credentials(settings, env);
		project = creds?.project_id ?? creds?.quota_project_id;
	}
	const region = regionFor(endpoint, env);
	if (project === undefined) {
		throw new TranslatorError(
			`Upstream ${endpoint.name}: no Google Cloud project; set vertex.project, ANTHROPIC_VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT`,
			{ code: "INVALID_CONFIG", status: 500 }
		);
	}
	if (region === undefined) {
		throw new TranslatorError(`Upstream ${endpoint.name}: no Vertex AI region; set vertex.region or CLOUD_ML_REGION`, {
			code: "INVALID_CONFIG",
			status: 500
		});
	}
	return { project, region };
}

/**
 * The path of a Vertex AI call for Claude.
 * @param {"messages" | "count"} kind - `"messages"` for a request (`rawPredict`, or `streamRawPredict` when streaming), `"count"` for token counting.
 * @param {any} endpoint - Runtime endpoint.
 * @param {string} [model] - Model for a `"messages"` call, for example `claude-sonnet-4-5@20250929`.
 * @param {{stream?: boolean, env?: Record<string, string | undefined>}} [options] - Whether the call streams, and the environment.
 * @returns {string} Path starting with `/v1/projects/`.
 */
export function route(kind, endpoint, model, { stream = false, env } = {}) {
	const { project, region } = locate(endpoint, env);
	const root = `/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(region)}/publishers/anthropic/models`;
	if (kind === "count") return `${root}/count-tokens:rawPredict`;
	// `@` separates the version in a Vertex model id and is valid in a path segment, so it is left as it is.
	return `${root}/${encodeURIComponent(model ?? "").replaceAll("%40", "@")}:${stream ? "streamRawPredict" : "rawPredict"}`;
}

/**
 * Whether a model id names a Google-published Gemini model, which Vertex AI serves through `generateContent` and not `rawPredict`: `gemini-...`,
 * with or without a `models/` or `publishers/google/models/` prefix.
 * @param {unknown} model - Model id.
 * @returns {boolean} True for a Gemini model.
 */
export function gemini(model) {
	return /^(?:publishers\/google\/)?(?:models\/)?gemini-/.test(String(model));
}

/**
 * The path of a Vertex AI call for a Google-published model: `.../publishers/google/models/<model>:generateContent`, or
 * `:streamGenerateContent?alt=sse` for a stream, or `:countTokens`.
 * @param {any} endpoint - Runtime endpoint.
 * @param {string} model - Model id, for example `gemini-2.5-flash`.
 * @param {{stream?: boolean, count?: boolean, env?: Record<string, string | undefined>}} [options] - Whether the call streams or counts tokens, and the environment.
 * @returns {string} Path starting with `/v1/projects/`.
 */
export function geminiRoute(endpoint, model, { stream = false, count = false, env } = {}) {
	const { project, region } = locate(endpoint, env);
	const id = String(model).replace(/^(?:publishers\/google\/)?(?:models\/)?/, "");
	const root = `/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(region)}/publishers/google/models`;
	return `${root}/${encodeURIComponent(id)}:${count ? "countTokens" : stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
}

/**
 * The body Vertex AI takes: the Messages body with `anthropic_version` added and the model taken out (it is in the path). The model stays on the
 * result as a property that is not enumerable, so it is not sent but the rest of the translator can still read `body.model`.
 * @param {any} body - Anthropic Messages request body.
 * @returns {any} Vertex AI body.
 */
export function body(body) {
	const { model, ...rest } = body;
	const out = { anthropic_version: VERSION, ...rest };
	Object.defineProperty(out, "model", { value: model, enumerable: false, writable: true, configurable: true });
	return out;
}

/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/bedrock.mjs
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
 * @fileoverview Amazon Bedrock runtime facts shared by the driver and the config: which model ids are Claude, the region and base URL, the model path, and how a call is authenticated (a Bedrock API key as a bearer token, or SigV4 with access keys, which may come from the AWS shared config files, SSO, a credential process, ECS or EC2).
 * @module @cldmv/llm-translator/lib/bedrock
 */
import { TranslatorError } from "./errors.mjs";
import { sign as sigv4 } from "./sigv4.mjs";
import { chained } from "./aws-credentials.mjs";

/** The Bedrock runtime host names: the public one, FIPS, and an interface VPC endpoint (`vpce-...bedrock-runtime.<region>.vpce.amazonaws.com`), in the global partition and China. */
const RUNTIME_HOST = /(?:^|\.)bedrock-runtime(?:-fips)?\.([a-z0-9-]+)\.(?:vpce\.)?amazonaws\.com(?:\.cn)?$/;

/** A Claude model id: `anthropic.claude-...`, an inference profile id with a geography prefix (`us.`, `eu.`, `apac.`, `global.`, `us-gov.`), or an ARN of either. */
const CLAUDE = /(?:^|[/:])(?:[a-z-]+\.)?anthropic\.claude/;

/**
 * Does a model id name a Claude model, which InvokeModel serves with the Anthropic Messages body? An application inference profile is an
 * opaque id and so counts as not Claude (Converse serves Claude too); set the upstream's `api` for it.
 * @param {string | undefined} model - Model id, inference profile id or ARN.
 * @returns {boolean} True for a Claude id.
 */
export function claude(model) {
	return typeof model === "string" && CLAUDE.test(model);
}

/**
 * The region a runtime host name belongs to.
 * @param {string} host - Host name.
 * @returns {string | null} The region, or null when the host is not a Bedrock runtime host.
 */
export function regionOfHost(host) {
	return RUNTIME_HOST.exec(host)?.[1] ?? null;
}

/**
 * The region of an upstream: its `region`, else the one in its URL's host name, else `AWS_REGION`, else `AWS_DEFAULT_REGION`.
 * @param {{region?: string, url?: string}} endpoint - Runtime endpoint (or raw upstream config).
 * @param {Record<string, string | undefined>} [env] - Environment (default `process.env`).
 * @returns {string | null} The region, or null when none is set.
 */
export function regionOf(endpoint, env = process.env) {
	const host = URL.canParse(endpoint.url ?? "") ? new URL(/** @type {string} */ (endpoint.url)).hostname : "";
	return endpoint.region ?? regionOfHost(host) ?? env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? null;
}

/**
 * The default base URL of a region: `https://bedrock-runtime.<region>.amazonaws.com` (`.amazonaws.com.cn` in the China regions).
 * @param {{region?: string}} raw - Raw upstream config without a `url`.
 * @param {Record<string, string | undefined>} [env] - Environment (default `process.env`).
 * @returns {string} Base URL.
 * @throws {TranslatorError} `INVALID_CONFIG` when no region is configured.
 */
export function defaultUrl(raw, env = process.env) {
	const region = regionOf(raw, env);
	if (region === null) {
		throw new TranslatorError("a bedrock upstream needs a url or a region (the region setting, AWS_REGION or AWS_DEFAULT_REGION)", {
			code: "INVALID_CONFIG",
			status: 500
		});
	}
	return `https://bedrock-runtime.${region}.amazonaws.com${region.startsWith("cn-") ? ".cn" : ""}`;
}

/**
 * The URL path segment of a model: the id percent-encoded as one segment, because ids and ARNs contain `:` and `/`.
 * @param {string} model - Model id, inference profile id or ARN.
 * @returns {string} Path starting with `/model/`.
 */
export function modelPath(model) {
	return `/model/${encodeURIComponent(model)}`;
}

/**
 * How an upstream authenticates without any lookup, most specific first: the upstream's `apiKey` (a Bedrock API key, sent as a bearer token), its
 * access keys (SigV4), then the environment's `AWS_BEARER_TOKEN_BEDROCK` and `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`.
 * What is left is the AWS credential chain (see `authenticate`).
 * @param {any} endpoint - Runtime endpoint (`apiKey`, `accessKeyId`, `secretAccessKey`, `sessionToken`).
 * @param {Record<string, string | undefined>} [env] - Environment (default `process.env`).
 * @returns {{bearer: string} | {keys: {accessKeyId: string, secretAccessKey: string, sessionToken?: string}} | null} The credential, or null when there is none.
 */
export function credential(endpoint, env = process.env) {
	if (endpoint.apiKey) return { bearer: endpoint.apiKey };
	if (endpoint.accessKeyId && endpoint.secretAccessKey) {
		return { keys: { accessKeyId: endpoint.accessKeyId, secretAccessKey: endpoint.secretAccessKey, sessionToken: endpoint.sessionToken } };
	}
	if (env.AWS_BEARER_TOKEN_BEDROCK) return { bearer: env.AWS_BEARER_TOKEN_BEDROCK };
	if (env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY) {
		return {
			keys: {
				accessKeyId: env.AWS_ACCESS_KEY_ID,
				secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
				sessionToken: env.AWS_SESSION_TOKEN || undefined
			}
		};
	}
	return null;
}

/**
 * The headers of an authenticated call: the given ones with `authorization` set. The credential is, in order: the upstream's `apiKey` (a Bedrock
 * API key, `Bearer <key>`), its `accessKeyId` and `secretAccessKey`, its `profile` (a profile of the AWS shared config files, which may hold keys,
 * a `credential_process` or an SSO login), `AWS_BEARER_TOKEN_BEDROCK`, `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, and last the AWS
 * credential chain (see `lib/aws-credentials`: the `AWS_PROFILE` or `default` profile, ECS container credentials, EC2 instance metadata). Otherwise
 * the call is signed with SigV4 for the service `bedrock` in the upstream's region (or the region of the profile used), which adds
 * `x-amz-date`, `x-amz-security-token` (temporary credentials) and `authorization`; the body must be the exact text that is sent.
 * @param {any} endpoint - Runtime endpoint.
 * @param {{method: string, url: string, headers: Record<string, string>, body: string}} request - The call.
 * @param {{env?: Record<string, string | undefined>, date?: Date, transport?: Function, timeout?: number, signal?: AbortSignal, now?: () => number, run?: Function}} [options] - `env` is the environment (default `process.env`), `date` the signing time (default now), `transport` the `fetch`-compatible function the credential lookups use (default `fetch`), with their `timeout` and `signal`; `now` and `run` replace the clock and `execFile` in tests.
 * @returns {Promise<Record<string, string>>} Headers to send.
 * @throws {TranslatorError} `missing_credentials` (500) when the upstream has no credential, `missing_region` (500) when SigV4 needs a region and there is none, `upstream_auth` when a configured credential source fails.
 */
export async function authenticate(
	endpoint,
	request,
	{ env = process.env, date, transport = globalThis.fetch, timeout, signal, now, run } = {}
) {
	const explicit = Boolean(endpoint.apiKey || (endpoint.accessKeyId && endpoint.secretAccessKey));
	let credentials = endpoint.profile && !explicit ? null : credential(endpoint, env);
	let found = null;
	if (credentials === null) {
		found = await chained({ profile: endpoint.profile, env, transport, timeout, signal, now, run });
		if (found !== null) credentials = { keys: found.keys };
	}
	if (credentials === null) {
		throw new TranslatorError(
			`Upstream ${endpoint.name}: no AWS credentials; set apiKey (a Bedrock API key), accessKeyId and secretAccessKey, or profile, or AWS_BEARER_TOKEN_BEDROCK, or AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or configure an AWS profile, an ECS task role or an EC2 instance role`,
			{ code: "missing_credentials", status: 500 }
		);
	}
	const { authorization: _, ...headers } = request.headers;
	if ("bearer" in credentials) return { ...headers, authorization: `Bearer ${credentials.bearer}` };
	const region = regionOf(endpoint, env) ?? found?.region ?? null;
	if (region === null) {
		throw new TranslatorError(`Upstream ${endpoint.name}: no AWS region; set region, or AWS_REGION or AWS_DEFAULT_REGION`, {
			code: "missing_region",
			status: 500
		});
	}
	return sigv4({ ...request, headers, region, service: "bedrock", ...credentials.keys, date }).headers;
}

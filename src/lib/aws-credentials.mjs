/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/aws-credentials.mjs
 *	@Date: 2026-11-22T09:00:00-08:00 (1795370400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-22T09:00:00-08:00 (1795370400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview AWS credentials for the Amazon Bedrock driver without the AWS SDK: the shared config and credentials files (profiles, `credential_process`, IAM Identity Center / SSO with its cached token), ECS container credentials and EC2 instance metadata (IMDSv2). Network calls go through the translator's `fetch`-compatible transport.
 * @module @cldmv/llm-translator/lib/aws-credentials
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { TranslatorError } from "./errors.mjs";

/** Credentials are refreshed this long (ms) before they expire. */
const SKEW = 5 * 60_000;

/** How long (ms) credentials that carry no expiry are reused. */
const STATIC_TTL = 60_000;

/** Longest (ms) a `credential_process` may run. */
const PROCESS_TIMEOUT = 30_000;

/** Where the ECS agent serves container credentials for a relative URI. */
const ECS_HOST = "http://169.254.170.2";

/** Where the EC2 instance metadata service is, unless `AWS_EC2_METADATA_SERVICE_ENDPOINT` says otherwise. */
const IMDS_HOST = "http://169.254.169.254";

/** Credentials by identity: `{ keys, expires }` once resolved, `{ pending }` while a lookup is running. */
const cache = new Map();

/**
 * Forget every cached credential (used by tests).
 * @returns {void}
 */
export function reset() {
	cache.clear();
}

/**
 * The error for a credential source that is configured but does not work.
 * @param {string} message - What went wrong (never contains a secret).
 * @param {number} [status] - HTTP status of the reply to the client.
 * @returns {TranslatorError} Error with code `upstream_auth`.
 */
function failure(message, status = 500) {
	return new TranslatorError(message, { code: "upstream_auth", status });
}

/**
 * Parse an AWS shared config or credentials file: `[section]` headers and `key = value` lines. `#` and `;` start a comment line, and an indented
 * line (a nested setting such as `s3 =` blocks) belongs to the key above it and is left out. A `[profile name]` header names the profile `name`
 * (`[default]` is `default`), and in the credentials file the header is the name itself.
 * @param {string} text - File contents.
 * @param {boolean} config - True for the config file, where profile headers say `profile `.
 * @returns {{ profiles: Map<string, Record<string, string>>, sessions: Map<string, Record<string, string>> }} Profiles and `sso-session` sections by name.
 */
export function parseIni(text, config) {
	const profiles = new Map();
	const sessions = new Map();
	let current = null;
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
		const header = /^\[\s*([^\]]*?)\s*\]/.exec(trimmed);
		if (header) {
			const title = header[1];
			const session = /^sso-session\s+(.+)$/.exec(title);
			const named = config ? /^profile\s+(.+)$/.exec(title) : null;
			const into = session ? sessions : profiles;
			const name = session ? session[1] : named ? named[1] : title;
			// In the config file only `default` and `profile x` headers are profiles; anything else (`services x`) is not one.
			if (config && !session && !named && title !== "default") current = null;
			else {
				if (!into.has(name)) into.set(name, {});
				current = into.get(name);
			}
			continue;
		}
		if (current === null || /^\s/.test(line)) continue;
		const at = trimmed.indexOf("=");
		if (at > 0) current[trimmed.slice(0, at).trim()] = trimmed.slice(at + 1).trim();
	}
	return { profiles, sessions };
}

/**
 * The home directory the `.aws` folder is under.
 * @param {Record<string, string | undefined>} env - Environment.
 * @returns {string} Path.
 */
function homeOf(env) {
	return env.HOME || env.USERPROFILE || os.homedir();
}

/**
 * Read the shared config and credentials files (`AWS_CONFIG_FILE` and `AWS_SHARED_CREDENTIALS_FILE`, else `~/.aws/config` and
 * `~/.aws/credentials`). A file that does not exist is empty; for a profile in both, a key of the credentials file wins.
 * @param {Record<string, string | undefined>} env - Environment.
 * @returns {{ profiles: Map<string, Record<string, string>>, sessions: Map<string, Record<string, string>> }} Profiles and SSO sessions.
 */
export function load(env) {
	const home = homeOf(env);
	const read = (file, config) => {
		let text = "";
		try {
			text = fs.readFileSync(file, "utf8");
		} catch {
			// A file that is not there has no profiles.
		}
		return parseIni(text, config);
	};
	const config = read(env.AWS_CONFIG_FILE || path.join(home, ".aws", "config"), true);
	const shared = read(env.AWS_SHARED_CREDENTIALS_FILE || path.join(home, ".aws", "credentials"), false);
	for (const [name, values] of shared.profiles) config.profiles.set(name, { ...config.profiles.get(name), ...values });
	return config;
}

/**
 * Split a command line into words the way a shell would for the common cases: whitespace separates, single and double quotes group, a backslash
 * escapes inside double quotes and outside quotes.
 * @param {string} command - Command line (`credential_process` value).
 * @returns {string[]} Words.
 */
export function words(command) {
	const out = [];
	let word = null;
	let quote = null;
	for (let at = 0; at < command.length; at++) {
		const char = command[at];
		if (quote === null && /\s/.test(char)) {
			if (word !== null) out.push(word);
			word = null;
		} else if (quote === null && (char === '"' || char === "'")) {
			quote = char;
			word ??= "";
		} else if (char === quote) quote = null;
		else if (char === "\\" && quote !== "'" && at + 1 < command.length) word = (word ?? "") + command[++at];
		else word = (word ?? "") + char;
	}
	if (word !== null) out.push(word);
	return out;
}

/**
 * Read a credential document (`AccessKeyId`, `SecretAccessKey`, `SessionToken` or `Token`, `Expiration`) as keys.
 * @param {any} body - Parsed JSON.
 * @param {string} origin - Where it came from, for messages.
 * @returns {{ keys: {accessKeyId: string, secretAccessKey: string, sessionToken?: string}, expires?: number }} Keys and the expiry in ms, when there is one.
 * @throws {TranslatorError} When the keys are missing.
 */
function document(body, origin) {
	if (
		typeof body?.AccessKeyId !== "string" ||
		body.AccessKeyId === "" ||
		typeof body.SecretAccessKey !== "string" ||
		body.SecretAccessKey === ""
	) {
		throw failure(`AWS credentials from ${origin} have no AccessKeyId and SecretAccessKey`, 502);
	}
	const token = body.SessionToken ?? body.Token;
	const expires = typeof body.Expiration === "string" ? Date.parse(body.Expiration) : Number.NaN;
	return {
		keys: {
			accessKeyId: body.AccessKeyId,
			secretAccessKey: body.SecretAccessKey,
			...(typeof token === "string" && token !== "" ? { sessionToken: token } : {})
		},
		...(Number.isFinite(expires) ? { expires } : {})
	};
}

/**
 * Send a request through the transport and read the reply.
 * @param {Function} transport - `fetch`-compatible function.
 * @param {string} url - URL.
 * @param {{method?: string, headers?: Record<string, string>}} init - Request.
 * @param {{timeout?: number, signal?: AbortSignal}} limits - Time limit in ms (0 or absent: none) and an abort signal.
 * @returns {Promise<{ok: boolean, status: number, text: string}>} Status and body text.
 * @throws {Error} When the server cannot be reached.
 */
async function ask(transport, url, init, { timeout, signal }) {
	const signals = [];
	if (signal) signals.push(signal);
	if (timeout > 0) signals.push(AbortSignal.timeout(timeout));
	const res = await transport(url, { redirect: "error", ...init, ...(signals.length > 0 ? { signal: AbortSignal.any(signals) } : {}) });
	return { ok: res.ok, status: res.status, text: await res.text() };
}

/**
 * Parse reply text as JSON.
 * @param {string} text - Body.
 * @returns {any} The value, or null when it is not JSON.
 */
function parse(text) {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

/**
 * Run a `credential_process` and read the credentials it prints.
 * @param {string} command - The profile's `credential_process`.
 * @param {string} profile - Profile name, for messages.
 * @param {Function} run - `execFile`-compatible function.
 * @returns {Promise<any>} Credentials and expiry (see `document`).
 */
async function fromProcess(command, profile, run) {
	const [file, ...args] = words(command);
	const output = await new Promise((resolve, reject) => {
		run(file, args, { timeout: PROCESS_TIMEOUT, maxBuffer: 1024 * 1024, windowsHide: true }, (error, stdout) =>
			error ? reject(error) : resolve(stdout)
		);
	}).catch((cause) => {
		throw failure(`AWS profile ${profile}: credential_process failed (${cause.code ?? cause.message})`);
	});
	const body = parse(String(output));
	if (body?.Version !== 1) throw failure(`AWS profile ${profile}: credential_process printed no version 1 credentials`);
	return document(body, `the credential_process of profile ${profile}`);
}

/**
 * The credentials of an IAM Identity Center (SSO) profile: the access token `aws sso login` cached, exchanged for the role's credentials
 * (`GetRoleCredentials`). The token is not refreshed; when it has expired, `aws sso login` is the fix.
 * @param {string} name - Profile name.
 * @param {Record<string, string>} profile - The profile.
 * @param {Map<string, Record<string, string>>} sessions - The `sso-session` sections.
 * @param {{ env: Record<string, string | undefined>, transport: Function, timeout?: number, signal?: AbortSignal, now: () => number }} options - Environment, transport, limit, signal and clock.
 * @returns {Promise<any>} Credentials and expiry (see `document`).
 */
async function fromSso(name, profile, sessions, { env, transport, timeout, signal, now }) {
	const session = profile.sso_session === undefined ? undefined : sessions.get(profile.sso_session);
	const start = profile.sso_start_url ?? session?.sso_start_url;
	const region = profile.sso_region ?? session?.sso_region;
	if (!start || !region || !profile.sso_account_id || !profile.sso_role_name) {
		throw failure(
			`AWS profile ${name}: an SSO profile needs sso_session (or sso_start_url and sso_region), sso_account_id and sso_role_name`
		);
	}
	// The token file is named for the SHA-1 of the session name, or of the start URL for a profile without a session.
	const file = path.join(
		homeOf(env),
		".aws",
		"sso",
		"cache",
		`${crypto
			.createHash("sha1")
			.update(profile.sso_session ?? start)
			.digest("hex")}.json`
	);
	let cached;
	try {
		cached = JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		throw failure(`AWS profile ${name}: no SSO login found; run \`aws sso login --profile ${name}\``);
	}
	const expires = Date.parse(cached?.expiresAt);
	if (typeof cached?.accessToken !== "string" || !(expires > now())) {
		throw failure(`AWS profile ${name}: the SSO login has expired; run \`aws sso login --profile ${name}\``);
	}
	const url = `https://portal.sso.${region}.amazonaws.com${region.startsWith("cn-") ? ".cn" : ""}/federation/credentials?${new URLSearchParams(
		{
			role_name: profile.sso_role_name,
			account_id: profile.sso_account_id
		}
	)}`;
	let reply;
	try {
		reply = await ask(transport, url, { method: "GET", headers: { "x-amz-sso_bearer_token": cached.accessToken } }, { timeout, signal });
	} catch (cause) {
		throw failure(`AWS SSO credentials request failed: ${cause.message}`, 502);
	}
	const role = parse(reply.text)?.roleCredentials;
	if (!reply.ok || typeof role?.accessKeyId !== "string" || typeof role?.secretAccessKey !== "string") {
		throw failure(
			`AWS SSO refused the credentials of profile ${name} (HTTP ${reply.status}); run \`aws sso login --profile ${name}\``,
			502
		);
	}
	return document(
		{
			AccessKeyId: role.accessKeyId,
			SecretAccessKey: role.secretAccessKey,
			SessionToken: role.sessionToken,
			Expiration: Number.isFinite(role.expiration) ? new Date(role.expiration).toISOString() : undefined
		},
		`SSO profile ${name}`
	);
}

/**
 * The credentials a profile names, by the first kind it has: SSO, access keys, a credential process.
 * @param {string} name - Profile name.
 * @param {{ profiles: Map<string, Record<string, string>>, sessions: Map<string, Record<string, string>> }} files - The parsed files.
 * @param {any} options - See `fromSso`, plus `run`.
 * @returns {Promise<any | null>} Credentials and expiry, or null when the profile does not exist or names no credentials.
 */
async function fromProfile(name, files, options) {
	const profile = files.profiles.get(name);
	if (profile === undefined) return null;
	const region = profile.region;
	let found = null;
	if (profile.sso_session || profile.sso_start_url || profile.sso_account_id || profile.sso_role_name) {
		found = await fromSso(name, profile, files.sessions, options);
	} else if (profile.aws_access_key_id && profile.aws_secret_access_key) {
		found = {
			keys: {
				accessKeyId: profile.aws_access_key_id,
				secretAccessKey: profile.aws_secret_access_key,
				...(profile.aws_session_token ? { sessionToken: profile.aws_session_token } : {})
			}
		};
	} else if (profile.credential_process) found = await fromProcess(profile.credential_process, name, options.run);
	return found === null ? null : { ...found, ...(region ? { region } : {}) };
}

/**
 * The credentials of the ECS task role (or any container credentials endpoint), from `AWS_CONTAINER_CREDENTIALS_RELATIVE_URI` or
 * `AWS_CONTAINER_CREDENTIALS_FULL_URI`. An `AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE` (or `AWS_CONTAINER_AUTHORIZATION_TOKEN`) is sent as the
 * `authorization` header.
 * @param {string} url - The endpoint's URL.
 * @param {{ env: Record<string, string | undefined>, transport: Function, timeout?: number, signal?: AbortSignal }} options - Environment, transport, limit and signal.
 * @returns {Promise<any>} Credentials and expiry (see `document`).
 */
async function fromContainer(url, { env, transport, timeout, signal }) {
	let token = env.AWS_CONTAINER_AUTHORIZATION_TOKEN;
	if (env.AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE) {
		try {
			token = fs.readFileSync(env.AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE, "utf8").trim();
		} catch (cause) {
			throw failure(`AWS container credentials: cannot read AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE (${cause.code})`);
		}
	}
	let reply;
	try {
		reply = await ask(transport, url, { method: "GET", headers: token ? { authorization: token } : {} }, { timeout, signal });
	} catch (cause) {
		throw failure(`AWS container credentials request to ${url} failed: ${cause.message}`, 502);
	}
	if (!reply.ok) throw failure(`AWS container credentials endpoint refused the request (HTTP ${reply.status})`, 502);
	return document(parse(reply.text), "the container credentials endpoint");
}

/**
 * The credentials of the EC2 instance profile from the instance metadata service: a session token first (IMDSv2; a service that does not
 * take one is asked without), then the role name, then the role's credentials. `AWS_EC2_METADATA_DISABLED=true` skips it, and an unreachable
 * service is the end of the chain (null), because most machines are not on EC2.
 * @param {{ env: Record<string, string | undefined>, transport: Function, signal?: AbortSignal }} options - Environment, transport and signal.
 * @returns {Promise<any | null>} Credentials and expiry, or null when there is no metadata service.
 */
async function fromInstance({ env, transport, signal }) {
	if (String(env.AWS_EC2_METADATA_DISABLED).toLowerCase() === "true") return null;
	const base = (env.AWS_EC2_METADATA_SERVICE_ENDPOINT || IMDS_HOST).replace(/\/+$/, "");
	const seconds = Number(env.AWS_METADATA_SERVICE_TIMEOUT);
	const limits = { timeout: seconds > 0 ? seconds * 1000 : 1000, signal };
	try {
		const issued = await ask(
			transport,
			`${base}/latest/api/token`,
			{ method: "PUT", headers: { "x-aws-ec2-metadata-token-ttl-seconds": "21600" } },
			limits
		);
		const headers = issued.ok ? { "x-aws-ec2-metadata-token": issued.text.trim() } : {};
		const root = `${base}/latest/meta-data/iam/security-credentials/`;
		let role = env.AWS_EC2_INSTANCE_PROFILE_NAME;
		if (!role) {
			const listed = await ask(transport, root, { method: "GET", headers }, limits);
			if (!listed.ok) return null;
			role = listed.text.split(/\r?\n/)[0].trim();
		}
		const reply = await ask(transport, `${root}${encodeURIComponent(role)}`, { method: "GET", headers }, limits);
		const body = parse(reply.text);
		if (!reply.ok || body === null || (body.Code !== undefined && body.Code !== "Success")) return null;
		return document(body, "the instance metadata service");
	} catch (cause) {
		// An error from `document` is a credential reply that is wrong, which is worth reporting; everything else means there is no metadata service.
		if (cause instanceof TranslatorError) throw cause;
		return null;
	}
}

/**
 * Run the chain once: the named profile (or `AWS_PROFILE`, else `default`), then container credentials when the environment names an endpoint,
 * then the instance metadata service. A profile the settings or `AWS_PROFILE` name must exist and give credentials.
 * @param {string | undefined} explicit - The profile that was asked for by name, if any.
 * @param {any} options - See `fromSso`, plus `run`.
 * @returns {Promise<any | null>} Credentials, expiry and the profile's region, or null when nothing in the chain has credentials.
 */
async function chain(explicit, options) {
	const { env } = options;
	const name = explicit ?? "default";
	const files = load(env);
	const found = await fromProfile(name, files, options);
	if (found !== null) return found;
	if (explicit !== undefined) throw failure(`AWS profile ${explicit} was not found or names no credentials`);
	if (env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI) return fromContainer(`${ECS_HOST}${env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI}`, options);
	if (env.AWS_CONTAINER_CREDENTIALS_FULL_URI) return fromContainer(env.AWS_CONTAINER_CREDENTIALS_FULL_URI, options);
	return fromInstance(options);
}

/**
 * Find AWS credentials the way the AWS SDKs do after explicit keys and the key environment variables: the profile named by `profile` or
 * `AWS_PROFILE` (else `default`) in the shared files, which may hold access keys, a `credential_process` or an SSO login; then the ECS task
 * role; then the EC2 instance profile. Credentials with an expiry are cached until five minutes before it (credentials without one for a
 * minute), and callers that arrive during a lookup share it. A failed lookup is not cached.
 * @param {{ profile?: string, env?: Record<string, string | undefined>, transport: Function, timeout?: number, signal?: AbortSignal, now?: () => number, run?: Function }} spec - `profile` is the upstream's `profile` setting; `transport` is the `fetch`-compatible function the requests go through; `run` is `execFile` (replaced in tests).
 * @returns {Promise<{keys: {accessKeyId: string, secretAccessKey: string, sessionToken?: string}, region?: string} | null>} The credentials and the region the profile names, or null when the chain has none.
 * @throws {TranslatorError} `upstream_auth` when a source that is configured fails (a named profile that is missing, a failing process, an expired SSO login, a refusing endpoint).
 */
export function chained({ profile, env = process.env, transport, timeout, signal, now = Date.now, run = execFile }) {
	const explicit = profile || env.AWS_PROFILE || undefined;
	const key = [
		explicit ?? "",
		env.AWS_CONFIG_FILE ?? "",
		env.AWS_SHARED_CREDENTIALS_FILE ?? "",
		homeOf(env),
		env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ?? env.AWS_CONTAINER_CREDENTIALS_FULL_URI ?? "",
		env.AWS_EC2_METADATA_SERVICE_ENDPOINT ?? ""
	].join("|");
	const hit = cache.get(key);
	if (hit?.pending) return hit.pending;
	if (hit && hit.expires - SKEW > now()) return Promise.resolve(hit.found);
	const pending = chain(explicit, { env, transport, timeout, signal, now, run }).then(
		(found) => {
			if (found === null) {
				cache.delete(key);
				return null;
			}
			const value = { keys: found.keys, ...(found.region ? { region: found.region } : {}) };
			cache.set(key, { found: value, expires: found.expires ?? now() + STATIC_TTL + SKEW });
			return value;
		},
		(cause) => {
			cache.delete(key);
			throw cause;
		}
	);
	cache.set(key, { pending });
	return pending;
}

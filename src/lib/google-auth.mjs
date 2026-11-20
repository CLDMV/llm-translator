/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/google-auth.mjs
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
 * @fileoverview Google OAuth 2.0 access tokens for the Vertex AI driver, with no dependencies: `node:crypto` signs the service-account JWT and the
 * token requests go through the translator's `fetch`-compatible transport.
 * @module @cldmv/llm-translator/lib/google-auth
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TranslatorError } from "./errors.mjs";

/** The OAuth scope Vertex AI needs. */
export const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

/** Where Google's token endpoint is, for credentials that do not name one. */
export const TOKEN_URI = "https://oauth2.googleapis.com/token";

/** Base URL of the GCE metadata server, used when `metadataServer` is `true`. */
export const METADATA_URL = "http://metadata.google.internal";

/** A cached token is refreshed this long (ms) before it expires. */
const SKEW = 60_000;

/** Lifetime of the JWT assertion in seconds (Google's maximum). */
const ASSERTION_TTL = 3600;

/** Tokens by credential identity: `{ token, expires }` once fetched, `{ pending }` while a refresh is running. */
const tokens = new Map();

/** Credential files already read, by path. */
const files = new Map();

/**
 * Forget every cached token and credential file (used by tests).
 * @returns {void}
 */
export function reset() {
	tokens.clear();
	files.clear();
}

/**
 * Base64url without padding.
 * @param {string | Buffer} input - Data.
 * @returns {string} Encoded text.
 */
export function base64url(input) {
	return Buffer.from(input).toString("base64url");
}

/**
 * The error for a credential or token failure.
 * @param {string} message - What went wrong (never contains a secret).
 * @param {number} [status] - HTTP status of the reply to the client.
 * @returns {TranslatorError} Error with code `upstream_auth`.
 */
function failure(message, status = 401) {
	return new TranslatorError(message, { code: "upstream_auth", status });
}

/**
 * Build the signed JWT a service account exchanges for an access token (RS256, `node:crypto`).
 * @param {{client_email: string, private_key: string, private_key_id?: string, token_uri?: string}} credentials - A service-account key.
 * @param {{now?: number, scope?: string}} [options] - `now` in ms (default the clock) and the OAuth scope.
 * @returns {string} `header.claims.signature`.
 */
export function assertion(credentials, { now = Date.now(), scope = SCOPE } = {}) {
	const issued = Math.floor(now / 1000);
	const header = { alg: "RS256", typ: "JWT", ...(credentials.private_key_id ? { kid: credentials.private_key_id } : {}) };
	const claims = {
		iss: credentials.client_email,
		scope,
		aud: credentials.token_uri ?? TOKEN_URI,
		iat: issued,
		exp: issued + ASSERTION_TTL
	};
	const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
	let signature;
	try {
		signature = crypto.createSign("RSA-SHA256").update(unsigned).sign(credentials.private_key);
	} catch (cause) {
		throw failure(`Google credentials: the service account private key cannot sign (${cause.message})`);
	}
	return `${unsigned}.${base64url(signature)}`;
}

/**
 * The path of gcloud's application default credentials file (`gcloud auth application-default login`).
 * @param {Record<string, string | undefined>} env - Environment.
 * @param {string} [platform] - `process.platform`.
 * @returns {string} Path.
 */
export function wellKnown(env, platform = process.platform) {
	const home = env.HOME || env.USERPROFILE || os.homedir();
	const root =
		env.CLOUDSDK_CONFIG ?? (platform === "win32" && env.APPDATA ? path.join(env.APPDATA, "gcloud") : path.join(home, ".config", "gcloud"));
	return path.join(root, "application_default_credentials.json");
}

/**
 * Check a parsed credentials file and return it.
 * @param {any} value - Parsed JSON.
 * @param {string} origin - Where it came from, for messages.
 * @returns {any} The credentials.
 * @throws {TranslatorError} For a type this driver cannot use or a missing field.
 */
function checked(value, origin) {
	const need =
		value?.type === "service_account"
			? ["client_email", "private_key"]
			: value?.type === "authorized_user"
				? ["client_id", "client_secret", "refresh_token"]
				: null;
	if (need === null) {
		throw failure(
			`Google credentials (${origin}): type ${JSON.stringify(value?.type)} is not supported; use a service account key or an authorized_user file, or pass getToken`
		);
	}
	const missing = need.filter((field) => typeof value[field] !== "string" || value[field] === "");
	if (missing.length > 0) throw failure(`Google credentials (${origin}): missing ${missing.join(", ")}`);
	return value;
}

/**
 * Read credentials from the `credentials` setting (an object, JSON text or a file path) or from a path in the environment.
 * @param {any} source - Setting value or path.
 * @param {string} origin - Where it came from, for messages.
 * @returns {any} Credentials.
 */
function read(source, origin) {
	if (source !== null && typeof source === "object") return checked(source, origin);
	if (typeof source !== "string") throw failure(`Google credentials (${origin}): expected an object or a file path`);
	if (source.trimStart().startsWith("{")) {
		try {
			return checked(JSON.parse(source), origin);
		} catch (cause) {
			if (cause instanceof TranslatorError) throw cause;
			throw failure(`Google credentials (${origin}): the JSON text does not parse`);
		}
	}
	if (!files.has(source)) {
		let text;
		try {
			text = fs.readFileSync(source, "utf8");
		} catch (cause) {
			throw failure(`Google credentials (${origin}): cannot read ${source} (${cause.code})`);
		}
		try {
			files.set(source, JSON.parse(text));
		} catch {
			throw failure(`Google credentials (${origin}): ${source} is not JSON`);
		}
	}
	return checked(files.get(source), `${origin}: ${source}`);
}

/**
 * The credentials the settings and environment name, without any network access: the `credentials` setting, then `GOOGLE_APPLICATION_CREDENTIALS`,
 * then gcloud's application default credentials file when it exists.
 * @param {any} settings - The upstream's `vertex` settings.
 * @param {Record<string, string | undefined>} [env] - Environment.
 * @returns {any | null} Credentials, or null when none are configured.
 */
export function credentials(settings, env = process.env) {
	if (settings?.credentials !== undefined) return read(settings.credentials, "credentials setting");
	if (env.GOOGLE_APPLICATION_CREDENTIALS) return read(env.GOOGLE_APPLICATION_CREDENTIALS, "GOOGLE_APPLICATION_CREDENTIALS");
	const known = wellKnown(env);
	if (files.has(known) || fs.existsSync(known)) return read(known, "application default credentials");
	return null;
}

/**
 * Identity of a credential for the token cache: the type, the token endpoint, the account and a hash of the secret.
 * @param {any} creds - Credentials.
 * @returns {string} Cache key.
 */
function identity(creds) {
	const secret = creds.type === "service_account" ? creds.private_key : creds.refresh_token;
	const account = creds.type === "service_account" ? creds.client_email : creds.client_id;
	return [creds.type, creds.token_uri ?? TOKEN_URI, account, crypto.createHash("sha256").update(secret).digest("hex")].join("|");
}

/**
 * Send a token request and read `{ access_token, expires_in }` from the reply.
 * @param {Function} transport - `fetch`-compatible function.
 * @param {string} url - Token endpoint.
 * @param {{method?: string, headers?: Record<string, string>, body?: string}} init - Request.
 * @param {number} [timeout] - Limit in ms (0 or absent: none).
 * @returns {Promise<{token: string, ttl: number}>} The token and its lifetime in seconds.
 * @throws {TranslatorError} When the endpoint is unreachable, refuses, or answers without a token.
 */
async function fetchToken(transport, url, init, timeout) {
	let res;
	let text;
	try {
		res = await transport(url, { redirect: "error", ...init, ...(timeout > 0 ? { signal: AbortSignal.timeout(timeout) } : {}) });
		text = await res.text();
	} catch (cause) {
		throw failure(`Google token request to ${url} failed: ${cause.message}`, 502);
	}
	let body = null;
	try {
		body = JSON.parse(text);
	} catch {
		// A reply that is not JSON is reported by status below.
	}
	if (!res.ok) {
		const detail = body?.error_description ?? (typeof body?.error === "string" ? body.error : body?.error?.message);
		throw failure(`Google token request refused (HTTP ${res.status})${detail ? `: ${detail}` : ""}`, res.status >= 500 ? 502 : 401);
	}
	if (typeof body?.access_token !== "string" || body.access_token === "") {
		throw failure(`Google token request to ${url} answered without an access_token`, 502);
	}
	// A reply without a lifetime is used for one request only.
	const ttl = Number(body.expires_in);
	return { token: body.access_token, ttl: Number.isFinite(ttl) && ttl > 0 ? ttl : 0 };
}

/**
 * Return a cached token while it is good for another minute, otherwise run `fetcher`. Callers that arrive during a refresh share it, and a
 * failed refresh is not cached.
 * @param {string} key - Cache key.
 * @param {() => Promise<{token: string, ttl: number}>} fetcher - Gets a fresh token.
 * @param {() => number} now - Clock in ms.
 * @returns {Promise<string>} Access token.
 */
function cached(key, fetcher, now) {
	const hit = tokens.get(key);
	if (hit?.pending) return hit.pending;
	if (hit && hit.expires - SKEW > now()) return Promise.resolve(hit.token);
	const pending = fetcher().then(
		({ token, ttl }) => {
			tokens.set(key, { token, expires: now() + ttl * 1000 });
			return token;
		},
		(cause) => {
			tokens.delete(key);
			throw cause;
		}
	);
	tokens.set(key, { pending });
	return pending;
}

/**
 * Get an access token for a credentials object: a service account signs a JWT and exchanges it, an authorized user trades its refresh token.
 * @param {any} creds - Checked credentials.
 * @param {{transport: Function, timeout?: number, now?: () => number}} options - Transport, limit and clock.
 * @returns {Promise<string>} Access token.
 */
function exchange(creds, { transport, timeout, now }) {
	const uri = creds.token_uri ?? TOKEN_URI;
	const form = { "content-type": "application/x-www-form-urlencoded" };
	return cached(
		identity(creds),
		() => {
			const params =
				creds.type === "service_account"
					? { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: assertion(creds, { now: now() }) }
					: {
							grant_type: "refresh_token",
							client_id: creds.client_id,
							client_secret: creds.client_secret,
							refresh_token: creds.refresh_token
						};
			return fetchToken(transport, uri, { method: "POST", headers: form, body: new URLSearchParams(params).toString() }, timeout);
		},
		now
	);
}

/**
 * Get an access token from the GCE metadata server.
 * @param {string | true} server - `true` for the default host, or a base URL.
 * @param {{transport: Function, timeout?: number, now?: () => number}} options - Transport, limit and clock.
 * @returns {Promise<string>} Access token.
 */
function metadata(server, { transport, timeout, now }) {
	const base = (server === true ? METADATA_URL : server).replace(/\/+$/, "");
	const url = `${base}/computeMetadata/v1/instance/service-accounts/default/token`;
	return cached(
		`metadata|${base}`,
		() => fetchToken(transport, url, { method: "GET", headers: { "metadata-flavor": "Google" } }, timeout),
		now
	);
}

/**
 * Find an access token for Vertex AI. Sources, in order: the `getToken` callback (called on every request, it caches for itself), the `accessToken`
 * setting, the upstream's `apiKey` (as a bearer token), the `credentials` setting, `GOOGLE_ACCESS_TOKEN`, `GOOGLE_APPLICATION_CREDENTIALS`, gcloud's
 * application default credentials file, and last the metadata server when `metadataServer` is set. Tokens fetched from Google are cached until a
 * minute before they expire, and concurrent callers share one refresh.
 * @param {any} spec - `{ settings, apiKey, transport, timeout, signal, env, now }`. `settings` is the upstream's `vertex` object; `transport` is the
 * `fetch`-compatible function the token requests go through.
 * @returns {Promise<string>} Access token.
 * @throws {TranslatorError} With code `upstream_auth` when there is no source or Google refuses.
 */
export async function token({ settings = {}, apiKey, transport, timeout, signal, env = process.env, now = Date.now }) {
	if (typeof settings.getToken === "function") {
		let value;
		try {
			value = await settings.getToken({ signal });
		} catch (cause) {
			throw failure(`Google getToken failed: ${cause?.message ?? cause}`);
		}
		const given = typeof value === "string" ? value : value?.token;
		if (typeof given !== "string" || given === "") throw failure("Google getToken returned no access token");
		return given;
	}
	if (typeof settings.accessToken === "string" && settings.accessToken !== "") return settings.accessToken;
	if (typeof apiKey === "string" && apiKey !== "") return apiKey;
	const options = { transport, timeout, now };
	if (settings.credentials !== undefined || !env.GOOGLE_ACCESS_TOKEN) {
		const creds = credentials(settings, env);
		if (creds !== null) return exchange(creds, options);
	}
	if (env.GOOGLE_ACCESS_TOKEN) return env.GOOGLE_ACCESS_TOKEN;
	if (settings.metadataServer) return metadata(settings.metadataServer, options);
	throw failure(
		"No Google credentials for Vertex AI: set vertex.getToken, vertex.accessToken, vertex.credentials, GOOGLE_ACCESS_TOKEN or GOOGLE_APPLICATION_CREDENTIALS, run `gcloud auth application-default login`, or set vertex.metadataServer on Google Cloud"
	);
}

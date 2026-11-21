/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/sigv4.mjs
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
 * @fileoverview AWS Signature Version 4 request signing (`node:crypto` only), as a pure function of the request, the credentials and the time.
 * @module @cldmv/llm-translator/lib/sigv4
 */
import { createHash, createHmac } from "node:crypto";

/**
 * Hex SHA-256 of some text or bytes.
 * @param {string | Uint8Array} data - Input.
 * @returns {string} Lowercase hex digest.
 */
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/**
 * HMAC-SHA-256.
 * @param {string | Buffer} key - Key.
 * @param {string} data - Input.
 * @returns {Buffer} Raw digest.
 */
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

/**
 * Percent-encode every byte except the unreserved characters (`A-Z a-z 0-9 - _ . ~`), as SigV4 requires.
 * @param {string} text - Text.
 * @returns {string} Encoded text.
 */
const encode = (text) => encodeURIComponent(text).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * The `X-Amz-Date` form of a time: `YYYYMMDD'T'HHMMSS'Z'`.
 * @param {Date} date - The time.
 * @returns {string} Basic ISO 8601 UTC time.
 */
export function stamp(date) {
	return date
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}/, "");
}

/**
 * The canonical URI of a URL: its path as sent (already percent-encoded) encoded a second time, segment by segment, which is what every
 * service except S3 signs. A model id with `:` in it is `%3A` on the wire and `%253A` here.
 * @param {string} pathname - Path of the URL as it is sent.
 * @returns {string} Canonical URI.
 */
const canonicalPath = (pathname) => pathname.split("/").map(encode).join("/");

/**
 * The canonical query string: decoded pairs encoded again, sorted by name and then by value.
 * @param {URLSearchParams} params - Query of the URL.
 * @returns {string} Canonical query.
 */
function canonicalQuery(params) {
	const pairs = [...params].map(([name, value]) => [encode(name), encode(value)]);
	pairs.sort((left, right) => (left.join("\0") < right.join("\0") ? -1 : 1));
	return pairs.map(([name, value]) => `${name}=${value}`).join("&");
}

/**
 * Sign a request with Signature Version 4. Every header given is signed, together with `host`, `x-amz-date` and, when there is a session
 * token, `x-amz-security-token`. The body is signed as the hash of the exact text or bytes passed in, so it must be what is sent.
 * @param {object} request - The request.
 * @param {string} [request.method] - HTTP method (default `GET`).
 * @param {string} request.url - Absolute URL as it will be requested.
 * @param {Record<string,string>} [request.headers] - Headers that will be sent (names in any case).
 * @param {string | Uint8Array} [request.body] - Body that will be sent (default empty).
 * @param {string} request.region - AWS region of the credential scope.
 * @param {string} request.service - Service of the credential scope (`bedrock` for Amazon Bedrock).
 * @param {string} request.accessKeyId - Access key id.
 * @param {string} request.secretAccessKey - Secret access key.
 * @param {string} [request.sessionToken] - Session token of temporary credentials.
 * @param {Date} [request.date] - Signing time (default now).
 * @returns {{headers: Record<string,string>, authorization: string, signature: string, signedHeaders: string, canonicalRequest: string, stringToSign: string}} The headers to send (the ones given plus `x-amz-date`, `x-amz-security-token` and `authorization`; `host` is left to the transport) and the intermediate values, which tests compare with published ones.
 */
export function sign({
	method = "GET",
	url,
	headers = {},
	body = "",
	region,
	service,
	accessKeyId,
	secretAccessKey,
	sessionToken,
	date = new Date()
}) {
	const target = new URL(url);
	const time = stamp(date);
	const day = time.slice(0, 8);
	const extra = { "x-amz-date": time, ...(sessionToken ? { "x-amz-security-token": sessionToken } : {}) };
	/** @type {Record<string,string>} */
	const seen = {};
	for (const [name, value] of Object.entries({ ...headers, ...extra }))
		seen[name.toLowerCase()] = String(value).trim().replace(/\s+/g, " ");
	seen.host = target.host;
	const names = Object.keys(seen).sort();
	const signedHeaders = names.join(";");
	const canonicalRequest = [
		method.toUpperCase(),
		canonicalPath(target.pathname),
		canonicalQuery(target.searchParams),
		names.map((name) => `${name}:${seen[name]}\n`).join(""),
		signedHeaders,
		sha256(body)
	].join("\n");
	const scope = `${day}/${region}/${service}/aws4_request`;
	const stringToSign = `AWS4-HMAC-SHA256\n${time}\n${scope}\n${sha256(canonicalRequest)}`;
	const key = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, day), region), service), "aws4_request");
	const signature = createHmac("sha256", key).update(stringToSign).digest("hex");
	const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
	return { headers: { ...headers, ...extra, authorization }, authorization, signature, signedHeaders, canonicalRequest, stringToSign };
}

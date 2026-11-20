/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/helpers/google.mjs
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
 * @fileoverview Test helpers: a local stand-in for Google (the OAuth token endpoint, the metadata server and Vertex AI) and test credentials.
 * It listens on 127.0.0.1 only and never touches the internet.
 */
import crypto from "node:crypto";
import http from "node:http";

/** An RSA key pair made once per test run; the private key is a PKCS#8 PEM. */
export const keys = crypto.generateKeyPairSync("rsa", {
	modulusLength: 2048,
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
	publicKeyEncoding: { type: "spki", format: "pem" }
});

/**
 * A service-account key file's content for the test key.
 * @param {string} tokenUri - The token endpoint (a local server).
 * @param {object} [extra] - Fields to add or replace.
 * @returns {object} Service-account credentials.
 */
export function serviceAccount(tokenUri, extra = {}) {
	return {
		type: "service_account",
		project_id: "sa-project",
		private_key_id: "key-1",
		private_key: keys.privateKey,
		client_email: "bot@sa-project.iam.gserviceaccount.com",
		client_id: "1234",
		token_uri: tokenUri,
		...extra
	};
}

/**
 * A `gcloud auth application-default login` file's content.
 * @param {string} [tokenUri] - Token endpoint to add (gcloud files have none).
 * @param {object} [extra] - Fields to add or replace.
 * @returns {object} Authorized-user credentials.
 */
export function authorizedUser(tokenUri, extra = {}) {
	return {
		type: "authorized_user",
		client_id: "client-1",
		client_secret: "secret-1",
		refresh_token: "refresh-1",
		quota_project_id: "user-project",
		...(tokenUri === undefined ? {} : { token_uri: tokenUri }),
		...extra
	};
}

/**
 * Parse a form-encoded body.
 * @param {string} text - Body.
 * @returns {Record<string,string>} Fields.
 */
function form(text) {
	return Object.fromEntries(new URLSearchParams(text));
}

/**
 * Start the fake Google. `POST /token` is the OAuth endpoint (default reply: a fresh `ya29.<n>` token valid for an hour), `GET
 * /computeMetadata/v1/instance/service-accounts/default/token` the metadata server, and any other path goes to `options.vertex(req, body, res, record)`
 * (default: 404 in Google's error envelope; the handler writes the reply itself, or returns `false` to leave it to the default). `options.token(record, count)`
 * and `options.metadata(record, count)` return `{ status, body }` (or a promise of it) to replace the defaults.
 * @param {object} [options] - `{ token, metadata, vertex }`.
 * @returns {Promise<{url: string, tokenUrl: string, requests: object[], tokens: object[], close: () => Promise<void>}>} Server handle: `tokens` holds the token requests.
 */
export async function fakeGoogle(options = {}) {
	const requests = [];
	const tokens = [];
	let issued = 0;
	const server = http.createServer(async (req, res) => {
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		const text = Buffer.concat(chunks).toString("utf8");
		let body = text;
		try {
			body = JSON.parse(text);
		} catch {
			// A form body or no body stays text.
		}
		const record = { method: req.method, url: req.url, headers: req.headers, body, text };
		requests.push(record);
		const reply = (status, payload, headers = {}) => {
			res.writeHead(status, { "content-type": "application/json", ...headers });
			res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
		};
		const sync = req.method === "POST" && req.url === "/token";
		const meta = req.method === "GET" && req.url === "/computeMetadata/v1/instance/service-accounts/default/token";
		if (sync || meta) {
			record.form = sync ? form(text) : undefined;
			tokens.push(record);
			issued++;
			const custom = await (sync ? options.token : options.metadata)?.(record, issued);
			if (custom) return reply(custom.status ?? 200, custom.body ?? {});
			return reply(200, { access_token: `ya29.${issued}`, expires_in: 3600, token_type: "Bearer" });
		}
		if (options.vertex && (await options.vertex(req, body, res, record)) !== false) return undefined;
		return reply(404, { error: { code: 404, message: "Publisher Model not found.", status: "NOT_FOUND" } });
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const url = `http://127.0.0.1:${server.address().port}`;
	return {
		url,
		tokenUrl: `${url}/token`,
		requests,
		tokens,
		close: () =>
			new Promise((resolve) => {
				server.closeAllConnections();
				server.close(resolve);
			})
	};
}

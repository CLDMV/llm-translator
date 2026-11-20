/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/helpers/bedrock.mjs
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
 * @fileoverview A local stand-in for the Amazon Bedrock runtime: a `node:http` server that records every call, checks that its SigV4 signature is the one the credentials produce for exactly what arrived (method, path as sent, signed headers, body), and answers from a handler. Never touches the network.
 */
import http from "node:http";
import { sign } from "../../src/lib/sigv4.mjs";

export const keys = { accessKeyId: "AKIDTESTKEY", secretAccessKey: "test/secret+key" };

/**
 * Recompute the signature of a received call.
 * @param {http.IncomingMessage} req - The request.
 * @param {string} text - Its body.
 * @param {string} region - Region the signature should be scoped to.
 * @returns {"signature ok" | "signature wrong" | string} `signature ok` or `signature wrong` for a SigV4 call; the Authorization header itself for any other (a bearer token), or `none`.
 */
function verify(req, text, region) {
	const auth = req.headers.authorization;
	if (!auth?.startsWith("AWS4-HMAC-SHA256 ")) return auth ?? "none";
	const signed = /SignedHeaders=([^,]+)/.exec(auth)[1].split(";");
	const headers = {};
	for (const name of signed) if (!["host", "x-amz-date", "x-amz-security-token"].includes(name)) headers[name] = req.headers[name];
	const stamp = String(req.headers["x-amz-date"]);
	const out = sign({
		...keys,
		method: req.method,
		url: `http://${req.headers.host}${req.url}`,
		headers,
		body: text,
		region,
		service: "bedrock",
		sessionToken: req.headers["x-amz-security-token"],
		date: new Date(
			`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`
		)
	});
	return out.authorization === auth ? "signature ok" : "signature wrong";
}

/**
 * Start the stand-in.
 * @param {string} [region] - Region the calls are expected to be signed for.
 * @returns {Promise<{url: string, seen: any[], use: (handler: Function) => void, close: () => Promise<void>}>} `seen` holds `{ method, url, headers, text, body, auth }` per call; `use(handler)` sets `handler(call, res)` for the next calls and clears `seen`.
 */
export async function bedrock(region = "us-east-1") {
	const state = { handler: (_call, res) => res.writeHead(500).end() };
	const seen = [];
	const server = http.createServer(async (req, res) => {
		const parts = [];
		for await (const part of req) parts.push(part);
		const text = Buffer.concat(parts).toString("utf8");
		const call = {
			method: req.method,
			url: req.url,
			headers: req.headers,
			text,
			body: text === "" ? undefined : JSON.parse(text),
			auth: verify(req, text, region)
		};
		seen.push(call);
		await state.handler(call, res);
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		url: `http://127.0.0.1:${server.address().port}`,
		seen,
		use(handler) {
			seen.length = 0;
			state.handler = handler;
		},
		close: () =>
			new Promise((resolve) => {
				server.closeAllConnections();
				server.close(resolve);
			})
	};
}

/**
 * Answer with a JSON body.
 * @param {http.ServerResponse} res - Response.
 * @param {number} status - Status.
 * @param {any} body - Body.
 * @returns {void}
 */
export function reply(res, status, body) {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
}

/**
 * Answer with event stream frames, written in pieces of a size so frames arrive split.
 * @param {http.ServerResponse} res - Response.
 * @param {Buffer[]} list - Frames.
 * @param {number} [size] - Piece size in bytes.
 * @returns {Promise<void>} Resolves when the reply is written.
 */
export async function stream(res, list, size = 13) {
	res.writeHead(200, { "content-type": "application/vnd.amazon.eventstream" });
	const bytes = Buffer.concat(list);
	for (let at = 0; at < bytes.length; at += size) {
		res.write(bytes.subarray(at, at + size));
		await new Promise((resolve) => setImmediate(resolve));
	}
	res.end();
}

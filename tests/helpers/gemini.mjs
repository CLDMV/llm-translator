/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/helpers/gemini.mjs
 *	@Date: 2026-11-21T10:00:00-08:00 (1795284000)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-21T10:00:00-08:00 (1795284000)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview A local stand-in for the Gemini API: a `node:http` server that records every call and answers from a handler. Never touches the network.
 */
import http from "node:http";

/**
 * Start the stand-in.
 * @returns {Promise<{url: string, seen: any[], use: (handler: Function) => void, close: () => Promise<void>}>} `seen` holds `{ method, url, headers, body }` per call; `use(handler)` sets `handler(call, res)` for the next calls and clears `seen`.
 */
export async function gemini() {
	const state = { handler: (_call, res) => res.writeHead(500).end() };
	const seen = [];
	const server = http.createServer(async (req, res) => {
		const parts = [];
		for await (const part of req) parts.push(part);
		const text = Buffer.concat(parts).toString("utf8");
		const call = { method: req.method, url: req.url, headers: req.headers, body: text === "" ? undefined : JSON.parse(text) };
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
 * A `generateContent` reply with one candidate.
 * @param {any[]} parts - The candidate's parts.
 * @param {any} [extra] - Fields of the candidate (`finishReason` defaults to `STOP`).
 * @param {any} [usage] - `usageMetadata`; none when `null`.
 * @returns {any} Reply.
 */
export function content(parts, extra = {}, usage = { promptTokenCount: 12, candidatesTokenCount: 5, totalTokenCount: 17 }) {
	return {
		candidates: [{ index: 0, content: { role: "model", parts }, finishReason: "STOP", ...extra }],
		...(usage === null ? {} : { usageMetadata: usage }),
		modelVersion: "gemini-2.5-flash"
	};
}

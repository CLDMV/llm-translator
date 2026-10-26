/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tools/e2e/log-proxy.mjs
 *	@Date: 2026-10-26T06:00:29-07:00 (1793019629)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-26T15:39:13-07:00 (1793054353)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview A logging reverse proxy for one upstream: every request and response body is appended to
 * `<E2E_DIR>/logs/<LOG>.jsonl`, which shows exactly what the translator sent to the model and what came back.
 *
 * Environment: `LISTEN` (default 8101), `TARGET` (upstream port, default 8100), `LOG` (log name, default `upstream`), `E2E_DIR`.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { logs } from "./paths.mjs";

fs.mkdirSync(logs, { recursive: true });
const file = path.join(logs, `${process.env.LOG ?? "upstream"}.jsonl`);
let count = 0;

/**
 * Append one JSON line to the log.
 * @param {object} entry - Log entry.
 * @returns {void}
 */
const record = (entry) => fs.appendFileSync(file, `${JSON.stringify({ t: new Date().toISOString(), ...entry })}\n`);

http
	.createServer((req, res) => {
		const id = ++count;
		const parts = [];
		req.on("data", (part) => parts.push(part));
		req.on("end", () => {
			const body = Buffer.concat(parts);
			record({ id, dir: "req", method: req.method, url: req.url, body: body.toString() });
			const upstream = http.request(
				{ host: "127.0.0.1", port: Number(process.env.TARGET ?? 8100), path: req.url, method: req.method, headers: req.headers },
				(answer) => {
					res.writeHead(answer.statusCode, answer.headers);
					const reply = [];
					answer.on("data", (part) => {
						reply.push(part);
						res.write(part);
					});
					answer.on("end", () => {
						res.end();
						record({ id, dir: "res", status: answer.statusCode, body: Buffer.concat(reply).toString() });
					});
				}
			);
			upstream.on("error", (error) => {
				res.writeHead(502);
				res.end(String(error));
			});
			upstream.end(body);
			res.on("close", () => upstream.destroy());
		});
	})
	.listen(Number(process.env.LISTEN ?? 8101), "127.0.0.1");

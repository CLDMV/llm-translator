/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/helpers/fake-web.mjs
 *	@Date: 2026-11-25T01:00:00-08:00 (1795596800)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-25T01:00:00-08:00 (1795596800)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview A fake web for the fetcher: replacement `node:http`/`node:https` modules answered by a handler, and a host name lookup that
 * resolves every name to a public address, so tests never touch the network.
 */
import { EventEmitter } from "node:events";
import net from "node:net";
import { Readable } from "node:stream";

/** A public address every fake host name resolves to. */
export const PUBLIC = "93.184.216.34";

/**
 * Fake protocol modules and lookup for `fetchUrl`'s `deps`.
 * @param {(url: URL, n: number) => {status?: number, headers?: Record<string, string>, body?: Buffer | string}} handler - Answers each request.
 * @param {string[]} [addresses] - What every host name resolves to.
 * @returns {{deps: {modules: any, lookup: Function}, calls: {url: string, headers: any}[]}} The deps and the recorded requests.
 */
export function fakeWeb(handler, addresses = [PUBLIC]) {
	const calls = [];
	const client = {
		request(url, options, callback) {
			const request = new EventEmitter();
			request.destroy = (reason) => {
				request.emit("error", reason);
				request.emit("close");
			};
			request.end = () => {
				calls.push({ url: url.href, headers: options.headers });
				const reply = handler(url, calls.length);
				const res = Readable.from([Buffer.from(reply.body ?? "")]);
				res.statusCode = reply.status ?? 200;
				res.headers = reply.headers ?? { "content-type": "text/html" };
				callback(res);
				request.emit("close");
			};
			return request;
		}
	};
	const lookup = async () => addresses.map((address) => ({ address, family: net.isIP(address) }));
	return { deps: { modules: { http: client, https: client }, lookup }, calls };
}

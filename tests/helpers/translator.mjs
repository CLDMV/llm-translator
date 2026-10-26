/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /tests/helpers/translator.mjs
 *	@Date: 2026-10-25T12:18:21-07:00 (1792955901)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:04-07:00 (1792958344)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Test helpers: translator factory with the slothlet `import` hook (so leaves attribute coverage).
 */
import { createTranslator } from "../../src/index.mjs";

const open = [];

/**
 * Create a translator for a test. `slothlet.import` routes leaf loads through vitest; `silent` unless overridden.
 * @param {object} config - Translator config.
 * @returns {Promise<object>} Translator api (shut down by `closeAll`).
 */
export async function make(config) {
	const api = await createTranslator({ silent: true, ...config, slothlet: { import: (url) => import(url), ...config.slothlet } });
	open.push(api);
	return api;
}

/**
 * Shut down every translator created with `make` (and stop their servers).
 * @returns {Promise<void>} Resolves when all are closed.
 */
export async function closeAll() {
	while (open.length > 0) {
		const api = open.pop();
		await api.server.stop();
		await api.slothlet.shutdown();
	}
}

/**
 * Build a fetch-compatible fake transport from a handler returning `{ status, body, headers }` or a Response.
 * @param {(url: string, init: object) => any} handler - Request handler; also receives calls in `calls`.
 * @returns {Function & {calls: {url: string, init: object}[]}} Transport.
 */
export function fakeTransport(handler) {
	const calls = [];
	const transport = async (url, init = {}) => {
		calls.push({ url, init });
		const result = await handler(url, init);
		if (result instanceof Response) return result;
		const body = typeof result.body === "string" ? result.body : JSON.stringify(result.body ?? {});
		return new Response(body, { status: result.status ?? 200, headers: result.headers ?? { "content-type": "application/json" } });
	};
	transport.calls = calls;
	return transport;
}

/**
 * Collect an async iterable into an array.
 * @param {AsyncIterable<any>} iterable - Source.
 * @returns {Promise<any[]>} Items.
 */
export async function collect(iterable) {
	const out = [];
	for await (const item of iterable) out.push(item);
	return out;
}

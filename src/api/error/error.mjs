/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/error/error.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:00-07:00 (1792958340)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Root api: render an upstream error in the client protocol.
 * @module @cldmv/llm-translator/error
 */
import { context, self } from "../../lib/runtime.mjs";
import { capture } from "../../lib/capture.mjs";
import * as upstream from "../../lib/upstream-error.mjs";

const KEEP = ["retry-after", "x-should-retry"];

/**
 * Convert an upstream error reply into `{ status, headers, body }` in the client protocol. Context-window overflows
 * become Anthropic's "prompt is too long: N tokens > MAX maximum" (which triggers Claude Code's compaction); status codes
 * map 1:1; `retry-after` is kept.
 * @param {number} status - Upstream HTTP status.
 * @param {*} upstreamBody - Parsed upstream error body (object or text).
 * @param {Record<string,string>} [headers] - Lowercase upstream response headers.
 * @param {any} [state] - The `state` returned by `request` (selects the driver normalizer and native handling).
 * @returns {Promise<{status: number, headers: Record<string,string>, body: any}>} Client-shaped error reply.
 */
export default async function error(status, upstreamBody, headers = {}, state) {
	const c = capture(self, context, state?.front);
	const endpoint = state ? c.endpoint(state.upstream) : undefined;
	const driver = endpoint ? c.driver(endpoint) : undefined;
	let body = upstreamBody;
	if (driver?.error) body = await driver.error(status, body, { endpoint, state });
	const info = upstream.parse(body, status);
	if (state?.unserved === true && status === 404) {
		info.message += ` The model "${state.model}" is not served by any configured upstream; map it to a served model with "aliases".`;
	}
	const rendered = upstream.render(c.front, status, info, { native: state?.native === true });
	const out = { "content-type": "application/json" };
	for (const name of KEEP) {
		if (headers[name] !== undefined) out[name] = headers[name];
	}
	return { status: rendered.status, headers: out, body: rendered.body };
}

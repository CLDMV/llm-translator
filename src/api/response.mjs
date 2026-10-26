/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/response.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:01-07:00 (1792958341)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Root api: convert a non-streaming upstream reply to the client protocol.
 * @module @cldmv/llm-translator/response
 */
import { context, self } from "../lib/runtime.mjs";
import { capture } from "../lib/capture.mjs";

/**
 * Convert an upstream response body to the client protocol (a no-op apart from driver normalization and restoring the
 * client's model name when front and upstream speak the same protocol).
 * @param {any} upstreamBody - Parsed upstream JSON body.
 * @param {any} state - The `state` returned by `request`.
 * @returns {Promise<any>} Response body in the client protocol.
 */
export async function response(upstreamBody, state) {
	const c = capture(self, context, state.front);
	const endpoint = c.endpoint(state.upstream);
	const driver = c.driver(endpoint);
	let body = upstreamBody;
	if (driver.response) body = await driver.response(body, { endpoint, settings: c.settings(endpoint), state });
	if (state.native) return body.model === undefined ? body : { ...body, model: state.model ?? body.model };
	return c.converters(endpoint).response(body, state.convert, c.settings(endpoint));
}

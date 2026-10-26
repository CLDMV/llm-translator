/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/token/count.mjs
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
 * @fileoverview Root api: count the prompt tokens of a request.
 * @module @cldmv/llm-translator/token
 */
import { context, self } from "../../lib/runtime.mjs";
import { capture } from "../../lib/capture.mjs";
import { estimate } from "../../lib/estimate.mjs";

/**
 * Count input tokens for a client request. Uses the upstream's own tokenizer when its driver has one (vLLM `/tokenize`,
 * Anthropic `count_tokens`); otherwise a documented estimate of one token per four characters.
 * @param {any} body - Client request body (per `front`).
 * @param {any} [options] - `{ signal, front }`.
 * @returns {Promise<{input_tokens: number}>} Anthropic `count_tokens` shaped result.
 */
export async function count(body, options = {}) {
	const c = capture(self, context, options.front);
	const { request } = self;
	const prepared = await request(body, { front: options.front });
	const endpoint = c.endpoint(prepared.upstream);
	const driver = c.driver(endpoint);
	const exact = driver.count
		? await driver.count({
				endpoint,
				request: prepared.body,
				transport: c.state.transport,
				signal: options.signal,
				timeout: c.config.detectTimeout
			})
		: null;
	return { input_tokens: exact ?? estimate(prepared.body) };
}

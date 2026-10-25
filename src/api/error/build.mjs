/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/error/build.mjs
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
 * @fileoverview Root api: build an error reply that originates in the translator itself (auth, routing, bad requests).
 * @module @cldmv/llm-translator/error
 */
import { context } from "../../lib/runtime.mjs";
import { anthropicToOpenAIType } from "../../lib/errors.mjs";
import * as upstream from "../../lib/upstream-error.mjs";

/**
 * Build `{ status, headers, body }` in the client protocol.
 * @param {number} status - HTTP status.
 * @param {string} message - Error message.
 * @param {any} [options] - `{ type, code, param, front }` overrides; `type` is an Anthropic error type (mapped for the OpenAI front) and `front` defaults to the configured front.
 * @returns {{status: number, headers: Record<string,string>, body: any}} Client-shaped error reply.
 */
export function build(status, message, options = {}) {
	const front = options.front ?? context.config.front;
	const rendered = upstream.render(
		front,
		status,
		{
			message,
			type: front === "openai" && options.type ? anthropicToOpenAIType(options.type) : options.type,
			code: options.code,
			param: options.param
		},
		{ native: true }
	);
	return { status, headers: { "content-type": "application/json" }, body: rendered.body };
}

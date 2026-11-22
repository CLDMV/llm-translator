/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/cohere/request.mjs
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
 * @fileoverview Cohere driver: request normalizer (a Chat Completions body for the Compatibility API, a `/v2/chat` body for the native protocol).
 * @module @cldmv/llm-translator/driver/cohere
 */
import { noEmptyTools } from "../../../lib/normalize.mjs";

/** Fields the Compatibility API does not implement (https://docs.cohere.com/docs/compatibility-api). */
const UNSUPPORTED = [
	"store",
	"metadata",
	"logit_bias",
	"top_logprobs",
	"n",
	"modalities",
	"prediction",
	"audio",
	"service_tier",
	"parallel_tool_calls",
	"stream_options"
];

/**
 * For the Compatibility API: remove the fields it does not implement (each recorded in `state.dropped`, except `stream_options` which only
 * carries a usage preference) and map `reasoning_effort` to the two values it takes (`none` stays, every other level is `high`). The native
 * protocol's body is built by the converter and goes through as it is.
 * @param {any} body - Chat Completions or Cohere request body.
 * @param {any} [context] - `{ state, protocol }` (`protocol` is the one the request goes over).
 * @returns {any} Normalized body.
 */
export function request(body, context) {
	if (context?.protocol === "cohere.chat") return body;
	const out = { ...noEmptyTools(body) };
	const dropped = context?.state?.dropped;
	for (const field of UNSUPPORTED) {
		if (out[field] === undefined) continue;
		delete out[field];
		if (field !== "stream_options" && Array.isArray(dropped) && !dropped.includes(field)) dropped.push(field);
	}
	if (typeof out.reasoning_effort === "string" && out.reasoning_effort !== "none") out.reasoning_effort = "high";
	return out;
}

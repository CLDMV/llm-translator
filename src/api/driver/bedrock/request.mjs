/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/bedrock/request.mjs
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
 * @fileoverview Amazon Bedrock driver: request normalizer (an Anthropic Messages body for InvokeModel, a Converse body for Converse).
 * @module @cldmv/llm-translator/driver/bedrock
 */

/** Fields that belong to the Anthropic API and not to Bedrock (which rejects keys it does not know), plus the two the URL carries: `model` and `stream`. */
const NOT_BEDROCK = ["model", "stream", "metadata", "service_tier", "container", "mcp_servers"];

/** The `anthropic_version` Bedrock requires in an InvokeModel body. */
const VERSION = "bedrock-2023-05-31";

/**
 * Shape the body for the runtime. The model id and the choice of streaming are in the URL, so neither is in the body. An InvokeModel body
 * also gets `anthropic_version: "bedrock-2023-05-31"` and loses the Anthropic API fields Bedrock does not have (`metadata`, `service_tier`,
 * `container`, `mcp_servers`); a Converse body needs nothing more.
 * @param {any} body - Anthropic Messages or Converse request body.
 * @param {any} [context] - `{ protocol }`, the protocol the request goes over.
 * @returns {any} Normalized body.
 */
export function request(body, context) {
	const out = { ...body };
	for (const field of NOT_BEDROCK) delete out[field];
	return context?.protocol === "anthropic.messages" ? { anthropic_version: VERSION, ...out } : out;
}

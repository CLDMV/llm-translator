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
 * The beta names of an `anthropic-beta` header value (a comma-separated list, possibly sent more than once).
 * @param {string | string[] | undefined} value - Header value.
 * @returns {string[]} Names.
 */
function betas(value) {
	return (Array.isArray(value) ? value : [value])
		.flatMap((entry) => String(entry ?? "").split(","))
		.map((name) => name.trim())
		.filter((name) => name !== "");
}

/**
 * Shape the body for the runtime. The model id and the choice of streaming are in the URL, so neither is in the body. An InvokeModel body
 * also gets `anthropic_version: "bedrock-2023-05-31"` and loses the Anthropic API fields Bedrock does not have (`metadata`, `service_tier`,
 * `container`, `mcp_servers`); a Converse body needs nothing more. A client's `anthropic-beta` header has no place on Bedrock's HTTP API, which
 * takes the same list as `anthropic_beta` in the InvokeModel body: the header's names are added to the body's own list (without repeats).
 * @param {any} body - Anthropic Messages or Converse request body.
 * @param {any} [context] - `{ protocol, clientHeaders }`, the protocol the request goes over and the headers the client sent (only for a body that was forwarded as it is).
 * @returns {any} Normalized body.
 */
export function request(body, context) {
	const out = { ...body };
	for (const field of NOT_BEDROCK) delete out[field];
	if (context?.protocol !== "anthropic.messages") return out;
	const beta = [...new Set([...betas(out.anthropic_beta), ...betas(context.clientHeaders?.["anthropic-beta"])])];
	delete out.anthropic_beta;
	return { anthropic_version: VERSION, ...out, ...(beta.length > 0 ? { anthropic_beta: beta } : {}) };
}

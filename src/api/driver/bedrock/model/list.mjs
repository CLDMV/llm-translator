/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/bedrock/model/list.mjs
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
 * @fileoverview Amazon Bedrock driver: model listing.
 * @module @cldmv/llm-translator/driver/bedrock
 */
import * as http from "../../../../lib/http.mjs";
import { authenticate } from "../../../../lib/bedrock.mjs";

/**
 * The control plane URL of `GET /foundation-models`: the runtime host with `bedrock-runtime` replaced by `bedrock` (the model list is not
 * served by the runtime host), or, for a base URL that is not a Bedrock runtime host (a proxy that serves both), the base URL itself.
 * @param {string} base - The upstream's base URL.
 * @returns {string} URL.
 */
function listUrl(base) {
	const url = new URL(base);
	url.hostname = url.hostname.replace(/(^|\.)bedrock-runtime/, "$1bedrock");
	return `${url.origin}${url.pathname.replace(/\/$/, "")}/foundation-models`;
}

/**
 * List the foundation models Bedrock reports for the region (`GET /foundation-models` on the control plane, signed like every call). Models that
 * do not produce text are left out. Inference profiles (`us.anthropic.claude-...`, which many models need instead of the bare id) are not
 * listed; name them in the upstream's `models`.
 * @param {any} context - `{ endpoint, transport, signal, timeout }`.
 * @returns {Promise<{id: string, owned_by: string}[] | null>} Models, or null when unreachable, not authenticated or not a model list.
 */
export async function list({ endpoint, transport, signal, timeout }) {
	let url;
	let headers;
	try {
		url = listUrl(endpoint.url);
		headers = authenticate(endpoint, { method: "GET", url, headers: { accept: "application/json" }, body: "" });
	} catch {
		// A base URL that does not parse, or an upstream with no credential or region: there is nothing to ask.
		return null;
	}
	const result = await http.json(transport, url, { method: "GET", headers, signal, timeout });
	if (!result.ok || !Array.isArray(result.body?.modelSummaries)) return null;
	return result.body.modelSummaries
		.filter((entry) => typeof entry?.modelId === "string" && (entry.outputModalities ?? ["TEXT"]).includes("TEXT"))
		.map((entry) => ({ id: entry.modelId, owned_by: entry.providerName ?? "bedrock" }));
}

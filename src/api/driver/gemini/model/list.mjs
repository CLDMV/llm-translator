/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/gemini/model/list.mjs
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
 * @fileoverview Gemini driver: model listing for an upstream on the native API.
 * @module @cldmv/llm-translator/driver/gemini
 */
import * as http from "../../../../lib/http.mjs";
import { GEMINI } from "../../../../lib/protocol.mjs";
import { route } from "../../../../lib/gemini.mjs";

/** Most pages followed, so a server that keeps answering with a next page token cannot hold the listing forever. */
const MAX_PAGES = 20;

/**
 * List the models of an upstream on the native API (`GET /v1beta/models`, every page, with the `models/` prefix taken off the names). Only models
 * that can `generateContent` are listed. An upstream on the OpenAI-compatible endpoint is not asked here (null: its configured models are shown).
 * @param {any} context - `{ endpoint, transport, signal, timeout }`.
 * @returns {Promise<{id: string, owned_by: string, max_model_len?: number}[] | null>} Models, or null when the upstream is not on the native API, not reachable or did not answer with a model list.
 */
export async function list({ endpoint, transport, signal, timeout }) {
	if (endpoint.api !== GEMINI) return null;
	const out = [];
	let token;
	for (let page = 0; page < MAX_PAGES; page++) {
		const query = token === undefined ? "?pageSize=1000" : `?pageSize=1000&pageToken=${encodeURIComponent(token)}`;
		const result = await http.json(transport, http.join(endpoint.url, `${route(endpoint, "models")}${query}`), {
			method: "GET",
			headers: { ...endpoint.headers, ...(endpoint.apiKey ? { "x-goog-api-key": endpoint.apiKey } : {}) },
			signal,
			timeout
		});
		if (!result.ok || !Array.isArray(result.body?.models)) return null;
		for (const entry of result.body.models) {
			if (typeof entry?.name !== "string" || !(entry.supportedGenerationMethods ?? []).includes("generateContent")) continue;
			out.push({
				id: entry.name.replace(/^models\//, ""),
				owned_by: "google",
				...(Number.isFinite(entry.inputTokenLimit) ? { max_model_len: entry.inputTokenLimit } : {})
			});
		}
		token = result.body.nextPageToken;
		if (typeof token !== "string" || token === "") break;
	}
	return out;
}

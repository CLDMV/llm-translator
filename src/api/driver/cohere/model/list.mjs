/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/cohere/model/list.mjs
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
 * @fileoverview Cohere driver: model listing.
 * @module @cldmv/llm-translator/driver/cohere
 */
import * as http from "../../../../lib/http.mjs";
import { rootOf } from "../../../../lib/cohere.mjs";

/** Models per page (the API's largest). */
const PAGE = 1000;

/** The most pages read, so a server that keeps returning a token cannot loop forever. */
const PAGES = 20;

/**
 * List the models that serve chat (`GET /v1/models?endpoint=chat`), following `next_page_token`. Cohere's own shape (`models[].name`,
 * `context_length`) is mapped to the translator's list entries.
 * @param {any} context - `{ endpoint, transport, signal, timeout }`.
 * @returns {Promise<{id: string, owned_by: string, max_model_len?: number}[] | null>} Models, or null when unreachable, not authenticated or not a model list.
 */
export async function list({ endpoint, transport, signal, timeout }) {
	const base = http.join(rootOf(endpoint.url), "/v1/models");
	const headers = http.headers(endpoint, "bearer", { accept: "application/json" });
	const models = [];
	let token;
	for (let page = 0; page < PAGES; page++) {
		const query = new URLSearchParams({ endpoint: "chat", page_size: String(PAGE), ...(token === undefined ? {} : { page_token: token }) });
		const result = await http.json(transport, `${base}?${query}`, { method: "GET", headers, signal, timeout });
		if (!result.ok || !Array.isArray(result.body?.models)) return page === 0 ? null : models;
		for (const entry of result.body.models) {
			if (typeof entry?.name !== "string") continue;
			models.push({
				id: entry.name,
				owned_by: "cohere",
				...(Number.isFinite(entry.context_length) ? { max_model_len: entry.context_length } : {})
			});
		}
		token = result.body.next_page_token;
		if (typeof token !== "string" || token === "") break;
	}
	return models;
}

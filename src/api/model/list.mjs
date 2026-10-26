/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/model/list.mjs
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
 * @fileoverview Root api: client-shaped model list across all upstreams.
 * @module @cldmv/llm-translator/model
 */
import { context, self } from "../../lib/runtime.mjs";
import { capture } from "../../lib/capture.mjs";

/**
 * List the models the upstreams serve (live when the driver can, else detection/config data), plus the configured aliases,
 * in the client protocol's list shape (Anthropic `{data:[{type:"model",...}]}` or OpenAI `{object:"list",data:[...]}`).
 * @param {any} [options] - `{ signal, front }`.
 * @returns {Promise<any>} Model list.
 */
export async function list(options = {}) {
	const c = capture(self, context, options.front);
	const found = new Map();
	await Promise.all(
		c.state.endpoints.map(async (endpoint) => {
			const driver = c.driver(endpoint);
			const live = driver.list
				? await driver.list({ endpoint, transport: c.state.transport, signal: options.signal, timeout: c.config.detectTimeout })
				: null;
			const entries = live ?? (endpoint.models ?? endpoint.facts?.models ?? []).map((id) => ({ id }));
			for (const entry of entries) found.set(entry.id, { ...entry, upstream: endpoint.name });
		})
	);
	for (const alias of Object.keys(c.config.aliases)) {
		const target = found.get(c.config.aliases[alias]);
		found.set(alias, { ...target, id: alias });
	}
	const models = [...found.values()];
	if (c.front === "openai") {
		return {
			object: "list",
			data: models.map((entry) => ({
				id: entry.id,
				object: "model",
				created: entry.created ?? 0,
				owned_by: entry.owned_by ?? entry.upstream ?? "llm-translator",
				...(entry.max_model_len === undefined ? {} : { max_model_len: entry.max_model_len })
			}))
		};
	}
	const data = models.map((entry) => ({
		type: "model",
		id: entry.id,
		display_name: entry.id,
		created_at: new Date((entry.created ?? 0) * 1000).toISOString(),
		...(entry.max_model_len === undefined ? {} : { max_input_tokens: entry.max_model_len })
	}));
	return { data, has_more: false, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null };
}

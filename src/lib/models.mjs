/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/models.mjs
 *	@Date: 2026-10-25T12:29:36-07:00 (1792956576)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-25T12:59:02-07:00 (1792958342)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Fetches an upstream `/v1/models` listing.
 * @module @cldmv/llm-translator/lib/models
 */
import * as http from "./http.mjs";

/**
 * The usable entries of a `/v1/models` reply.
 * @param {{ok: boolean, body: any}} result - Outcome of the request.
 * @returns {{id: string, created?: number, owned_by?: string, max_model_len?: number}[] | null} Models, or null when the reply is not a model list.
 */
export function modelsOf(result) {
	if (!result.ok || !Array.isArray(result.body?.data)) return null;
	return result.body.data.filter((entry) => entry && typeof entry.id === "string");
}

/**
 * The LoRA adapters in a `/v1/models` list: vLLM lists each one as a model whose `parent` is the base model it adapts (`--lora-modules`, or
 * `/v1/load_lora_adapter` when `VLLM_ALLOW_RUNTIME_LORA_UPDATING` is on); base models have no `parent`.
 * @param {any[]} models - Entries of the model list.
 * @returns {{id: string, parent: string}[]} The adapters.
 */
export function adaptersOf(models) {
	return models
		.filter((entry) => typeof entry?.parent === "string" && entry.parent !== "")
		.map((entry) => ({ id: entry.id, parent: entry.parent }));
}

/**
 * The model ids an endpoint serves that are not LoRA adapters (all of them for a driver that detects none).
 * @param {any} endpoint - Runtime endpoint.
 * @returns {string[]} Configured or detected model ids, adapters left out.
 */
export function baseModels(endpoint) {
	const adapters = new Set((endpoint.facts?.adapters ?? []).map((entry) => entry.id));
	return (endpoint.models ?? endpoint.facts?.models ?? []).filter((id) => !adapters.has(id));
}

/**
 * The entries a model list shows for an endpoint when the server was not asked: its configured or detected ids, an adapter with its `parent`.
 * @param {any} endpoint - Runtime endpoint.
 * @returns {{id: string, parent?: string}[]} Entries.
 */
export function knownModels(endpoint) {
	const parents = new Map((endpoint.facts?.adapters ?? []).map((entry) => [entry.id, entry.parent]));
	return (endpoint.models ?? endpoint.facts?.models ?? []).map((id) => (parents.has(id) ? { id, parent: parents.get(id) } : { id }));
}

/**
 * Fetch and normalize the models an upstream reports.
 * @param {any} context - `{ endpoint, transport, signal, timeout, auth, extraHeaders, path }`. `path` replaces `/v1/models`.
 * @returns {Promise<{id: string, created?: number, owned_by?: string, max_model_len?: number}[] | null>} Models, or null when the upstream did not answer with a model list.
 */
export async function fetchModels({ endpoint, transport, signal, timeout, auth, extraHeaders, path = "/v1/models" }) {
	const result = await http.json(transport, http.join(endpoint.url, path), {
		method: "GET",
		headers: http.headers(endpoint, auth, extraHeaders),
		signal,
		timeout
	});
	return modelsOf(result);
}

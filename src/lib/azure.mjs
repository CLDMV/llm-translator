/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/azure.mjs
 *	@Date: 2026-11-13T09:00:00-08:00 (1794589200)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-13T09:00:00-08:00 (1794589200)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Azure OpenAI URL layout: the v1 API and the classic per-deployment API.
 * @module @cldmv/llm-translator/lib/azure
 */

/** Path of each call after the API prefix, for the v1 API (model in the body) and for a deployment (model in the URL). */
const TAILS = { chat: "chat/completions", embeddings: "embeddings", models: "models" };

/**
 * Build the path (and query) of an Azure OpenAI call.
 *
 * The v1 API (`<endpoint>/openai/v1/...`, the model named in the body, no `api-version`) is used unless the upstream sets `apiVersion`.
 * With `apiVersion` the classic form is used: `<endpoint>/openai/deployments/<deployment>/chat/completions?api-version=<version>`, where the
 * deployment is the upstream's `deployment` or else the request's model. The model list has no deployment in its path (`/openai/models`).
 * An upstream URL that already ends in `/openai` (a pasted `.../openai/v1` base has its `/v1` removed by the config) is not given a second `/openai`.
 * @param {"chat" | "embeddings" | "models"} kind - Which call.
 * @param {{url: string, apiVersion?: string, deployment?: string}} endpoint - Runtime endpoint.
 * @param {string} [model] - The request's model, the deployment name unless the endpoint sets one.
 * @returns {string} Path starting with `/`, with the `api-version` query for the classic form.
 */
export function route(kind, endpoint, model) {
	const prefix = endpoint.url.endsWith("/openai") ? "" : "/openai";
	const tail = TAILS[kind];
	if (endpoint.apiVersion === undefined) return `${prefix}/v1/${tail}`;
	const query = `?api-version=${encodeURIComponent(endpoint.apiVersion)}`;
	if (kind === "models") return `${prefix}/${tail}${query}`;
	return `${prefix}/deployments/${encodeURIComponent(endpoint.deployment ?? model ?? "")}/${tail}${query}`;
}

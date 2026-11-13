/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/azure/model/list.mjs
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
 * @fileoverview Azure OpenAI driver: model listing.
 * @module @cldmv/llm-translator/driver/azure
 */
import { fetchModels } from "../../../../lib/models.mjs";
import { route } from "../../../../lib/azure.mjs";

/**
 * List the models the Azure OpenAI resource reports (`/openai/v1/models`, or `/openai/models?api-version=...` with the classic URLs). Azure lists
 * base models there, not the resource's deployments, so an upstream that serves deployments should set `models`.
 * @param {any} context - `{ endpoint, transport, signal, timeout }`.
 * @returns {Promise<any[] | null>} Models, or null when unreachable or not a model list.
 */
export function list(context) {
	return fetchModels({ ...context, auth: "api-key", path: route("models", context.endpoint) });
}

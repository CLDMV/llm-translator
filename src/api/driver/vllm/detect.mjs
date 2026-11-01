/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/vllm/detect.mjs
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
 * @fileoverview vLLM driver: detection via `GET /version` and `GET /v1/models`.
 * @module @cldmv/llm-translator/driver/vllm
 */
import * as http from "../../../lib/http.mjs";

/** `owned_by` values of other backends that also answer `/version`. */
const OTHERS = new Set(["sglang", "llamacpp"]);

/**
 * Probe an endpoint for vLLM.
 * @param {any} context - `{ endpoint, transport, signal, timeout, probes }`.
 * @returns {Promise<any | null>} Facts `{ version, models, maxModelLen }`, or null when the endpoint is not vLLM.
 */
export async function detect({ endpoint, transport, signal, timeout, probes }) {
	const context = { endpoint, transport, signal, timeout, probes };
	const [versionResult, modelsResult] = await Promise.all([http.probe(context, "/version"), http.probe(context, "/v1/models")]);
	const version = typeof versionResult.body?.version === "string" ? versionResult.body.version : undefined;
	const models = Array.isArray(modelsResult.body?.data) ? modelsResult.body.data : [];
	// SGLang also answers `/version`; its model list names it, so it is not taken for vLLM.
	if (models.some((entry) => OTHERS.has(entry?.owned_by))) return null;
	if (!version && !models.some((entry) => entry?.owned_by === "vllm")) return null;
	return {
		version,
		models: models.map((entry) => entry.id),
		maxModelLen: models.find((entry) => typeof entry.max_model_len === "number")?.max_model_len
	};
}

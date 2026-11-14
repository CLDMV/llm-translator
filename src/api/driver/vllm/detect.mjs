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
import { adaptersOf } from "../../../lib/models.mjs";
import { isLlamacppProps, isLocalaiVersion, isSglangInfo, isTgiInfo, objectOf } from "../../../lib/backends.mjs";

/** `owned_by` values of other backends that also answer `/version`. */
const OTHERS = new Set(["sglang", "llamacpp"]);

/**
 * Probe an endpoint for vLLM.
 * @param {any} context - `{ endpoint, transport, signal, timeout, probes }`.
 * @returns {Promise<any | null>} Facts `{ version, models, adapters, maxModelLen }` (`models` lists the base models and the LoRA adapters, `adapters` the adapters alone as `{ id, parent }`, taken from the entries whose `parent` names the base model), or null when the endpoint is not vLLM (or is LocalAI, SGLang, llama.cpp or TGI, which can also answer `/version`).
 */
export async function detect({ endpoint, transport, signal, timeout, probes }) {
	const context = { endpoint, transport, signal, timeout, probes };
	const [versionResult, modelsResult] = await Promise.all([http.probe(context, "/version"), http.probe(context, "/v1/models")]);
	// LocalAI answers `/version` as `<version> (<commit>)`; it is not vLLM, whatever its model list says.
	if (isLocalaiVersion(objectOf(versionResult))) return null;
	const version = typeof versionResult.body?.version === "string" ? versionResult.body.version : undefined;
	const models = Array.isArray(modelsResult.body?.data) ? modelsResult.body.data : [];
	// SGLang also answers `/version`; its model list names it, so it is not taken for vLLM.
	if (models.some((entry) => OTHERS.has(entry?.owned_by))) return null;
	const owned = models.some((entry) => entry?.owned_by === "vllm");
	if (!version && !owned) return null;
	// A server that answers `/version` but does not say it is vLLM may be SGLang or llama.cpp whose model list failed. Only then are their
	// identifying paths asked for, so a real vLLM server (which names itself in `/v1/models`) is never sent an extra request.
	if (!owned) {
		const [sglang, llamacpp, tgi] = await Promise.all([
			http.probe(context, "/get_server_info"),
			http.probe(context, "/props"),
			http.probe(context, "/info")
		]);
		if (isSglangInfo(objectOf(sglang)) || isLlamacppProps(objectOf(llamacpp)) || isTgiInfo(objectOf(tgi))) return null;
	}
	return {
		version,
		models: models.map((entry) => entry.id),
		adapters: adaptersOf(models),
		maxModelLen: models.find((entry) => typeof entry.max_model_len === "number")?.max_model_len
	};
}

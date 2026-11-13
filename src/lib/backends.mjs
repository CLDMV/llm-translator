/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/lib/backends.mjs
 *	@Date: 2026-10-31T14:00:00-07:00 (1793480400)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-10-31T14:00:00-07:00 (1793480400)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview How the replies of other backends' identifying endpoints look, shared by the drivers' detection so vLLM can step aside.
 * @module @cldmv/llm-translator/lib/backends
 */

/** Fields `llama-server` puts in its `/props` reply. */
const PROPS = ["default_generation_settings", "total_slots", "build_info"];

/**
 * An object body, or an empty one.
 * @param {{ok: boolean, body: any}} result - Outcome of a probe.
 * @returns {Record<string, any>} The parsed JSON object when the request succeeded.
 */
export function objectOf(result) {
	return result.ok && result.body !== null && typeof result.body === "object" ? result.body : {};
}

/**
 * Does a `/props` reply come from `llama-server`?
 * @param {Record<string, any>} body - Reply object (see `objectOf`).
 * @returns {boolean} True when it carries llama-server fields.
 */
export function isLlamacppProps(body) {
	return PROPS.some((field) => field in body);
}

/**
 * Does a `/get_server_info` reply come from SGLang?
 * @param {Record<string, any>} body - Reply object (see `objectOf`).
 * @returns {boolean} True when it names a model or tokenizer path.
 */
export function isSglangInfo(body) {
	return typeof body.model_path === "string" || typeof body.tokenizer_path === "string";
}

/** Model kinds LM Studio's `GET /api/v0/models` reports in `type`. */
const LMSTUDIO_TYPES = ["llm", "vlm", "embeddings"];

/**
 * Does a `GET /api/v0/models` reply come from LM Studio? The match is strict so no other server binds: `object: "list"`, a non-empty `data`
 * array, and every entry an `object: "model"` with string `id`, `arch`, `compatibility_type` and `state` and a known `type`.
 * @param {Record<string, any>} body - Reply object (see `objectOf`).
 * @returns {boolean} True for LM Studio's model listing.
 */
export function isLmstudioModels(body) {
	if (body.object !== "list" || !Array.isArray(body.data) || body.data.length === 0) return false;
	return body.data.every(
		(entry) =>
			entry?.object === "model" &&
			typeof entry.id === "string" &&
			typeof entry.arch === "string" &&
			typeof entry.compatibility_type === "string" &&
			typeof entry.state === "string" &&
			LMSTUDIO_TYPES.includes(entry.type)
	);
}

/**
 * Does a `GET /info` reply come from Hugging Face Text Generation Inference? The match is strict so no other server binds: the router
 * names itself `text-generation-router` (Text Embeddings Inference answers `/info` too, as `text-embeddings-router`), and the reply
 * carries a string `model_id` and `version` and a numeric `max_total_tokens` (older releases lack `max_input_tokens`, so it is not required).
 * @param {Record<string, any>} body - Reply object (see `objectOf`).
 * @returns {boolean} True for TGI's `/info`.
 */
export function isTgiInfo(body) {
	return (
		body.router === "text-generation-router" &&
		typeof body.model_id === "string" &&
		typeof body.version === "string" &&
		typeof body.max_total_tokens === "number"
	);
}

/**
 * Does a `GET /version` reply come from LocalAI? It answers `{ version: "<version> (<commit>)" }` (the version, a space, and the build
 * commit in parentheses, which is empty for a source build), where vLLM and SGLang answer a bare version, so the shape names LocalAI.
 * @param {Record<string, any>} body - Reply object (see `objectOf`).
 * @returns {boolean} True for LocalAI's version reply.
 */
export function isLocalaiVersion(body) {
	return typeof body.version === "string" && /^\S* \([0-9a-f]*\)$/i.test(body.version);
}

/**
 * Does a `GET /.well-known/localai.json` reply come from LocalAI? It is LocalAI's discovery document: a string `version` and an
 * `endpoints` map that names the OpenAI routes (`models`, `chat_completions`) by path.
 * @param {Record<string, any>} body - Reply object (see `objectOf`).
 * @returns {boolean} True for LocalAI's discovery document.
 */
export function isLocalaiDiscovery(body) {
	return (
		typeof body.version === "string" &&
		body.endpoints !== null &&
		typeof body.endpoints === "object" &&
		body.endpoints.models === "/v1/models" &&
		body.endpoints.chat_completions === "/v1/chat/completions"
	);
}

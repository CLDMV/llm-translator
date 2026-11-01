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

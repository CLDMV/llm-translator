/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/sglang/detect.mjs
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
 * @fileoverview SGLang driver: detection via `GET /get_server_info` (and `owned_by: "sglang"` in `GET /v1/models`).
 * @module @cldmv/llm-translator/driver/sglang
 */
import * as http from "../../../lib/http.mjs";
import { modelsOf } from "../../../lib/models.mjs";

/**
 * Probe an endpoint for SGLang.
 * @param {any} context - `{ endpoint, transport, signal, timeout, probes }`.
 * @returns {Promise<any | null>} Facts `{ version, models, modelPath, reasoningParser, toolCallParser }`, or null when the endpoint is not SGLang.
 */
export async function detect(context) {
	const [info, listing] = await Promise.all([http.probe(context, "/get_server_info"), http.probe(context, "/v1/models")]);
	const body = info.ok && info.body !== null && typeof info.body === "object" ? info.body : {};
	const models = modelsOf(listing) ?? [];
	const known = typeof body.model_path === "string" || typeof body.tokenizer_path === "string";
	if (!known && !models.some((entry) => entry.owned_by === "sglang")) return null;
	const text = (value) => (typeof value === "string" && value !== "" ? value : undefined);
	return {
		version: text(body.version),
		models: models.map((entry) => entry.id),
		modelPath: text(body.model_path),
		reasoningParser: text(body.reasoning_parser),
		toolCallParser: text(body.tool_call_parser)
	};
}

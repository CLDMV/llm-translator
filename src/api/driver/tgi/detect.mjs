/**
 *
 *	@Project: @cldmv/llm-translator
 *	@Filename: /src/api/driver/tgi/detect.mjs
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
 * @fileoverview Hugging Face TGI driver: detection via `GET /info`.
 * @module @cldmv/llm-translator/driver/tgi
 */
import * as http from "../../../lib/http.mjs";
import { isTgiInfo, objectOf } from "../../../lib/backends.mjs";

/**
 * Probe an endpoint for Text Generation Inference.
 * @param {any} context - `{ endpoint, transport, signal, timeout, probes }`.
 * @returns {Promise<any | null>} Facts `{ version, model, maxInputTokens, maxTotalTokens }`, or null when the endpoint is not TGI.
 */
export async function detect(context) {
	const body = objectOf(await http.probe(context, "/info"));
	if (!isTgiInfo(body)) return null;
	return { version: body.version, model: body.model_id, maxInputTokens: body.max_input_tokens, maxTotalTokens: body.max_total_tokens };
}
